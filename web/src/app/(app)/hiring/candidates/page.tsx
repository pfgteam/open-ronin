// /hiring/candidates — every person who ever applied (one row per
// candidate across roles), with the talent pool filter (0130).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadHiringConfig } from '@/lib/hiring/server';
import { formatRelative } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Candidates · Hiring' };
export const dynamic = 'force-dynamic';

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ pool?: string; q?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	let q = supabase.from('hire_candidates').select('id, full_name, email, location_text, current_title, talent_pool, pool_tags, created_at, applications:hire_applications(id, position_id, status, submitted_at, overall_score, position:hire_positions!hire_applications_position_id_fkey(title))').order('created_at', { ascending: false }).limit(500);
	if (sp.pool === '1') q = q.eq('talent_pool', true);
	const { data } = await q;
	type Row = { id: string; full_name: string; email: string; location_text: string | null; current_title: string | null; talent_pool: boolean; pool_tags: string[]; created_at: string; applications: { id: string; position_id: string; status: string; submitted_at: string; overall_score: number | null; position: { title: string } | null }[] };
	let rows = (data ?? []) as unknown as Row[];
	if (sp.q) {
		const n = sp.q.toLowerCase();
		rows = rows.filter((r) => r.full_name.toLowerCase().includes(n) || r.email.toLowerCase().includes(n) || (r.location_text ?? '').toLowerCase().includes(n) || r.pool_tags.some((t) => t.toLowerCase().includes(n)));
	}
	return (
		<>
			<PageHeader title="Candidates" description={`${rows.length} people · one row per person across every role · talent pool = closed-role applicants kept for future openings`} />
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<FilterChipLink href="/hiring/candidates" active={sp.pool !== '1'}>
					Everyone
				</FilterChipLink>
				<FilterChipLink href="/hiring/candidates?pool=1" active={sp.pool === '1'}>
					Talent pool
				</FilterChipLink>
				<form className="ml-auto" action="/hiring/candidates">
					{sp.pool && <input type="hidden" name="pool" value={sp.pool} />}
					<input name="q" defaultValue={sp.q ?? ''} placeholder="Search name, email, tag" className="text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 w-64" />
				</form>
			</div>
			<Card padding="none">
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No candidates yet.</li>}
					{rows.map((r) => (
						<li key={r.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="text-sm font-medium text-slate-900 dark:text-slate-100">
									{r.full_name} {r.talent_pool && <Badge color="warning">pool</Badge>}
								</div>
								<div className="text-2xs text-slate-500">
									{r.email} · {r.location_text ?? '—'} · {r.current_title ?? '—'} · first seen {formatRelative(r.created_at)}
									{r.pool_tags.length ? ` · ${r.pool_tags.join(', ')}` : ''}
								</div>
							</div>
							<div className="text-xs text-right space-y-0.5 shrink-0">
								{r.applications.map((a) => (
									<div key={a.id}>
										<Link href={`/hiring/positions/${a.position_id}/applications/${a.id}`} className="text-primary-600 hover:underline">
											{a.position?.title ?? 'role'}
										</Link>{' '}
										<span className="text-slate-500">
											· {a.status}
											{a.overall_score != null ? ` · ${a.overall_score}` : ''}
										</span>
									</div>
								))}
							</div>
						</li>
					))}
				</ul>
			</Card>
		</>
	);
}
