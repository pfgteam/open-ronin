// /contacts — Unified contacts directory with role-type filters.
// Source: Supabase contacts + contact_roles (joined). GHL is the future source of truth.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import { Mail, Phone, Linkedin, Twitter } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ContactRow {
	id: string;
	display_name: string;
	first_name: string | null;
	last_name: string | null;
	email: string | null;
	phone: string | null;
	title: string | null;
	organization: string | null;
	avatar_url: string | null;
	linkedin_url: string | null;
	twitter_handle: string | null;
	ghl_contact_id: string | null;
	contact_roles?: { role: string; is_primary: boolean }[];
}

const ROLE_ORDER = [
	'client',
	'prospect',
	'media',
	'journalist',
	'podcaster',
	'influencer',
	'speaker',
	'partnership',
	'industry',
	'vendor',
	'event',
	'team',
];

function roleColor(role: string): 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'accent' {
	if (role === 'client') return 'success';
	if (role === 'prospect') return 'warning';
	if (role === 'media' || role === 'journalist') return 'primary';
	if (role === 'team') return 'default';
	if (role === 'influencer' || role === 'podcaster' || role === 'speaker') return 'accent';
	return 'default';
}

export default async function ContactsPage() {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('contacts')
		.select('*, contact_roles(role, is_primary)')
		.order('display_name', { ascending: true })
		.limit(300);

	const contacts = (data ?? []) as ContactRow[];

	// Compute role counts for the filter pills
	const roleCounts: Record<string, number> = {};
	for (const c of contacts) {
		for (const r of c.contact_roles ?? []) {
			roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1;
		}
	}

	return (
		<>
			<PageHeader
				title="Contacts"
				description={`Unified directory · ${contacts.length} contacts · role-typed`}
				actions={
					<p className="text-xs text-slate-400">
						GHL sync arriving · for now: Supabase-only seed data
					</p>
				}
			/>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error.message}
					</p>
				</Card>
			)}

			{/* Role-type filter row (static — interactive filter in v1.1) */}
			<div className="flex flex-wrap items-center gap-2 mb-4">
				<span className="text-xs text-slate-500 dark:text-slate-400">Roles:</span>
				{ROLE_ORDER.map((r) => (
					<Badge key={r} color={roleColor(r)}>
						{r} {roleCounts[r] ? `(${roleCounts[r]})` : ''}
					</Badge>
				))}
			</div>

			{contacts.length === 0 ? (
				<Card className="border-dashed">
					<p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
						<strong className="text-slate-900 dark:text-slate-100">
							No contacts yet.
						</strong>{' '}
						The schema is live (<code>contacts</code> + <code>contact_roles</code>) but
						no rows have been added yet.
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						Population paths: (1) GHL sync when wired, (2) bulk import from the Client
						Bible masterlist, (3) per-record entry from Client/Brand pages, (4) form
						submissions.
					</p>
				</Card>
			) : (
				<Card padding="none" className="overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
										Name
									</th>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
										Roles
									</th>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
										Organization
									</th>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
										Contact
									</th>
								</tr>
							</thead>
							<tbody>
								{contacts.map((c) => (
									<tr
										key={c.id}
										className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
									>
										<td className="px-4 py-3">
											<div className="font-medium text-slate-900 dark:text-slate-100">
												{c.display_name}
											</div>
											{c.title && (
												<div className="text-xs text-slate-500 dark:text-slate-400">
													{c.title}
												</div>
											)}
										</td>
										<td className="px-4 py-3">
											<div className="flex flex-wrap gap-1">
												{(c.contact_roles ?? []).map((r) => (
													<Badge key={r.role} color={roleColor(r.role)}>
														{r.role}
													</Badge>
												))}
											</div>
										</td>
										<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
											{c.organization ?? '—'}
										</td>
										<td className="px-4 py-3">
											<div className="flex items-center gap-2 text-xs">
												{c.email && (
													<a
														href={`mailto:${c.email}`}
														className="text-primary-600 hover:underline inline-flex items-center gap-1"
													>
														<Mail className="w-3 h-3" />
														email
													</a>
												)}
												{c.phone && (
													<a
														href={`tel:${c.phone}`}
														className="text-slate-600 dark:text-slate-300 hover:text-primary-600 inline-flex items-center gap-1 transition-colors"
													>
														<Phone className="w-3 h-3" />
														phone
													</a>
												)}
												{c.linkedin_url && (
													<a
														href={c.linkedin_url}
														target="_blank"
														rel="noopener noreferrer"
														className="text-slate-600 dark:text-slate-300 hover:text-primary-600 transition-colors"
													>
														<Linkedin className="w-3 h-3" />
													</a>
												)}
												{c.twitter_handle && (
													<a
														href={`https://twitter.com/${c.twitter_handle.replace('@', '')}`}
														target="_blank"
														rel="noopener noreferrer"
														className="text-slate-600 dark:text-slate-300 hover:text-primary-600 transition-colors"
													>
														<Twitter className="w-3 h-3" />
													</a>
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			)}
		</>
	);
}
