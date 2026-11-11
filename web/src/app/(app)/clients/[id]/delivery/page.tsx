// /clients/[id]/delivery — this client's media delivery for one month.
//
// KPIs and the monthly bars read the Supabase mirror (client_opp_months via
// the 0071 trend view) so they can never disagree with /clients/deliverables.
// The opportunity list is the one Airtable read: Client Media → Media
// Opportunities for the month, grouped by the R3 stage from lib/media/status.
// Client Media links opps to its own Client Metrics table, so the match is
// by name — when the mirror counts secured opps but the name finds none, the
// page says so instead of showing an empty list.

import { Suspense } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Link2, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { monthLabel } from '@/lib/clients/analytics';
import { STAGE_ORDER, groupOpps, sumReach, tierLabel, type OppRow } from '@/lib/delivery/opps';
import { asOfForMonth, paceOf, type Pace } from '@/lib/delivery/pace';
import { currentMonth, isMonthParam, loadClientDelivery, loadClientDeliveryOpps, monthTitle } from '@/lib/delivery/server';
import { formatDate, formatNumber } from '@/lib/format';
import { stageColor, type MediaStage } from '@/lib/media/status';
import { Kpi } from '../../analytics/_ui';
import MonthSelect, { type MonthOption } from '../../deliverables/MonthSelect';
import { requireClient } from '../_lib';

export const dynamic = 'force-dynamic';

const STAGE_TITLE: Record<MediaStage, { title: string; empty: string; dot: string }> = {
	secured: { title: 'Secured', empty: 'Nothing secured this month yet.', dot: 'bg-green-500' },
	pitched: { title: 'Pitched', empty: 'No open pitches this month.', dot: 'bg-slate-400' },
	client_lost: {
		title: 'Lost on the client side',
		empty: 'No client declines, unresponsive or missed deadlines this month.',
		dot: 'bg-amber-500',
	},
	media_lost: { title: 'Lost on the media side', empty: 'No media declines or cancellations this month.', dot: 'bg-red-500' },
	unmapped: { title: 'Unrecognised status', empty: '', dot: 'bg-slate-300' },
};

function PaceBadge({ pace }: { pace: Pace }) {
	if (pace === 'met')
		return (
			<Badge color="success">
				<Check className="w-3 h-3" aria-hidden />
				Goal met
			</Badge>
		);
	if (pace === 'onpace')
		return (
			<Badge color="success">
				<TrendingUp className="w-3 h-3" aria-hidden />
				On pace
			</Badge>
		);
	if (pace === 'behind')
		return (
			<Badge color="danger">
				<TrendingDown className="w-3 h-3" aria-hidden />
				Behind
			</Badge>
		);
	return (
		<Badge color="default">
			<Minus className="w-3 h-3" aria-hidden />
			No goal
		</Badge>
	);
}

