// /admin/capabilities: per person capabilities (user_capabilities, 0055).
//
// The role matrix at /admin/roles answers "which modules does this ROLE see".
// This page answers "may THIS PERSON do this specific thing": run the Lead
// Scraper, run Data Imports, source acquisitions. One card per capability
// with every holder, who granted it and when, a revoke button, and a grant
// form. Admin/exec only (the /admin ModuleGate plus requireAdmin in actions).
//
// R6 (0060): `acquisitions` is need to know. It is listed only to Alex and
// Jamie and only Alex can grant or revoke it; the 0072 trigger enforces
// the same in SQL, so what this page hides is honesty, not the boundary.
//
// Every change writes audit_log through the action; the last 20 capability
// events are shown at the bottom so an admin can see the trail without
// opening /admin/audit.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Lock, Trash2, UserSearch, ExternalLink } from 'lucide-react';
import { departmentOf, departmentLabelById, loadDepartments } from '@/lib/people/departments';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import {
	CAPABILITIES,
	CAPABILITY_LABELS,
	CAPABILITY_DESCRIPTIONS,
	CAPABILITY_HREFS,
	canGrantCapability,
	canSeeCapability,
	hasAdminFloor,
	type CapabilityKey,
} from '@/lib/permissions/constants';
import { FormError, Field, selectClass } from '../../team/_form';
import { setCapability } from './actions';

export const metadata = { title: 'Capabilities' };
export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ error?: string }>;
}

interface CapabilityRow {
	user_id: string;
	capability: string;
	granted_by: string | null;
	granted_at: string;
}

interface ProfileLite {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	title: string | null;
	department_tag_id: string | null;
	role: string;
	is_active: boolean;
}

interface AuditRow {
	id: number;
	actor_id: string | null;
	entity_ref: string;
	action: string;
	created_at: string;
}

