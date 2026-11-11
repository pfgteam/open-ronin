// /clients/analytics — Portfolio and per client analytics from the mirror.
//
// Every figure is a column of a 0071 view (v_portfolio_*, v_client_*); this
// file formats and lays out. No Airtable reads. Two views share the route:
//   /clients/analytics            portfolio
//   /clients/analytics?client=<uuid> per client (clients_v2.id, the same key
//                                 /clients/[id] uses; a legacy Airtable
//                                 record id 308s to the client id)
// CSV of the current view: /clients/analytics/export with the same params.
//
// Grain: the opps mirror (client_opp_months) is monthly, so the "12 week"
// trend the spec names is served as the trailing 12 months and labelled so;
// weekly buckets exist only for live_links (v_live_links_weekly).

import Link from 'next/link';
import { permanentRedirect } from 'next/navigation';
import { Download } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { BarChart, ChartLegend, LineChart, StackedBarChart } from '@/components/dashboard/charts';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { loadClient, loadPortfolio, monthLabel, type ContractRow } from '@/lib/clients/analytics';
import { isAirtableRecordId } from '@/lib/clients/key';
import { clientIdForAirtableContract } from '@/lib/clients/server';
import ClientPicker from './ClientPicker';
import { Kpi, MirrorEmpty, SectionLabel, td, tdNum, th, thNum, tr } from './_ui';

