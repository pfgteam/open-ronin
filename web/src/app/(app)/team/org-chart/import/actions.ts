'use server';

// Server action - resolves CSV rows to Supabase profiles + stages the rest as
// graph nodes. Supports two CSV shapes:
//
// (A) Simple shape: name, email?, title?, department?, manager_email?, manager_name?
// (B) Lucidchart export shape: employee_id, name, supervisor_id, role, email?, ...
//
// The caller passes whichever they have; this action sniffs based on whether
// employee_id is populated on the rows.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { recordAudit } from '@/lib/audit';
import { explainAndLog } from '@/lib/errors';

interface SimpleRow {
	name: string;
	email?: string;
	title?: string;
	department?: string;
	manager_name?: string;
	manager_email?: string;
}

interface LucidRow {
	employee_id: string;
	name: string;
	supervisor_id?: string;
	role?: string;
	email?: string;
	location?: string;
}

type Row = SimpleRow | LucidRow;

export interface ImportResult {
	updatedProfiles: number;
	graphNodesCreated: number;
	unresolvedManagers: number;
	errors: string[];
}

function isLucid(r: Row): r is LucidRow {
	return 'employee_id' in r && !!r.employee_id;
}

export async function importOrgChart({ rows }: { rows: Row[] }): Promise<{ ok: boolean; error?: string; result?: ImportResult }> {
	try {
		const supabase = await createClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (!user) return { ok: false, error: 'Not authenticated' };

		// Mass-writes titles/departments/managers — same gate as every other
		// people write path (was missing: any signed-in user could import).
		const ctx = await loadSensitiveAccessContext();
		if (!canManagePeople(ctx)) {
			return { ok: false, error: 'Only people managers, execs or admins can import the org chart.' };
		}

		const { data: profileRows } = await supabase.from('profiles').select('id, email, first_name, last_name, manager_id');
		const profiles = profileRows ?? [];

		// Live manager map — kept up to date as the import writes, so the
		// cycle guard sees both pre-existing and just-imported edges.
		const managerOf = new Map<string, string | null>();
		for (const p of profiles) managerOf.set(p.id, (p as { manager_id?: string | null }).manager_id ?? null);
		function wouldCycle(childId: string, parentId: string): boolean {
			if (childId === parentId) return true;
			let cur: string | null = parentId;
			let hops = 0;
			while (cur && hops < 100) {
				if (cur === childId) return true;
				cur = managerOf.get(cur) ?? null;
				hops++;
			}
			return false;
		}

		const byEmail = new Map<string, string>();
		const byNameLower = new Map<string, string>();
		for (const p of profiles) {
			if (p.email) byEmail.set(p.email.toLowerCase(), p.id);
			const full = [p.first_name, p.last_name].filter(Boolean).join(' ').toLowerCase();
			if (full) byNameLower.set(full, p.id);
		}

		function findProfileId(args: { name?: string; email?: string }): string | null {
			if (args.email && byEmail.has(args.email.toLowerCase())) return byEmail.get(args.email.toLowerCase())!;
			if (args.name && byNameLower.has(args.name.toLowerCase())) return byNameLower.get(args.name.toLowerCase())!;
			return null;
		}

		let updatedProfiles = 0;
		let graphNodesCreated = 0;
		let unresolvedManagers = 0;
		const errors: string[] = [];

		// Ensure a holding graph document for non-matching rows
		let { data: pendingDoc } = await supabase
			.from('graph_documents')
			.select('id')
			.eq('kind', 'org_chart')
			.eq('name', 'Org Chart - Imported (Pending Resolution)')
			.maybeSingle();
		if (!pendingDoc) {
			const { data: newDoc, error } = await supabase
				.from('graph_documents')
				.insert({
					kind: 'org_chart',
					name: 'Org Chart - Imported (Pending Resolution)',
					description_md: 'Imported rows that did not match an existing Supabase profile.',
					created_by: user.id,
				})
				.select('id')
				.single();
			if (error) return { ok: false, error: explainAndLog(error, 'import.actions') };
			pendingDoc = newDoc;
		}

		// First pass: stage every row. For Lucid format we build employee_id->graph_node_id
		// so we can wire parent_node_id correctly.
		const empToNodeId = new Map<string, string>();
		const empToName = new Map<string, string>();
		const empToProfileId = new Map<string, string>();

		for (const row of rows) {
			let name: string;
			let email: string | undefined;
			let title: string | undefined;
			let department: string | undefined;
			let employeeId: string | undefined;

			if (isLucid(row)) {
				name = row.name;
				email = row.email;
				title = row.role;
				employeeId = row.employee_id;
				if (employeeId && name) empToName.set(employeeId, name);
			} else {
				name = row.name;
				email = row.email;
				title = row.title;
				department = row.department;
			}

			if (!name && !employeeId) continue;

			const profileId = findProfileId({ name, email });
			if (profileId && employeeId) empToProfileId.set(employeeId, profileId);

			if (profileId) {
				const patch: Record<string, unknown> = {};
				if (title) patch.title = title;
				if (department) patch.department = department;
				if (Object.keys(patch).length > 0) {
					const { error } = await supabase.from('profiles').update(patch).eq('id', profileId);
					if (error) errors.push(name + ': ' + error.message);
					else updatedProfiles++;
				}
			} else if (pendingDoc) {
				const noteParts: string[] = [];
				if (title) noteParts.push('Role: ' + title);
				if (email) noteParts.push('Email: ' + email);
				if (department) noteParts.push('Dept: ' + department);
				if (employeeId) noteParts.push('Employee ID: ' + employeeId);
				const { data, error } = await supabase
					.from('graph_nodes')
					.insert({
						document_id: pendingDoc.id,
						label: name || '(Unnamed - ' + (employeeId ?? 'no id') + ')',
						notes_md: noteParts.length > 0 ? noteParts.join(' · ') : null,
					})
					.select('id')
					.single();
				if (error) errors.push(name + ': ' + error.message);
				else {
					graphNodesCreated++;
					if (employeeId) empToNodeId.set(employeeId, data.id);
				}
			}
		}

		// Second pass: link parents
		for (const row of rows) {
			if (isLucid(row)) {
				if (!row.supervisor_id) continue;
				const childProfileId = row.employee_id ? empToProfileId.get(row.employee_id) : null;
				const childNodeId = row.employee_id ? empToNodeId.get(row.employee_id) : null;
				const parentProfileId = empToProfileId.get(row.supervisor_id);
				const parentNodeId = empToNodeId.get(row.supervisor_id);
				if (childProfileId && parentProfileId) {
					if (wouldCycle(childProfileId, parentProfileId)) {
						errors.push(`${row.name}: manager assignment skipped — would create a reporting cycle`);
						unresolvedManagers++;
					} else {
						const { error } = await supabase.from('profiles').update({ manager_id: parentProfileId }).eq('id', childProfileId);
						if (error) { errors.push(`${row.name}: ${error.message}`); unresolvedManagers++; }
						else managerOf.set(childProfileId, parentProfileId);
					}
				} else if (childNodeId && parentNodeId) {
					await supabase.from('graph_nodes').update({ parent_node_id: parentNodeId }).eq('id', childNodeId);
				} else if (childNodeId && parentProfileId) {
					await supabase.from('graph_nodes').update({ user_id: parentProfileId }).eq('id', childNodeId);
					// Note: we don't have a profile->node mapping; manager remains unresolved on the node graph
					unresolvedManagers++;
				} else if (row.supervisor_id) {
					unresolvedManagers++;
				}
			} else {
				if (!row.manager_name && !row.manager_email) continue;
				const childId = findProfileId({ name: row.name, email: row.email });
				const parentId = findProfileId({ name: row.manager_name, email: row.manager_email });
				if (childId && parentId) {
					if (wouldCycle(childId, parentId)) {
						errors.push(`${row.name}: manager assignment skipped — would create a reporting cycle`);
						unresolvedManagers++;
					} else {
						const { error } = await supabase.from('profiles').update({ manager_id: parentId }).eq('id', childId);
						if (error) { errors.push(`${row.name}: ${error.message}`); unresolvedManagers++; }
						else managerOf.set(childId, parentId);
					}
				} else {
					unresolvedManagers++;
				}
			}
		}

		await recordAudit({
			actor_id: user.id,
			entity_kind: 'supabase',
			entity_ref: 'profiles/org-chart-import',
			action: 'update',
			diff: {
				rows: rows.length,
				updatedProfiles,
				graphNodesCreated,
				unresolvedManagers,
				errorCount: errors.length,
			},
			status: errors.length > 0 ? 'error' : 'success',
		});

		revalidatePath('/team/org-chart');
		revalidatePath('/team');
		return { ok: true, result: { updatedProfiles, graphNodesCreated, unresolvedManagers, errors } };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
