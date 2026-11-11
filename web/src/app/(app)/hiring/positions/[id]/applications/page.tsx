// /hiring/positions/[id]/applications — the admin dashboard for one role's
// applicants (0130; H4 adds scores): sort / filter / search / bulk / CSV,
// integrity flags at a glance, stale flag (no activity 14 days).

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadApplications, loadHiringConfig, loadPosition, loadSessionFunnel, type ApplicationFilters } from '@/lib/hiring/server';
import { formatRelative } from '@/lib/format';
import NotAppliedCard from '../../../NotAppliedCard';
import { APP_STATUS_LABELS, BulkBar, RowSelect, StarButton } from './Controls';
import { ScoreRoleBar } from './ScoreControls';
import { aiConfigured } from '@/lib/hiring/ai';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'> = { new: 'primary', screening: 'default', culture_fit: 'default', job_fit: 'default', final: 'accent', offer: 'success', hired: 'success', rejected: 'danger', withdrawn: 'default', pool: 'warning' };

export default async function ApplicationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; source?: string; flagged?: string; starred?: string; hidden?: string; q?: string; sort?: string }> }) {
	const { id } = await params;
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const position = await loadPosition(supabase, id);
	if (!position) notFound();
	const f: ApplicationFilters = {
		status: sp.status ?? 'all',
		source: sp.source || undefined,
		flagged: sp.flagged === '1',
		starred: sp.starred === '1',
		hidden: sp.hidden === '1',
		q: sp.q || undefined,
		sort: (['newest', 'score', 'integrity', 'name'] as const).includes(sp.sort as never) ? (sp.sort as ApplicationFilters['sort']) : 'newest',
	};
	const [apps, funnel, all] = await Promise.all([loadApplications(supabase, position.id, f), loadSessionFunnel(supabase, position.id), loadApplications(supabase, position.id, { status: 'all' })]);
	const href = (q: Record<string, string | undefined>) => {
		const u = new URLSearchParams();
		const merged = { status: sp.status, source: sp.source, flagged: sp.flagged, starred: sp.starred, hidden: sp.hidden, q: sp.q, sort: sp.sort, ...q };
		for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
		const s = u.toString();
		return `/hiring/positions/${position.id}/applications${s ? `?${s}` : ''}`;
	};
	const byStatus = new Map<string, number>();
	for (const a of all) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
	const sources = [...new Set(all.map((a) => a.source ?? 'direct'))].sort();
	const flaggedCount = all.filter((a) => a.honeypot_hits > 0 || a.restarts > 0 || a.blocked_paste_attempts > 0 || a.ai_text_flags > 0).length;
	const stale = (iso: string) => Date.now() - new Date(iso).getTime() > 14 * 86_400_000;
	const unscored = all.filter((a) => a.scored_at == null && !a.hidden && !['rejected', 'withdrawn'].includes(a.status)).length;
	const shortlist = all.filter((a) => a.shortlist_rank != null).sort((a, b) => (a.shortlist_rank ?? 99) - (b.shortlist_rank ?? 99)).slice(0, 10);

	return (
		<>
			<PageHeader
				title={`Applications · ${position.title}`}
				description={`${all.length} total · ${byStatus.get('new') ?? 0} new · ${flaggedCount} flagged · funnel ${funnel.started} started → ${funnel.consented} consented → ${funnel.submitted} submitted`}
				actions={
					<Link href={`/hiring/positions/${position.id}`}>
						<Button variant="ghost" size="sm">
							Position
						</Button>
					</Link>
				}
			/>
			<div className="flex flex-wrap gap-1.5 mb-3">
				<FilterChipLink href={href({ status: undefined })} active={!sp.status || sp.status === 'all'} count={all.length}>
					All
				</FilterChipLink>
				{Object.entries(APP_STATUS_LABELS).map(([k, v]) => (
					<FilterChipLink key={k} href={href({ status: k })} active={sp.status === k} count={byStatus.get(k) ?? 0}>
						{v}
					</FilterChipLink>
				))}
				<span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
				<FilterChipLink href={href({ flagged: sp.flagged === '1' ? undefined : '1' })} active={sp.flagged === '1'} tone="warning" count={flaggedCount}>
					Integrity flags
				</FilterChipLink>
				<FilterChipLink href={href({ starred: sp.starred === '1' ? undefined : '1' })} active={sp.starred === '1'}>
					★ Starred
				</FilterChipLink>
				<FilterChipLink href={href({ hidden: sp.hidden === '1' ? undefined : '1' })} active={sp.hidden === '1'}>
					Show hidden
				</FilterChipLink>
				<span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
				{sources.map((s) => (
					<FilterChipLink key={s} href={href({ source: sp.source === s ? undefined : s })} active={sp.source === s}>
						{s}
					</FilterChipLink>
				))}
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
				<form className="flex items-center gap-2" action={`/hiring/positions/${position.id}/applications`}>
					{sp.status && <input type="hidden" name="status" value={sp.status} />}
					<input name="q" defaultValue={sp.q ?? ''} placeholder="Search name, email, location" className="text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 w-64" />
					<select name="sort" defaultValue={f.sort} className="text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5">
						<option value="newest">Newest</option>
						<option value="score">Score (H4)</option>
						<option value="integrity">Integrity (worst first)</option>
						<option value="name">Name</option>
					</select>
					<Button type="submit" size="sm" variant="outline">
						Apply
					</Button>
				</form>
				<BulkBar positionId={position.id} ids={apps.map((a) => a.id)} />
			</div>
			<div className="mb-3 space-y-2">
				<ScoreRoleBar positionId={position.id} unscored={unscored} aiReady={aiConfigured()} />
				{!aiConfigured() && unscored > 0 && (
					<Callout tone="warning" className="py-1">
						{unscored} application{unscored === 1 ? '' : 's'} cannot be scored: no AI text provider is configured in this deployment. Add ANTHROPIC_API_KEY or OPENAI_API_KEY in Vercel; the hiring cron then scores the backlog on its next 10-minute tick.
					</Callout>
				)}
			</div>
			{shortlist.length > 0 && (
				<Card className="mb-3 space-y-2">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Top {shortlist.length}</h2>
						<span className="text-2xs text-slate-500">ranked by overall, then integrity; rejected / pooled excluded</span>
					</div>
					<ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
						{shortlist.map((a) => (
							<li key={a.id} className="flex items-start gap-2 text-sm">
								<span className="font-mono text-slate-500 w-5 shrink-0">{a.shortlist_rank}.</span>
								<div className="min-w-0">
									<Link href={`/hiring/positions/${position.id}/applications/${a.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
										{a.candidate?.full_name ?? '—'}
									</Link>
									<span className="font-mono text-xs text-slate-600 dark:text-slate-400"> {a.overall_score}</span>
									{a.summary_line && <div className="text-xs text-slate-600 dark:text-slate-400">{a.summary_line}</div>}
									{a.top_strength && <div className="text-2xs text-green-700 dark:text-green-400">+ {a.top_strength}</div>}
									{a.biggest_concern && <div className="text-2xs text-amber-700 dark:text-amber-400">− {a.biggest_concern}</div>}
								</div>
							</li>
						))}
					</ol>
				</Card>
			)}
			<Card padding="none">
				<table className="w-full text-sm">
					<thead className="text-left text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
						<tr>
							<th className="px-3 py-2 w-8"></th>
							<th className="px-3 py-2 w-8"></th>
							<th className="px-3 py-2">Candidate</th>
							<th className="px-3 py-2">Source</th>
							<th className="px-3 py-2">Score</th>
							<th className="px-3 py-2">Integrity</th>
							<th className="px-3 py-2">Status</th>
							<th className="px-3 py-2">Submitted</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
						{apps.length === 0 && (
							<tr>
								<td colSpan={8} className="px-3 py-8 text-center text-slate-500">
									No applications in this view.
								</td>
							</tr>
						)}
						{apps.map((a) => {
							const flags: string[] = [];
							if (a.honeypot_hits) flags.push(`${a.honeypot_hits} honeypot`);
							if (a.restarts) flags.push(`${a.restarts} restart`);
							if (a.blocked_paste_attempts) flags.push(`${a.blocked_paste_attempts} blocked paste`);
							if (a.paste_events) flags.push(`${a.pasted_chars} pasted`);
							if (a.ai_text_flags) flags.push(`${a.ai_text_flags} AI-text`);
							return (
								<tr key={a.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/45 ${a.hidden ? 'opacity-60' : ''}`}>
									<td className="px-3 py-2">
										<RowSelect id={a.id} />
									</td>
									<td className="px-3 py-2">
										<StarButton id={a.id} positionId={position.id} starred={a.starred} />
									</td>
									<td className="px-3 py-2">
										<Link href={`/hiring/positions/${position.id}/applications/${a.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
											{a.candidate?.full_name ?? '—'}
										</Link>
										<div className="text-2xs text-slate-500">
											{a.candidate?.email} · {a.candidate?.location_text ?? '—'}
											{a.summary_line ? ` · ${a.summary_line}` : ''}
										</div>
									</td>
									<td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{a.source ?? 'direct'}</td>
									<td className="px-3 py-2 tabular-nums">
										{a.overall_score != null ? (
											<span className={`font-mono ${a.overall_score >= 75 ? 'text-green-700 dark:text-green-400' : a.overall_score >= 50 ? 'text-slate-700 dark:text-slate-300' : 'text-amber-700 dark:text-amber-400'}`}>
												{a.overall_score}
												{a.previous_overall != null && a.previous_overall !== a.overall_score && <span className="text-2xs text-slate-400"> ({a.overall_score > a.previous_overall ? '+' : ''}{a.overall_score - a.previous_overall})</span>}
											</span>
										) : (
											<span className="text-2xs text-slate-400">unscored</span>
										)}
									</td>
									<td className="px-3 py-2 text-2xs">
										{flags.length ? <span className="text-amber-700 dark:text-amber-400">{flags.join(' · ')}</span> : <span className="text-green-700 dark:text-green-400">clean</span>}
										{a.integrity_score != null && <span className="text-slate-500"> · {a.integrity_score}</span>}
									</td>
									<td className="px-3 py-2">
										<Badge color={STATUS_COLORS[a.status] ?? 'default'}>{APP_STATUS_LABELS[a.status] ?? a.status}</Badge>
										{stale(a.last_activity_at) && !['hired', 'rejected', 'withdrawn', 'pool'].includes(a.status) && <Badge color="warning" className="ml-1">stale</Badge>}
									</td>
									<td className="px-3 py-2 text-xs text-slate-500">{formatRelative(a.submitted_at)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</Card>
		</>
	);
}