export const metadata = { title: 'Client Analytics' };
export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`);
const cents = (v: number | null | undefined) => (v == null ? '—' : formatCurrency(v / 100));

function exportHref(client: string | null): string {
	return client ? `/clients/analytics/export?client=${encodeURIComponent(client)}` : '/clients/analytics/export';
}

function ExportLink({ client }: { client: string | null }) {
	return (
		<Link
			href={exportHref(client)}
			className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
			prefetch={false}
		>
			<Download className="w-3.5 h-3.5" />
			Export CSV
		</Link>
	);
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
	const sp = await searchParams;
	const client = typeof sp.client === 'string' && sp.client ? sp.client : null;

	// Old ?client=recXXX links (bookmarks, the CSV footer) 308 to the client id.
	if (client && isAirtableRecordId(client)) {
		const clientId = await clientIdForAirtableContract(client);
		if (clientId) permanentRedirect(`/clients/analytics?client=${clientId}`);
	}

	// The picker needs the contract list on both views.
	const portfolio = await loadPortfolio();
	const pickerOptions = portfolio.contracts.map((c) => ({
		value: c.client_id,
		label: c.display_name,
		family: c.package_family,
	}));

	if (client) {
		const data = await loadClient(client);
		return (
			<ClientView
				client={client}
				contract={data.contract}
				data={data}
				picker={<ClientPicker options={pickerOptions} value={client} />}
			/>
		);
	}

	return <PortfolioView data={portfolio} picker={<ClientPicker options={pickerOptions} value="" />} />;
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

function PortfolioView({
	data,
	picker,
}: {
	data: Awaited<ReturnType<typeof loadPortfolio>>;
	picker: React.ReactNode;
}) {
	const labels = data.months.map(monthLabel);
	const secured = data.trend.map((r) => r?.secured_count ?? null);
	const live = data.trend.map((r) => r?.live_count ?? null);
	const goal = data.trend.map((r) => r?.goal_total ?? null);
	const latest = [...data.trend].reverse().find((r) => r != null) ?? null;
	const synced = data.trend.reduce<string | null>((acc, r) => (r?.synced_at && (!acc || r.synced_at > acc) ? r.synced_at : acc), null);
	const inScope = data.contracts.length;
	const withQuota = data.contracts.filter((c) => c.package_quota != null).length;
	const monthlyQuota = data.packageMix.reduce((s, m) => s + (m.monthly_quota_total ?? 0), 0);
	const linksTotal = data.liveLinksWeekly.reduce((s, w) => s + w.live_links, 0);
	const hasLinks = linksTotal > 0;

	const familyTone = (f: string): 'primary' | 'success' | 'accent' | 'muted' =>
		f === 'High Visibility' ? 'primary' : f === 'Grow & Scale' ? 'success' : f === 'Beacon' ? 'accent' : 'muted';
	const badgeTone = (f: string) => {
		const t = familyTone(f);
		return t === 'muted' ? 'default' : t;
	};

	return (
		<>
			<PageHeader
				title="Client Analytics"
				description={
					<>
						Portfolio · {inScope} contracts in scope · mirror synced {synced ? formatDate(synced, 'MMM d, h:mm a') : 'never'}
					</>
				}
				actions={
					<>
						{picker}
						<ExportLink client={null} />
					</>
				}
			/>

			{data.error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {data.error}
					</p>
				</Card>
			)}

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
				<Kpi
					label={`Secured · ${latest ? monthLabel(latest.month) : 'latest'}`}
					value={formatNumber(latest?.secured_count)}
					hint={latest?.goal_total != null ? `${pct(latest.secured_pct_of_goal)} of ${formatNumber(latest.goal_total)} goal` : 'no goal of record'}
				/>
				<Kpi label={`Live · ${latest ? monthLabel(latest.month) : 'latest'}`} value={formatNumber(latest?.live_count)} hint="Live Link non empty, by live month" />
				<Kpi label="Monthly quota" value={formatNumber(monthlyQuota)} hint={`${withQuota} of ${inScope} contracts carry an R1 quota`} />
				<Kpi
					label="Payments on time"
					value={pct(data.payments?.on_time_pct)}
					hint={
						data.payments
							? `${data.payments.on_time_count} on time · ${data.payments.late_count} late · trailing 6 months`
							: 'no payment rows'
					}
				/>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
				<Card className="lg:col-span-2">
					<SectionLabel>Placement trend · trailing 12 months</SectionLabel>
					{data.trend.some((r) => r != null) ? (
						<>
							<LineChart
								series={[
									{ label: 'Secured (R3)', values: secured, tone: 'primary' },
									{ label: 'Live', values: live, tone: 'success' },
									{ label: 'Goal of record', values: goal, tone: 'warning', dashed: true },
								]}
								labels={labels}
								height={200}
								title="Secured and live opportunities per month across every synced contract"
							/>
							<div className="mt-2 flex items-center justify-between gap-4">
								<ChartLegend
									items={[
										{ label: 'Secured', tone: 'primary' },
										{ label: 'Live', tone: 'success' },
										{ label: 'Goal of record', tone: 'warning', dashed: true },
									]}
								/>
								<span className="text-2xs text-slate-600 dark:text-slate-400">Month grain: the mirror aggregates per contract month.</span>
							</div>
						</>
					) : (
						<MirrorEmpty table="client_opp_months" importer="scripts/import-opp-months.ts" />
					)}
				</Card>

				<Card>
					<SectionLabel count={inScope}>Active clients by package</SectionLabel>
					{data.packageMix.length ? (
						<>
							<StackedBarChart
								series={data.packageMix.map((m) => ({
									label: m.package_family,
									values: [m.contracts],
									tone: familyTone(m.package_family),
								}))}
								labels={['In scope']}
								height={120}
								title="Contracts in scope by package family"
							/>
							<div className="overflow-x-auto">
							<table className="w-full mt-2">
								<tbody>
									{data.packageMix.map((m) => (
										<tr key={m.package_family} className={tr}>
											<td className={td}>
												<Badge color={badgeTone(m.package_family)}>{m.package_family}</Badge>
											</td>
											<td className={tdNum}>{m.contracts}</td>
											<td className={tdNum}>{m.monthly_quota_each != null ? `${m.monthly_quota_each}/mo` : 'no quota'}</td>
											<td className={tdNum}>{cents(m.per_month_cents_total)}</td>
										</tr>
									))}
								</tbody>
							</table>
							</div>
						</>
					) : (
						<MirrorEmpty table="contracts" importer="scripts/import-payments.ts (contracts seed)" />
					)}
				</Card>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
				<Card>
					<SectionLabel>Secured versus goal · portfolio</SectionLabel>
					{data.trend.some((r) => r != null) ? (
						<>
							<BarChart
								values={data.trend.map((r) => r?.secured_toward_goal ?? null)}
								overlay={{ label: 'Goal total', values: goal, tone: 'warning', dashed: true }}
								labels={labels}
								titles={data.trend.map((r) =>
									r ? `${monthLabel(r.month)}: ${r.secured_toward_goal ?? 0} secured of ${r.goal_total ?? 0} goal (${r.contracts_with_goal} contracts)` : 'not synced',
								)}
								height={160}
								title="Secured opportunities against the summed goal of record, contracts with a goal only"
							/>
							<p className="mt-2 text-2xs text-slate-600 dark:text-slate-400">
								Counts only contracts with a goal of record (Client Goals row, else the R1 tier default). Beacon only packages carry no quota.
							</p>
						</>
					) : (
						<MirrorEmpty table="client_goals" importer="scripts/import-client-goals.ts" />
					)}
				</Card>

				<Card>
					<SectionLabel>Live links per week · last 12 weeks</SectionLabel>
					{hasLinks ? (
						<>
							<BarChart
								values={data.liveLinksWeekly.map((w) => w.live_links)}
								labels={data.liveLinksWeekly.map((w, i) => (i % 2 === 0 ? formatDate(w.week_start, 'M/d') : ''))}
								titles={data.liveLinksWeekly.map((w) => `${formatDate(w.week_start, 'MMM d')}: ${w.live_links} live, ${w.tier_one_links} tier one`)}
								tone="success"
								height={160}
								title="Live links per ISO week"
							/>
							<div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
								<span>{linksTotal} links</span>
								<span>{data.liveLinksWeekly.reduce((s, w) => s + w.tier_one_links, 0)} tier one</span>
								<span>{formatNumber(data.liveLinksWeekly.reduce((s, w) => s + (w.reach ?? 0), 0))} reach</span>
							</div>
						</>
					) : (
						<MirrorEmpty table="live_links" importer="the live links ingest (/api/ingest/live-links)" />
					)}
				</Card>
			</div>

			<Card>
				<SectionLabel>Tier one share of placements</SectionLabel>
				{data.tierShare.some((r) => r != null) ? (
					<LineChart
						series={[{ label: 'Tier one %', values: data.tierShare.map((r) => r?.tier_one_pct ?? null), tone: 'primary' }]}
						labels={labels}
						height={140}
						yFmt={(v) => `${Math.round(v)}%`}
						title="Share of live links tagged tier one, per month"
					/>
				) : (
					<MirrorEmpty table="live_links" importer="the live links ingest (/api/ingest/live-links)" />
				)}
			</Card>

			<Card className="mt-6" padding="none">
				<div className="px-4 pt-4">
					<SectionLabel count={inScope}>Contracts in scope</SectionLabel>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className={th}>Client</th>
								<th className={th}>Package</th>
								<th className={thNum}>Quota</th>
								<th className={thNum}>Goal this month</th>
								<th className={thNum}>Last secured</th>
								<th className={thNum}>Renewal</th>
								<th className={thNum}>Per month</th>
							</tr>
						</thead>
						<tbody>
							{data.contracts.map((c) => (
								<tr key={c.contract_id} className={tr}>
									<td className={td}>
										<Link href={`/clients/analytics?client=${encodeURIComponent(c.client_id)}`} className="text-primary-700 dark:text-primary-400 hover:underline">
											{c.display_name}
										</Link>
									</td>
									<td className={td}>{c.package ?? '—'}</td>
									<td className={tdNum}>{c.package_quota ?? '—'}</td>
									<td className={tdNum}>
										{c.current_month_goal ?? '—'}
										{c.current_month_goal_source && <span className="ml-1 text-2xs text-slate-600 dark:text-slate-400">{c.current_month_goal_source}</span>}
									</td>
									<td className={tdNum}>{c.last_secured_month ? monthLabel(c.last_secured_month) : 'none synced'}</td>
									<td className={tdNum}>{c.renewal_on ? formatDate(c.renewal_on) : '—'}</td>
									<td className={tdNum}>{cents(c.per_month_cents)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Card>
		</>
	);
}

// ---------------------------------------------------------------------------
// Per client
// ---------------------------------------------------------------------------

function ClientView({
	client,
	contract,
	data,
	picker,
}: {
	client: string;
	contract: ContractRow | null;
	data: Awaited<ReturnType<typeof loadClient>>;
	picker: React.ReactNode;
}) {
	if (!contract) {
		return (
			<>
				<PageHeader title="Client Analytics" description="Per client" actions={picker} />
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						No in scope contract for client <code className="text-xs">{client}</code>. Analytics cover active, hold and 60 day contracts with an Airtable contract id.
					</p>
				</Card>
			</>
		);
	}

	const labels = data.months.map(monthLabel);
	const secured = data.trend.map((r) => r?.secured_count ?? null);
	const live = data.trend.map((r) => r?.live_count ?? null);
	const quota = contract.package_quota;
	const goalLine = data.trend.map((r) => r?.goal ?? quota ?? null);
	const latest = [...data.trend].reverse().find((r) => r != null) ?? null;
	const pay = data.payments;

	return (
		<>
			<PageHeader
				title={contract.display_name}
				description={
					<>
						{contract.package ?? 'No package'} · {contract.status} ·{' '}
						<Link href={`/clients/${contract.client_id}`} className="text-primary-700 dark:text-primary-400 hover:underline">
							client page
						</Link>
					</>
				}
				actions={
					<>
						{picker}
						<ExportLink client={client} />
					</>
				}
			/>

			{data.error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {data.error}
					</p>
				</Card>
			)}

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
				<Kpi
					label={`Secured · ${latest ? monthLabel(latest.month) : 'latest'}`}
					value={formatNumber(latest?.secured_count)}
					hint={latest?.goal != null ? `${pct(latest.secured_pct_of_goal)} of ${latest.goal} · ${latest.goal_source}` : 'no goal of record'}
				/>
				<Kpi
					label="Days since last opportunity"
					value={contract.days_since_last_secured ?? '—'}
					hint={contract.last_secured_month ? `last secured in ${monthLabel(contract.last_secured_month)} (month grain)` : 'no secured opp in the mirror'}
				/>
				<Kpi
					label="Payment timeliness"
					value={pay?.measured ? pct(pay.on_time_pct) : '—'}
					hint={
						pay
							? pay.measured
								? `${pay.on_time_count} on time · ${pay.late_count} late${pay.unpaid_late_count ? ` · ${pay.unpaid_late_count} unpaid past due` : ''}`
								: 'fewer than 2 eligible rows in 6 months'
							: 'no payment rows'
					}
				/>
				<Kpi
					label="Renewal"
					value={contract.renewal_on ? formatDate(contract.renewal_on, 'MMM d, yyyy') : '—'}
					hint={
						contract.term_months != null
							? `${contract.term_months} month term from ${formatDate(contract.starts_on)}`
							: contract.starts_on
								? `evergreen since ${formatDate(contract.starts_on)}, yearly anniversary`
								: 'no start date on file'
					}
				/>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
				<Card className="lg:col-span-2">
					<SectionLabel>Secured versus goal by month</SectionLabel>
					{data.trend.some((r) => r != null) ? (
						<>
							<BarChart
								values={secured}
								overlay={{ label: quota != null ? `Package quota (${quota}/mo)` : 'Goal of record', values: goalLine, tone: 'warning', dashed: true }}
								labels={labels}
								titles={data.trend.map((r) =>
									r ? `${monthLabel(r.month)}: ${r.secured_count} secured of ${r.goal ?? 'no'} goal (${r.goal_source ?? 'none'})` : 'not synced',
								)}
								height={200}
								title={`Secured opportunities per month against the ${contract.package_family} quota`}
							/>
							<div className="mt-2 flex items-center justify-between gap-4">
								<ChartLegend
									items={[
										{ label: 'Secured (R3)', tone: 'primary' },
										{ label: quota != null ? `Quota ${quota}/mo` : 'Goal of record', tone: 'warning', dashed: true },
									]}
								/>
								{quota == null && <span className="text-2xs text-slate-600 dark:text-slate-400">This package carries no R1 opps quota.</span>}
							</div>
						</>
					) : (
						<MirrorEmpty table="client_opp_months" importer="scripts/import-opp-months.ts" />
					)}
				</Card>

				<Card>
					<SectionLabel>Live placements</SectionLabel>
					{data.trend.some((r) => r != null) ? (
						<>
							<BarChart values={live} labels={labels.map((l, i) => (i % 3 === 0 ? l : ''))} tone="success" height={120} title="Live placements per month" />
							<dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
								<dt className="text-slate-500">Last 12 months</dt>
								<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{formatNumber(live.reduce<number>((s, v) => s + (v ?? 0), 0))}</dd>
								<dt className="text-slate-500">Live link rows</dt>
								<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{formatNumber(data.liveLinkCount)}</dd>
								<dt className="text-slate-500">Last live month</dt>
								<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{contract.last_live_month ? monthLabel(contract.last_live_month) : '—'}</dd>
							</dl>
						</>
					) : (
						<MirrorEmpty table="client_opp_months" importer="scripts/import-opp-months.ts" />
					)}
				</Card>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<Card padding="none">
					<div className="px-4 pt-4">
						<SectionLabel>Monthly detail</SectionLabel>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className={th}>Month</th>
								<th className={thNum}>Secured</th>
								<th className={thNum}>Live</th>
								<th className={thNum}>Goal</th>
								<th className={thNum}>% of goal</th>
							</tr>
						</thead>
						<tbody>
							{data.months.map((m, i) => {
								const r = data.trend[i];
								return (
									<tr key={m} className={tr}>
										<td className={td}>{monthLabel(m)}</td>
										<td className={tdNum}>{r ? r.secured_count : <span className="text-slate-400">not synced</span>}</td>
										<td className={tdNum}>{r ? r.live_count : ''}</td>
										<td className={tdNum}>
											{r?.goal ?? '—'}
											{r?.goal_source && <span className="ml-1 text-2xs text-slate-600 dark:text-slate-400">{r.goal_source}</span>}
										</td>
										<td className={tdNum}>{pct(r?.secured_pct_of_goal)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				</Card>

				<div className="space-y-4">
					<Card>
						<SectionLabel>Contract</SectionLabel>
						<dl className="grid grid-cols-2 gap-y-1 text-xs">
							<dt className="text-slate-500">Package</dt>
							<dd className="text-right text-slate-900 dark:text-slate-100">{contract.package ?? '—'}</dd>
							<dt className="text-slate-500">Quota</dt>
							<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{quota != null ? `${quota} opps/mo` : 'none (R1)'}</dd>
							<dt className="text-slate-500">Per month</dt>
							<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{cents(contract.per_month_cents)}</dd>
							<dt className="text-slate-500">Start</dt>
							<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{formatDate(contract.starts_on)}</dd>
							<dt className="text-slate-500">End</dt>
							<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{contract.ends_on ? formatDate(contract.ends_on) : 'open'}</dd>
							<dt className="text-slate-500">Next payment due</dt>
							<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{pay?.next_due_on ? formatDate(pay.next_due_on) : '—'}</dd>
							<dt className="text-slate-500">Last paid</dt>
							<dd className="text-right tabular-nums text-slate-900 dark:text-slate-100">{pay?.last_paid_on ? formatDate(pay.last_paid_on) : '—'}</dd>
						</dl>
					</Card>

					<Card>
						<SectionLabel count={data.topOutlets.length || undefined}>Top outlets</SectionLabel>
						{data.topOutlets.length ? (
							<div className="overflow-x-auto">
							<table className="w-full">
								<tbody>
									{data.topOutlets.map((o) => (
										<tr key={o.outlet} className={tr}>
											<td className={td}>{o.outlet}</td>
											<td className={tdNum}>{o.live_links}</td>
											<td className={tdNum}>{o.last_live_on ? formatDate(o.last_live_on) : '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
							</div>
						) : (
							<MirrorEmpty table="live_links" importer="the live links ingest (/api/ingest/live-links)" />
						)}
					</Card>
				</div>
			</div>
		</>
	);
}
