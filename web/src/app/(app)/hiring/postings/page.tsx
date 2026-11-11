// /hiring/postings — every live / planned posting across roles with the
// expiry + repost reminders, and the job-alert list (0129).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadBoards, loadHiringConfig, loadJobAlerts, loadPositions, loadPostingsOverview } from '@/lib/hiring/server';
import { POSTING_STATUS_COLORS, POSTING_STATUS_LABELS } from '@/lib/hiring/careers';
import { usd } from '@/lib/hiring/shared';
import { formatDate, formatRelative } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Postings · Hiring' };
export const dynamic = 'force-dynamic';

export default async function PostingsPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const [postings, boards, { positions }, alerts] = await Promise.all([loadPostingsOverview(supabase), loadBoards(supabase), loadPositions(supabase, { status: 'all' }), loadJobAlerts(supabase)]);
	const board = new Map(boards.map((b) => [b.key, b]));
	const position = new Map(positions.map((p) => [p.id, p]));
	const soon = Date.now() + 5 * 86_400_000;
	const expiring = postings.filter((p) => p.expires_at && new Date(p.expires_at).getTime() < soon && (p.status === 'posted' || p.status === 'live'));
	const spend = postings.reduce((n, p) => n + (p.cost_cents ?? 0), 0);
	const active = alerts.filter((a) => !a.unsubscribed_at);

	return (
		<>
			<PageHeader title="Postings" description={`${postings.length} planned / posted / live across ${new Set(postings.map((p) => p.position_id)).size} roles · ${expiring.length} expiring within 5 days · spend ${usd(spend)} · ${active.length} job-alert subscribers`} />
			<div className="grid gap-4 lg:grid-cols-3">
				<Card padding="none" className="lg:col-span-2">
					<table className="w-full text-sm">
						<thead className="text-left text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
							<tr>
								<th className="px-3 py-2">Role</th>
								<th className="px-3 py-2">Board</th>
								<th className="px-3 py-2">Status</th>
								<th className="px-3 py-2">Posted</th>
								<th className="px-3 py-2">Expires</th>
								<th className="px-3 py-2">Cost</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
							{postings.length === 0 && (
								<tr>
									<td colSpan={6} className="px-3 py-8 text-center text-slate-500">
										No postings yet. Build a post kit from a position.
									</td>
								</tr>
							)}
							{postings.map((p) => {
								const pos = position.get(p.position_id);
								const exp = p.expires_at ? new Date(p.expires_at).getTime() : null;
								return (
									<tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
										<td className="px-3 py-2">
											<Link href={`/hiring/positions/${p.position_id}?tab=postkit`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
												{pos?.title ?? '—'}
											</Link>
										</td>
										<td className="px-3 py-2 text-slate-600 dark:text-slate-400">
											{p.live_url ? (
												<a href={p.live_url} target="_blank" rel="noreferrer" className="hover:underline">
													{board.get(p.board_key)?.label ?? p.board_key}
												</a>
											) : (
												board.get(p.board_key)?.label ?? p.board_key
											)}
										</td>
										<td className="px-3 py-2">
											<Badge color={POSTING_STATUS_COLORS[p.status]}>{POSTING_STATUS_LABELS[p.status]}</Badge>
										</td>
										<td className="px-3 py-2 text-xs text-slate-500">{p.posted_at ? formatDate(p.posted_at) : '—'}</td>
										<td className={`px-3 py-2 text-xs ${exp && exp < soon ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>{p.expires_at ? formatDate(p.expires_at) : '—'}</td>
										<td className="px-3 py-2 text-xs tabular-nums text-slate-600 dark:text-slate-400">{p.cost_cents != null ? usd(p.cost_cents) : '—'}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</Card>
				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Job-alert subscribers</h2>
					<p className="text-2xs text-slate-500">Opt-ins from the careers page and closed-role pages. H5&apos;s comms layer sends; nothing goes out automatically yet.</p>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-96 overflow-auto">
						{active.length === 0 && <li className="py-2 text-sm text-slate-500">None yet.</li>}
						{active.slice(0, 100).map((a) => (
							<li key={a.id} className="py-1.5 text-xs">
								<div className="text-slate-900 dark:text-slate-100">{a.email}</div>
								<div className="text-2xs text-slate-500">
									{a.source ?? '—'} · {a.tags.join(', ') || 'any role'} · {formatRelative(a.created_at)}
								</div>
							</li>
						))}
					</ul>
				</Card>
			</div>
		</>
	);
}