function OppTable({ rows }: { rows: OppRow[] }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm min-w-[640px]">
				<tbody>
					{rows.map((o) => (
						<tr key={o.id} className="border-t border-slate-200 dark:border-slate-700">
							<td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
								{o.liveLink ? (
									<a href={o.liveLink} target="_blank" rel="noopener noreferrer" className="hover:underline">
										{o.outlet}
									</a>
								) : (
									o.outlet
								)}
							</td>
							<td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
								{o.dateSecured ? formatDate(o.dateSecured, 'MMM d') : '—'}
							</td>
							<td className="px-4 py-2 whitespace-nowrap">
								<Badge color={o.tier?.startsWith('Top') ? 'success' : 'default'}>{tierLabel(o.tier)}</Badge>
							</td>
							<td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{o.securedBy ?? '—'}</td>
							<td className="px-4 py-2 whitespace-nowrap">
								{o.live ? (
									<a
										href={o.liveLink ?? '#'}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 hover:underline"
									>
										<Link2 className="w-3 h-3" aria-hidden />
										Live
									</a>
								) : (
									<Badge color={stageColor(o.status)}>{o.status || '—'}</Badge>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default async function DeliveryTab({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ month?: string }>;
}) {
	const [{ id }, sp] = await Promise.all([params, searchParams]);
	const ctx = await requireClient(id, '/delivery');
	const month = isMonthParam(sp.month) ? sp.month : currentMonth();

	const [delivery, opps] = await Promise.all([
		loadClientDelivery(ctx.clientId, month),
		loadClientDeliveryOpps(ctx.clientId, ctx.name, month),
	]);
	const groups = groupOpps(opps.rows);
	const pace = paceOf(delivery.secured, delivery.goal, asOfForMonth(month, new Date()));
	const liveRows = opps.rows.filter((o) => o.live);
	const topTier = liveRows.filter((o) => o.tier?.startsWith('Top')).length;
	const reach = sumReach(opps.rows);
	const mismatch = delivery.secured > 0 && !opps.error && opps.rows.length === 0;
	const options: MonthOption[] = delivery.months
		.slice()
		.reverse()
		.map((iso) => ({ value: iso.slice(0, 7), label: monthTitle(iso.slice(0, 7)), count: 0 }));
	const maxSecured = Math.max(1, ...delivery.trend.map((t) => t?.secured_count ?? 0));
	const recent = delivery.months.slice(-6);
	const recentTrend = delivery.trend.slice(-6);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-slate-500 dark:text-slate-400">
					{monthTitle(month)} · {delivery.contract?.package ?? ctx.fields.Packages?.join(', ') ?? '—'}
					{delivery.goalSource && <> · goal of record: {delivery.goalSource}</>}
				</p>
				<div className="flex items-center gap-2">
					<Suspense fallback={null}>
						<MonthSelect months={options} selected={month} basePath={`/clients/${ctx.clientId}/delivery`} allLabel={null} />
					</Suspense>
					<Link
						href={`/media/opps?client=${encodeURIComponent(ctx.name)}`}
						className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45"
					>
						View in Media Opps <ExternalLink className="w-3 h-3" aria-hidden />
					</Link>
				</div>
			</div>

			{delivery.error && (
				<Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load the mirror:</strong> {delivery.error}
					</p>
				</Card>
			)}

			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<Kpi
					label={`Secured · ${monthLabel(`${month}-01`)}`}
					value={
						<>
							{delivery.secured} <span className="text-sm font-normal text-slate-500">/ {delivery.goal ?? '—'} goal</span>
						</>
					}
					hint={<PaceBadge pace={pace} />}
				/>
				<Kpi label="Live" value={delivery.live} hint={`${topTier} top tier`} />
				<Kpi
					label="Pitched, no answer"
					value={groups.pitched.length}
					hint={`${groups.secured.filter((o) => !o.live).length} secured, not live yet`}
				/>
				<Kpi
					label="Lost"
					value={groups.client_lost.length + groups.media_lost.length}
					hint={reach > 0 ? `Est. reach of live rows: ${formatNumber(reach)}` : 'client + media side'}
				/>
			</div>

			{!delivery.synced && !delivery.error && (
				<p className="text-2xs text-amber-700 dark:text-amber-400">
					No mirror row for this month yet — the KPIs read 0 until <code className="text-2xs">scripts/import-opp-months.ts</code>{' '}
					runs.
				</p>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				<div className="lg:col-span-2 space-y-3">
					{opps.error && (
						<Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
							<p className="text-sm text-red-700 dark:text-red-300">
								<strong>Could not read Media Opportunities:</strong> {opps.error}
							</p>
						</Card>
					)}
					{mismatch && (
						<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
							<p className="text-sm text-amber-800 dark:text-amber-300">
								The mirror counts {delivery.secured} secured this month, but no Media Opportunities matched the name &ldquo;
								{ctx.name}&rdquo;. The Client Media base may spell this client differently — check its Client Metrics row.
							</p>
						</Card>
					)}
					{STAGE_ORDER.filter((s) => s !== 'unmapped' || groups.unmapped.length > 0).map((stage) => {
						const rows = groups[stage];
						const meta = STAGE_TITLE[stage];
						return (
							<Card key={stage} padding="none" className="overflow-hidden">
								<h3 className="flex items-center gap-2 px-4 pt-3 pb-2 text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
									<span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} aria-hidden />
									{meta.title}
									<span className="rounded-full bg-slate-100 dark:bg-slate-700 px-1.5 text-xs tabular-nums text-slate-700 dark:text-slate-300 normal-case tracking-normal">
										{rows.length}
									</span>
								</h3>
								{rows.length === 0 ? (
									<p className="px-4 py-3 text-sm text-slate-500 border-t border-slate-200 dark:border-slate-700">{meta.empty}</p>
								) : (
									<OppTable rows={rows} />
								)}
							</Card>
						);
					})}
				</div>

				<aside className="space-y-3">
					<Card>
						<h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Secured by month</h4>
						<div className="space-y-2">
							{recent.map((iso, i) => {
								const t = recentTrend[i];
								const v = t?.secured_count ?? 0;
								const g = t?.goal ?? delivery.goal;
								const last = i === recent.length - 1;
								return (
									<div key={iso} className="grid grid-cols-[44px_1fr_32px] items-center gap-2 text-xs text-slate-500">
										<span>{monthLabel(iso)}</span>
										<div className="relative h-2 rounded-full bg-slate-200 dark:bg-slate-700">
											<div
												className={`absolute inset-y-0 left-0 rounded-full ${last ? 'bg-primary-500' : 'bg-primary-200 dark:bg-primary-800'}`}
												style={{ width: `${Math.round((v / maxSecured) * 100)}%` }}
											/>
											{g != null && g > 0 && (
												<div
													className="absolute -inset-y-[3px] w-0.5 bg-slate-700 dark:bg-slate-200"
													style={{ left: `${Math.min(100, Math.round((g / maxSecured) * 100))}%` }}
													aria-hidden
												/>
											)}
										</div>
										<span className="text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">{t ? v : '—'}</span>
									</div>
								);
							})}
						</div>
						<p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
							Marker = goal of record for that month. Same numbers as the Deliverables board.
						</p>
					</Card>
					<Card>
						<h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Sources</h4>
						<p className="text-xs text-slate-500 dark:text-slate-400">KPIs and bars: Supabase mirror of Client Media, synced daily.</p>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
							Opportunity list: Client Media → Media Opportunities, read live and matched by client name.
						</p>
					</Card>
				</aside>
			</div>
		</div>
	);
}
