// /clients/[id]/tracking - KPI progress for this client.
//
// Pulls from:
//   - Client Central -> Open Ronin Client Goals (Articles, Media Opps, Live Links,
//     Podcasts, Influencers, Speaking Opps - goal vs done per month)
//   - Client Media -> Client Metrics (Media Opp totals + Publicity Value
//     per brand)

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { requireClient, listByIds, findClientMetricsByName } from '../_lib';
import { BASE_IDS } from '@/lib/data';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { BarChart3, TrendingUp, Newspaper, Mic, Star, Headphones, FileText, Trophy, Target, CheckCircle2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
}

interface OrgGoalFields {
	'Client Name'?: string;
	Status?: string;
	'Due Date'?: string;
	Month?: string;
	'Articles Goal'?: number;
	'Articles Done'?: number;
	'Media Opps Goal'?: number;
	'Media Opps Secured'?: number;
	'Live Links'?: number;
	'Podcasts Goal'?: number;
	'Podcasts Secured'?: number;
	'Influencer Goal'?: number;
	'Influencers secured'?: number;
	'Speaking Opps Goal'?: number;
	'Speaking Opps Secured'?: number;
	'News Realease Goal'?: number;
	'News Releases Live'?: number;
	Created?: string;
}

interface ClientMetricFields {
	'Brand Name'?: string;
	'Total Ops'?: number;
	'#30'?: number;
	'Publicity Value'?: number;
	'Mth %'?: number;
	'Remaining Ops'?: number;
}

