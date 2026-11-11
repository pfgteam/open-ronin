// /team/pap - Performance Action Plan tracker.
// Gated to people-managers and exec/admin. Lists active PAPs, links to docs.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { Lock, ExternalLink, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PapPage() {
	const ctx = await loadSensitiveAccessContext();
	if (!canManagePeople(ctx)) {
		return (
			<>
				<Card>
					<div className="text-center py-12 text-slate-500">
						<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
						<p className="text-sm">PAP records are visible to people-managers, exec, and admin only.</p>
					</div>
				</Card>
			</>
		);
	}

	const supabase = await createClient();
	const { data: papRows } = await supabase
		.from('profile_sensitive')
		.select(`
			user_id, pap_status, pap_started_on, pap_ends_on, pap_doc_url, pap_owner_id,
			profiles!profile_sensitive_user_id_fkey ( id, first_name, last_name, department, title )
		`)
		.in('pap_status', ['active', 'probation', 'completed', 'separated']);

	// Supabase auto-types `profiles` as an array on a foreign-key join, but our
	// PapRow models it as a single object (it's a 1:1 via user_id PK). Go through
	// `unknown` to short-circuit the strict structural check.
	const rows = (papRows ?? []) as unknown as PapRow[];

	const externalLinks = [
		{ label: 'V2 Pay System (master)', url: 'https://docs.google.com/spreadsheets/d/1CLl2AP1w3yRwx5RqgmYrCSDOtm9D9iN7XucXf_2d3EI/edit' },
		{ label: 'Monthly Performance Pay', url: 'https://docs.google.com/spreadsheets/d/1f7LoosCwLy6tAOqaR-qTCuUN6CnyT4eOlCGo2LuglZE/edit' },
		{ label: 'PAPs folder', url: 'https://drive.google.com/drive/folders/1iCHg9xGuvFAkx-UiNIwnllLarNZB5PDN' },
		{ label: 'V2 PAP sample (Casey)', url: 'https://docs.google.com/spreadsheets/d/1uWzKGXTlGTQEkvoJOSf9KPx_V7cC9oPYUYFEQNKfcgw/edit' },
	];

	return (
		<>
			<PageHeader
				title="Performance Action Plans"
				description="Payroll is on Gusto. PAP tracking lives here + on the V2 Pay System sheet. Sensitive - visible to people-managers only."
				actions={
					<div className="flex flex-wrap items-center gap-1.5 max-w-md justify-end">
						{externalLinks.map((l) => (
							<a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 transition-colors">
								<ExternalLink className="w-3 h-3" /> {l.label}
							</a>
						))}
					</div>
				}
			/>

			{rows.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 text-center py-6">No active PAPs.</p>
				</Card>
			) : (
				<Card padding="none">
					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Team member</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Dept</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Started</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Ends</th>
								<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Doc</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => {
								const p = r.profiles;
								const name = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.id : r.user_id.slice(0, 8);
								return (
									<tr key={r.user_id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-3 py-2"><Link href={`/team/${r.user_id}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600 transition-colors">{name}</Link></td>
										<td className="px-3 py-2 text-slate-500">{p?.department ?? '—'}</td>
										<td className="px-3 py-2">
											<Badge color={papStatusColor(r.pap_status)}>
												{r.pap_status === 'active' && <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />}
												{r.pap_status}
											</Badge>
										</td>
										<td className="px-3 py-2 text-slate-500">{formatDate(r.pap_started_on)}</td>
										<td className="px-3 py-2 text-slate-500">{formatDate(r.pap_ends_on)}</td>
										<td className="px-3 py-2">
											{r.pap_doc_url ? (
												<a href={r.pap_doc_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline text-xs">
													<ExternalLink className="w-3 h-3" /> Open
												</a>
											) : <span className="text-slate-300">—</span>}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				</Card>
			)}
		</>
	);
}

interface PapRow {
	user_id: string;
	pap_status: string | null;
	pap_started_on: string | null;
	pap_ends_on: string | null;
	pap_doc_url: string | null;
	pap_owner_id: string | null;
	profiles: {
		id: string;
		first_name: string | null;
		last_name: string | null;
		department: string | null;
		title: string | null;
	} | null;
}

function papStatusColor(s: string | null): 'default' | 'primary' | 'warning' | 'danger' | 'success' {
	switch (s) {
		case 'active': return 'warning';
		case 'probation': return 'danger';
		case 'completed': return 'success';
		case 'separated': return 'danger';
		default: return 'default';
	}
}
