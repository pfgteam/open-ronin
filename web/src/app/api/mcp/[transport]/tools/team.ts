import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, MAX_SCAN } from '@/lib/mcp/tooling';
import { mapPerson, type ProfileRow } from '@/lib/mcp/mappers/team';

const LIMIT = z.number().int().min(1).max(200).default(50);

const PROFILE_COLUMNS =
	'id, first_name, last_name, email, department, department_tag_id, position_track, position_level, job_role, manager_id, employment_status, date_started, in_office, is_active';

function displayName(p: { first_name: string | null; last_name: string | null; email: string }): string {
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

export function registerTeamTools(server: McpServer): void {
	server.registerTool(
		'team_directory',
		{
			title: 'Team directory',
			description:
				'Open Ronin team members from Supabase profiles (the app\'s actual users), with composed position (department + track + level), department, job role, manager name and HQ in-office flag. Defaults to active members only; pass include_inactive to include former staff. Filter by department (matches the department tag label case-insensitively) or a name/email search. Never returns compensation, PAP score, DISC, birthday or bio fields.',
			inputSchema: {
				department: z.string().optional(),
				query: z.string().optional(),
				include_inactive: z.boolean().default(false),
				limit: LIMIT,
			},
		},
		async ({ department, query, include_inactive, limit }, extra) =>
			audited(
				'team_directory',
				'team:read',
				extra.authInfo,
				{ department, query, include_inactive, limit },
				'the team directory',
				async () => {
					const supabase = createServiceRoleClient();

					let profileQuery = supabase.from('profiles').select(PROFILE_COLUMNS).order('first_name', { ascending: true }).limit(MAX_SCAN);
					if (!include_inactive) profileQuery = profileQuery.eq('is_active', true);

					const [{ data: profiles, error }, { data: deptRows }, { data: trackRows }] = await Promise.all([
						profileQuery.returns<ProfileRow[]>(),
						supabase.from('tags').select('id, label').eq('category', 'department'),
						supabase.from('position_tracks').select('slug, label'),
					]);
					if (error) throw error;

					const rows = profiles ?? [];
					const deptById = new Map((deptRows ?? []).map((d) => [d.id, d.label]));
					const trackBySlug = new Map((trackRows ?? []).map((t) => [t.slug, t.label]));
					const byId = new Map(rows.map((p) => [p.id, p]));

					let mapped = rows.map((p) =>
						mapPerson(p, {
							departmentLabel: p.department_tag_id ? (deptById.get(p.department_tag_id) ?? null) : null,
							trackLabel: p.position_track ? (trackBySlug.get(p.position_track) ?? p.position_track) : null,
							managerName: p.manager_id ? (() => {
								const m = byId.get(p.manager_id!);
								return m ? displayName(m) : null;
							})() : null,
						}),
					);

					if (department) {
						const q = department.toLowerCase();
						mapped = mapped.filter((r) => (r.department ?? '').toLowerCase() === q);
					}
					if (query) {
						const q = query.toLowerCase();
						mapped = mapped.filter(
							(r) =>
								`${r.first_name ?? ''} ${r.last_name ?? ''}`.toLowerCase().includes(q) ||
								r.email.toLowerCase().includes(q),
						);
					}

					const truncated = mapped.length > limit || rows.length >= MAX_SCAN;
					const page = mapped.slice(0, limit);
					return { payload: { rows: page, count: mapped.length, truncated }, rows: page.length };
				},
			),
	);
}