export default async function TrackingPage({ params }: PageProps) {
	const { id } = await params;
	const ctx = await requireClient(id, '/tracking');
	const f = ctx.fields;

	// multipleRecordLinks come back as string[] of rec ids from the REST API
	const goalIds = f['Open Ronin Client Goals copy'] ?? [];

	const [orgGoals, brandMetrics] = await Promise.all([
		listByIds<OrgGoalFields>(BASE_IDS.CLIENT_CENTRAL, 'Open Ronin Client Goals', goalIds),
		findClientMetricsByName(ctx.name),
	]);

	// Most recent goal record (by Created date) for the headline KPIs
	const sortedByDate = orgGoals
		.slice()
		.sort((a, b) => {
			const ca = a.fields.Created ?? '';
			const cb = b.fields.Created ?? '';
			return cb.localeCompare(ca);
		});
	const latest = sortedByDate[0];

	// Trailing-3-month and prior-3-month windows for the rollup split section
	const window3 = sortedByDate.slice(0, 3);
	const prior3 = sortedByDate.slice(3, 6);
	const sumWindow = sumGoalCategories(window3.map((g) => g.fields));
	const sumPrior = sumGoalCategories(prior3.map((g) => g.fields));
	const totalDone = sumWindow.doneByKey.reduce((acc, r) => acc + r.done, 0);
	const totalGoal = sumWindow.goalByKey.reduce((acc, r) => acc + r.goal, 0);
	const pct = totalGoal > 0 ? Math.round((totalDone / totalGoal) * 100) : null;
	const priorDone = sumPrior.doneByKey.reduce((acc, r) => acc + r.done, 0);
	const priorGoal = sumPrior.goalByKey.reduce((acc, r) => acc + r.goal, 0);
	const priorPct = priorGoal > 0 ? Math.round((priorDone / priorGoal) * 100) : null;
	const pctDelta = pct != null && priorPct != null ? pct - priorPct : null;
	const doneDelta = priorDone > 0 ? totalDone - priorDone : null;
	const months3 = window3
		.map((g) => g.fields.Month ?? formatDate(g.fields.Created, 'MMM yyyy'))
		.filter(Boolean);

	return (
		<div className="space-y-4">
			{/* Latest-month KPI grid */}
			{latest && (
				<>
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<BarChart3 className="w-4 h-4 text-slate-400" />
							Latest goals
						</h3>
						<span className="text-xs text-slate-400">
							{latest.fields.Month ?? formatDate(latest.fields.Created)}
							{latest.fields.Status && (
								<>
									{' · '}
									<Badge>{latest.fields.Status}</Badge>
								</>
							)}
						</span>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
						<KpiTile icon={<Newspaper className="w-3.5 h-3.5" />} label="Articles" done={latest.fields['Articles Done']} goal={latest.fields['Articles Goal']} />
						<KpiTile icon={<TrendingUp className="w-3.5 h-3.5" />} label="Media Opps" done={latest.fields['Media Opps Secured']} goal={latest.fields['Media Opps Goal']} />
						<KpiTile icon={<Star className="w-3.5 h-3.5" />} label="Live Links" done={latest.fields['Live Links']} />
						<KpiTile icon={<Headphones className="w-3.5 h-3.5" />} label="Podcasts" done={latest.fields['Podcasts Secured']} goal={latest.fields['Podcasts Goal']} />
						<KpiTile icon={<Trophy className="w-3.5 h-3.5" />} label="Influencers" done={latest.fields['Influencers secured']} goal={latest.fields['Influencer Goal']} />
						<KpiTile icon={<Mic className="w-3.5 h-3.5" />} label="Speaking" done={latest.fields['Speaking Opps Secured']} goal={latest.fields['Speaking Opps Goal']} />
					</div>
				</>
			)}

			{/* Cross-base: brand-level metrics */}
			{brandMetrics.length > 0 && (
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<FileText className="w-4 h-4 text-slate-400" />
							Per-brand metrics ({brandMetrics.length})
						</h3>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Source: Client Media &middot; Client Metrics</p>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="px-4 py-2 font-medium">Brand</th>
									<th className="px-4 py-2 font-medium text-right">Total Ops</th>
									<th className="px-4 py-2 font-medium text-right">Last 30d</th>
									<th className="px-4 py-2 font-medium text-right">Remaining</th>
									<th className="px-4 py-2 font-medium text-right">Pub. Value</th>
								</tr>
							</thead>
							<tbody>
								{brandMetrics.map((m) => {
									const mf = m.fields as ClientMetricFields;
									return (
										<tr key={m.id} className="border-b border-slate-200 dark:border-slate-700">
											<td className="px-4 py-2 text-slate-700 dark:text-slate-300">{mf['Brand Name'] ?? '—'}</td>
											<td className="px-4 py-2 text-right font-mono">{formatNumber(mf['Total Ops'])}</td>
											<td className="px-4 py-2 text-right font-mono">{formatNumber(mf['#30'])}</td>
											<td className="px-4 py-2 text-right font-mono">{formatNumber(mf['Remaining Ops'])}</td>
											<td className="px-4 py-2 text-right font-mono">{formatCurrency(mf['Publicity Value'])}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</Card>
			)}

			{/* Trailing-3-month rollup split section */}
			{orgGoals.length > 0 && (
				<Card padding="none" className="overflow-hidden">
					<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<BarChart3 className="w-4 h-4 text-slate-400" />
							Trailing 3-month rollup
						</h3>
						<span className="text-2xs text-slate-600 dark:text-slate-400">
							{months3.length > 0 ? months3.join(' · ') : 'Last 3 reported months'}
						</span>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-700">
						{/* LEFT: Completion total */}
						<div className="p-4">
							<div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
								<CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
								Completion total
							</div>
							<div className="flex flex-wrap items-baseline gap-2">
								<span className="text-3xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatNumber(totalDone)}</span>
								<span className="text-xs text-slate-400">of {formatNumber(totalGoal)} goal</span>
								{doneDelta != null && (
									<Badge color={doneDelta >= 0 ? 'success' : 'danger'} className="text-2xs">
										{doneDelta >= 0 ? '+' : ''}{formatNumber(doneDelta)} vs prior 3mo
									</Badge>
								)}
							</div>
							<div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
								{sumWindow.doneByKey.map((cat) => {
									const g = sumWindow.goalByKey.find((x) => x.key === cat.key)?.goal ?? 0;
									if (cat.done === 0 && g === 0) return null;
									return (
										<div key={cat.key} className="flex items-center justify-between text-2xs">
											<span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 truncate">
												<span className="opacity-70">{cat.icon}</span>
												{cat.label}
											</span>
											<span className="font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
												{cat.done}{g > 0 && <span className="text-slate-400"> / {g}</span>}
											</span>
										</div>
									);
								})}
							</div>
						</div>

						{/* RIGHT: % of monthly target */}
						<div className="p-4">
							<div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
								<Target className="w-3.5 h-3.5 text-primary-500" />
								% of monthly targets
							</div>
							<div className="flex flex-wrap items-baseline gap-2">
								<span className={pctClass(pct)}>{pct == null ? '—' : pct + '%'}</span>
								{pct != null && pct >= 125 && (
									<Badge color="success" className="text-2xs">Above Open Ronin 125% target</Badge>
								)}
								{pctDelta != null && (
									<Badge color={pctDelta >= 0 ? 'success' : 'danger'} className="text-2xs">
										{pctDelta >= 0 ? '+' : ''}{pctDelta}pp vs prior 3mo
									</Badge>
								)}
							</div>
							{pct != null && (
								<div className="mt-3 h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden relative">
									<div className={'absolute inset-y-0 left-0 ' + barClass(pct)} style={{ width: Math.min(150, pct) + '%' }} />
									<div className="absolute top-0 bottom-0 w-px bg-slate-400/60 dark:bg-slate-500/60" style={{ left: Math.min(100, 100 * (100 / Math.max(150, pct))) + '%' }} />
								</div>
							)}
							<div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
								{sumWindow.goalByKey.map((cat) => {
									const done = sumWindow.doneByKey.find((x) => x.key === cat.key)?.done ?? 0;
									if (cat.goal === 0) return null;
									const catPct = Math.round((done / cat.goal) * 100);
									return (
										<div key={cat.key} className="flex items-center justify-between text-2xs">
											<span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 truncate">
												<span className="opacity-70">{cat.icon}</span>
												{cat.label}
											</span>
											<span className={'font-mono whitespace-nowrap ' + catPctClass(catPct)}>
												{catPct}%
											</span>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</Card>
			)}

			{/* Goal history table */}
			{orgGoals.length > 0 && (
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Goal history ({orgGoals.length} months)</h3>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
									<th className="px-4 py-2 font-medium">Month</th>
									<th className="px-4 py-2 font-medium text-right">Articles</th>
									<th className="px-4 py-2 font-medium text-right">Media Opps</th>
									<th className="px-4 py-2 font-medium text-right">Live</th>
									<th className="px-4 py-2 font-medium text-right">Podcasts</th>
									<th className="px-4 py-2 font-medium">Status</th>
								</tr>
							</thead>
							<tbody>
								{sortedByDate.map((g) => (
									<tr key={g.id} className="border-b border-slate-200 dark:border-slate-700">
										<td className="px-4 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">{g.fields.Month ?? formatDate(g.fields.Created)}</td>
										<td className="px-4 py-2 text-right font-mono"><RatioCell done={g.fields['Articles Done']} goal={g.fields['Articles Goal']} /></td>
										<td className="px-4 py-2 text-right font-mono"><RatioCell done={g.fields['Media Opps Secured']} goal={g.fields['Media Opps Goal']} /></td>
										<td className="px-4 py-2 text-right font-mono">{formatNumber(g.fields['Live Links'])}</td>
										<td className="px-4 py-2 text-right font-mono"><RatioCell done={g.fields['Podcasts Secured']} goal={g.fields['Podcasts Goal']} /></td>
										<td className="px-4 py-2">{g.fields.Status && <Badge>{g.fields.Status}</Badge>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			)}

			{orgGoals.length === 0 && brandMetrics.length === 0 && (
				<Card>
					<p className="text-sm text-slate-400 text-center py-6">No tracking data on file for this client yet.</p>
				</Card>
			)}
		</div>
	);
}

function KpiTile({ icon, label, done, goal }: { icon: React.ReactNode; label: string; done?: number; goal?: number }) {
	const d = done ?? 0;
	const g = goal ?? 0;
	const pct = g > 0 ? Math.min(100, Math.round((d / g) * 100)) : null;
	const color = pct == null ? 'bg-slate-300' : pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-amber-500' : 'bg-primary-500';
	return (
		<div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
			<div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">{icon}{label}</div>
			<div className="flex items-baseline gap-1">
				<span className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{d}</span>
				{g > 0 && <span className="text-xs text-slate-400">/ {g}</span>}
			</div>
			{pct != null && (
				<div className="mt-2 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
					<div className={'h-full ' + color + ' rounded-full'} style={{ width: pct + '%' }} />
				</div>
			)}
		</div>
	);
}

// Categories used by the trailing-3-month rollup. Order mirrors the per-month
// KPI tile order so labels line up visually.
const ROLLUP_CATEGORIES: { key: string; label: string; doneKey: keyof OrgGoalFields; goalKey?: keyof OrgGoalFields; icon: React.ReactNode }[] = [
	{ key: 'articles', label: 'Articles', doneKey: 'Articles Done', goalKey: 'Articles Goal', icon: <Newspaper className="w-3 h-3" /> },
	{ key: 'media_opps', label: 'Media Opps', doneKey: 'Media Opps Secured', goalKey: 'Media Opps Goal', icon: <TrendingUp className="w-3 h-3" /> },
	{ key: 'live_links', label: 'Live Links', doneKey: 'Live Links', icon: <Star className="w-3 h-3" /> },
	{ key: 'podcasts', label: 'Podcasts', doneKey: 'Podcasts Secured', goalKey: 'Podcasts Goal', icon: <Headphones className="w-3 h-3" /> },
	{ key: 'influencers', label: 'Influencers', doneKey: 'Influencers secured', goalKey: 'Influencer Goal', icon: <Trophy className="w-3 h-3" /> },
	{ key: 'speaking', label: 'Speaking', doneKey: 'Speaking Opps Secured', goalKey: 'Speaking Opps Goal', icon: <Mic className="w-3 h-3" /> },
	{ key: 'releases', label: 'News Releases', doneKey: 'News Releases Live', goalKey: 'News Realease Goal', icon: <FileText className="w-3 h-3" /> },
];

function sumGoalCategories(records: OrgGoalFields[]): {
	doneByKey: { key: string; label: string; done: number; icon: React.ReactNode }[];
	goalByKey: { key: string; label: string; goal: number; icon: React.ReactNode }[];
} {
	const doneByKey = ROLLUP_CATEGORIES.map((c) => {
		const done = records.reduce((acc, r) => acc + (Number(r[c.doneKey]) || 0), 0);
		return { key: c.key, label: c.label, done, icon: c.icon };
	});
	const goalByKey = ROLLUP_CATEGORIES.map((c) => {
		const goal = c.goalKey ? records.reduce((acc, r) => acc + (Number(r[c.goalKey!]) || 0), 0) : 0;
		return { key: c.key, label: c.label, goal, icon: c.icon };
	});
	return { doneByKey, goalByKey };
}

function pctClass(pct: number | null): string {
	const base = 'text-3xl font-semibold tabular-nums';
	if (pct == null) return base + ' text-slate-300';
	if (pct >= 125) return base + ' text-green-600 dark:text-green-400';
	if (pct >= 100) return base + ' text-green-500';
	if (pct >= 75) return base + ' text-amber-600';
	return base + ' text-slate-700 dark:text-slate-300';
}

function barClass(pct: number): string {
	if (pct >= 125) return 'bg-green-500';
	if (pct >= 100) return 'bg-green-400';
	if (pct >= 75) return 'bg-amber-500';
	return 'bg-primary-500';
}

function catPctClass(pct: number): string {
	if (pct >= 125) return 'text-green-600';
	if (pct >= 100) return 'text-green-500';
	if (pct >= 75) return 'text-amber-600';
	return 'text-slate-500';
}

function RatioCell({ done, goal }: { done?: number; goal?: number }) {
	if (done == null && goal == null) return <span className="text-slate-300">&mdash;</span>;
	if (goal == null || goal === 0) return <>{formatNumber(done)}</>;
	const pct = Math.round(((done ?? 0) / goal) * 100);
	return (
		<>
			<span className="text-slate-900 dark:text-slate-100">{done ?? 0}</span>
			<span className="text-slate-400"> / {goal}</span>
			<span className={'ml-1 text-2xs ' + (pct >= 100 ? 'text-green-600' : pct >= 75 ? 'text-amber-600' : 'text-slate-600 dark:text-slate-400')}>{pct}%</span>
		</>
	);
}