export default async function CapabilitiesPage({ searchParams }: PageProps) {
	const { error } = await searchParams;
	const supabase = await createClient();
	const viewer = await getAuthProfile();
	const viewerId = viewer?.id ?? null;

	const canEdit =
		!!viewer && viewer.is_active && (viewer.role === 'admin' || viewer.role === 'exec');

	const [{ data: capRows, error: capError }, { data: profileRows }, departmentTags] = await Promise.all([
		// 0055 may not be applied yet: an error leaves capRows null and the page
		// renders its "apply the migration" state rather than crashing.
		supabase.from('user_capabilities').select('user_id, capability, granted_by, granted_at'),
		supabase
			.from('profiles')
			.select('id, first_name, last_name, email, title, department_tag_id, role, is_active')
			.order('first_name'),
		loadDepartments(supabase),
	]);

	// Department label comes from the tags table — profiles.department (free
	// text) was retired in 0089.
	const deptLabels = departmentLabelById(departmentTags);
	const deptLabel = (p: ProfileLite) => departmentOf(p, deptLabels);

	// audit_log has no authenticated read policy outside admin; this page is
	// admin only, and the service role read keeps it to capability events.
	const { data: auditRows } = canEdit
		? await createServiceRoleClient()
				.from('audit_log')
				.select('id, actor_id, entity_ref, action, created_at')
				.like('entity_ref', 'user_capabilities/%')
				.order('created_at', { ascending: false })
				.limit(20)
		: { data: [] as AuditRow[] };

	const applied = !capError;
	const rows = (capRows ?? []) as CapabilityRow[];
	const people = (profileRows ?? []) as ProfileLite[];
	const peopleById = new Map(people.map((p) => [p.id, p]));
	const active = people.filter((p) => p.is_active);

	const nameOf = (p: ProfileLite | undefined, fallback: string) =>
		p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email : fallback;

	const visible = CAPABILITIES.filter((c) => canSeeCapability(c, viewerId));
	const hiddenCount = CAPABILITIES.length - visible.length;

	return (
		<>
			<PageHeader
				title="Capabilities"
				description="Permissions granted to named people rather than to a role, with who granted each one and when"
				actions={
					<Link
						href="/admin/roles"
						className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
					>
						Module matrix is at Roles &amp; Permissions
					</Link>
				}
			/>

			<div className="space-y-4">
				<FormError message={error} />

				{!applied ? (
					<Card>
						<p className="text-sm text-slate-600 dark:text-slate-400">
							The capability table is missing. Apply migration{' '}
							<code>0055_user_capabilities.sql</code> in the Supabase SQL Editor. Until then
							the Lead Scraper and Data Imports stay admin and exec only.
						</p>
					</Card>
				) : (
					visible.map((capability) => {
						const holders = rows
							.filter((r) => r.capability === capability)
							.sort((a, b) => nameOf(peopleById.get(a.user_id), '').localeCompare(nameOf(peopleById.get(b.user_id), '')));
						const holderIds = new Set(holders.map((h) => h.user_id));
						const floored = hasAdminFloor(capability);
						const grantable = canEdit && canGrantCapability(capability, viewerId);
						// Admin/exec already pass a floored capability without a row, so
						// offering to grant them one would create a row that changes nothing.
						const candidates = active.filter(
							(p) => !holderIds.has(p.id) && (!floored || (p.role !== 'admin' && p.role !== 'exec')),
						);

						return (
							<Card key={capability} padding="none">
								<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
									<UserSearch className="w-3.5 h-3.5 text-slate-400" />
									<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
										{CAPABILITY_LABELS[capability]}
									</h2>
									<code className="text-2xs text-slate-600 dark:text-slate-400">{capability}</code>
									{!canGrantCapability(capability, viewerId) && (
										<Badge color="warning" className="text-2xs">
											<Lock className="w-3 h-3 mr-1" /> Alex only
										</Badge>
									)}
									<span className="ml-auto text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
										{holders.length} {holders.length === 1 ? 'person' : 'people'}
									</span>
									<Link
										href={CAPABILITY_HREFS[capability]}
										className="text-2xs text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1"
									>
										Where it is used <ExternalLink className="w-3 h-3" />
									</Link>
								</div>

								<div className="px-3 py-3 space-y-3">
									<p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
										{CAPABILITY_DESCRIPTIONS[capability]}
									</p>
									<p className="text-2xs text-slate-600 dark:text-slate-400">
										{floored
											? 'Admin and exec always have this; they need no grant.'
											: 'Nobody has this without a grant, including admin and exec.'}
									</p>

									{holders.length === 0 ? (
										<p className="text-sm text-slate-500">Nobody has been granted this yet.</p>
									) : (
										<div className="overflow-x-auto">
										<table className="w-full text-sm">
											<thead className="bg-slate-50/80 dark:bg-slate-900/30">
												<tr>
													<th className="text-left px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Person</th>
													<th className="text-left px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Granted by</th>
													<th className="text-left px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">When</th>
													<th className="px-2 py-1.5" />
												</tr>
											</thead>
											<tbody>
												{holders.map((h) => {
													const person = peopleById.get(h.user_id);
													const granter = h.granted_by ? peopleById.get(h.granted_by) : undefined;
													return (
														<tr
															key={h.user_id}
															className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
														>
															<td className="px-2 py-1.5">
																<Link
																	href={`/team/${h.user_id}`}
																	className="text-slate-900 dark:text-slate-100 hover:text-primary-600 transition-colors"
																>
																	{nameOf(person, h.user_id.slice(0, 8))}
																</Link>
																{person?.title && (
																	<span className="ml-2 text-2xs text-slate-600 dark:text-slate-400">{person.title}</span>
																)}
																{person && !person.is_active && (
																	<Badge color="warning" className="ml-2 text-2xs">inactive</Badge>
																)}
																{!person && (
																	<Badge color="warning" className="ml-2 text-2xs">deleted</Badge>
																)}
															</td>
															<td className="px-2 py-1.5 text-slate-600 dark:text-slate-400">
																{h.granted_by ? nameOf(granter, h.granted_by.slice(0, 8)) : 'migration'}
															</td>
															<td className="px-2 py-1.5 text-slate-600 dark:text-slate-400 tabular-nums">
																{formatDate(h.granted_at)}
															</td>
															<td className="px-2 py-1 text-right">
																{grantable && (
																	<form action={setCapability}>
																		<input type="hidden" name="user_id" value={h.user_id} />
																		<input type="hidden" name="capability" value={capability} />
																		<input type="hidden" name="granted" value="false" />
																		<Button variant="ghost" size="sm" type="submit">
																			<Trash2 className="w-3.5 h-3.5" /> Revoke
																		</Button>
																	</form>
																)}
															</td>
														</tr>
													);
												})}
											</tbody>
										</table>
										</div>
									)}

									{grantable && candidates.length > 0 && (
										<form action={setCapability} className="flex items-end gap-2 flex-wrap">
											<input type="hidden" name="capability" value={capability} />
											<input type="hidden" name="granted" value="true" />
											<Field label="Grant to">
												<select name="user_id" defaultValue="" className={selectClass} required>
													<option value="">Select a person</option>
													{candidates.map((c) => (
														<option key={c.id} value={c.id}>
															{nameOf(c, c.email)}
															{deptLabel(c) ? ` · ${deptLabel(c)}` : ''}
														</option>
													))}
												</select>
											</Field>
											<Button type="submit" size="sm">
												Grant
											</Button>
										</form>
									)}
								</div>
							</Card>
						);
					})
				)}

				{hiddenCount > 0 && (
					<p className="text-2xs text-slate-600 dark:text-slate-400">
						{hiddenCount} restricted {hiddenCount === 1 ? 'capability is' : 'capabilities are'} not shown to this account.
					</p>
				)}

				{canEdit && applied && (
					<Card padding="none">
						<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent changes</h2>
							<span className="text-2xs text-slate-600 dark:text-slate-400">last 20 from audit_log</span>
							<Link href="/admin/audit" className="ml-auto text-2xs text-primary-600 dark:text-primary-400 hover:underline">
								Full audit log
							</Link>
						</div>
						{(auditRows ?? []).length === 0 ? (
							<p className="px-3 py-4 text-sm text-slate-500">No capability changes recorded yet.</p>
						) : (
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{((auditRows ?? []) as AuditRow[])
									.filter((a) => {
										// Restricted capabilities stay hidden in the trail too.
										const key = a.entity_ref.split('/')[2] as CapabilityKey | undefined;
										return !key || canSeeCapability(key, viewerId);
									})
									.map((a) => {
										const [, userId, key] = a.entity_ref.split('/');
										return (
											<li key={a.id} className="px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover transition-colors">
												<span className={`w-1.5 h-1.5 rounded-full ${a.action.endsWith('grant') ? 'bg-green-500' : 'bg-red-500'}`} />
												<span className="text-slate-900 dark:text-slate-100">
													{nameOf(peopleById.get(a.actor_id ?? ''), 'system')}
												</span>
												<span className="text-slate-500">{a.action.endsWith('grant') ? 'granted' : 'revoked'}</span>
												<span className="text-slate-700 dark:text-slate-300">{CAPABILITY_LABELS[key as CapabilityKey] ?? key}</span>
												<span className="text-slate-500">{a.action.endsWith('grant') ? 'to' : 'from'}</span>
												<span className="text-slate-900 dark:text-slate-100">{nameOf(peopleById.get(userId), userId?.slice(0, 8) ?? '')}</span>
												<span className="ml-auto text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{formatDate(a.created_at, 'MMM d, yyyy HH:mm')}</span>
											</li>
										);
									})}
							</ul>
						)}
					</Card>
				)}
			</div>
		</>
	);
}
