// /clients/[id] — Overview tab. [id] is clients_v2.id. Reads the primary
// contract from Airtable + client_meta from Supabase (keyed by the primary
// contract's Airtable id) to surface narrative content, scope flags, links,
// and the computed health summary.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { stageColor, isLive } from '@/lib/media/status';
import { requireClient, findRecentPlacementsByContractName } from './_lib';
import { getClientHealth } from '@/lib/health/server';
import { healthTone } from '@/lib/health/shared';
import { formatCurrency, formatDate } from '@/lib/format';
import Link from 'next/link';
import {
	Activity,
	Calendar,
	Mail,
	ExternalLink,
	TrendingUp,
	FileText,
	Pencil,
	Globe,
	Cake,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ClientMetaRow {
	airtable_contract_id: string;
	contract_legal_name: string | null;
	website_url: string | null;
	brand_anniversary: string | null;
	client_calendar_url: string | null;
	context_md: string | null;
	story_md: string | null;
	history_md: string | null;
	pr_goals_md: string | null;
	contracted_deliverables_md: string | null;
	feedback_md: string | null;
	has_influencer: boolean;
	has_social: boolean;
	has_awards: boolean;
	has_podcasts: boolean;
	notice_period_days: number;
	first_live_link_url: string | null;
	first_national_url: string | null;
	links: Record<string, string> | null;
}

const LINK_LABELS: Record<string, string> = {
	drive: 'Drive',
	strategy: 'Strategy',
	twelve_week: '12-Week Plan',
	friday_recap: 'Friday Recap',
	monthly_report: 'Monthly Report',
	call_agenda: 'Call Agenda',
	product_tracker: 'Product Tracker',
	media_tracker: 'Media Tracker',
	assignments: 'Assignments',
	strategy_survey: 'Strategy Survey',
	termination_letter: 'Termination',
	pause_report: 'Pause Report',
	media_assets: 'Media Assets',
};

interface PageProps {
	params: Promise<{ id: string }>;
}

export default async function OverviewPage({ params }: PageProps) {
	const { id } = await params;
	const ctx = await requireClient(id);
	const f = ctx.fields;
	const clientId = ctx.clientId;

	const supabase = await createClient();
	const [{ data: metaRow }, placements, health] = await Promise.all([
		ctx.airtableId
			? supabase.from('client_meta').select('*').eq('airtable_contract_id', ctx.airtableId).maybeSingle()
			: Promise.resolve({ data: null }),
		findRecentPlacementsByContractName(ctx.name, 90),
		getClientHealth(clientId),
	]);

	const meta = (metaRow ?? null) as ClientMetaRow | null;
	// Live is a property (Live Link non-empty), never a Status token — the old
	// `Status === 'Live'` test matched nothing, so the snapshot read "0 of N"
	// above a table of rows visibly carrying live links.
	const livePlacements = placements.filter((p) =>
		isLive((p.fields as { 'Live Link'?: string })['Live Link']),
	);

	const linkedCounts = {
		mediaOpps: f['Media Opps']?.length ?? 0,
		assignments: f['Current Assignments']?.length ?? 0,
		twelveWeek: f['12 Week Goals']?.length ?? 0,
		payments: f.Payments?.length ?? 0,
	};

	const scopeBadges: { label: string; on: boolean }[] = [
		{ label: 'Influencer', on: meta?.has_influencer ?? false },
		{ label: 'Social', on: meta?.has_social ?? false },
		{ label: 'Awards', on: meta?.has_awards ?? false },
		{ label: 'Podcasts', on: meta?.has_podcasts ?? false },
	];

	const linkEntries = Object.entries(meta?.links ?? {}).filter(([, v]) => v);

	return (
		<>
			<div className="flex items-center justify-end mb-3 -mt-2">
				<Link
					href={`/clients/${clientId}/edit`}
					className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-hover text-slate-700 dark:text-slate-300 transition-colors"
				>
					<Pencil className="w-3 h-3" />
					Edit profile
				</Link>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				{/* Health — the computed score, read through contracts (client_id -> airtable_contract_id) */}
				<Card className="lg:col-span-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
								<Activity className="w-4 h-4 text-slate-400" />
								Health score
							</h3>
							{health?.total_score != null ? (
								<Badge color={healthTone(health.total_score)}>{health.total_score}</Badge>
							) : (
								<Badge color="default">Unmeasured</Badge>
							)}
							{health && (
								<span className="text-xs text-slate-500 dark:text-slate-400">
									{health.is_current_month ? 'Current month' : `As of ${formatDate(health.period_month)}`}
									{health.coverage
										? ` · ${health.coverage.measured_count} of ${health.coverage.total_count} factors measured (${health.coverage.weight_measured_pct}% of weight)`
										: ''}
								</span>
							)}
							{!health && (
								<span className="text-xs text-slate-500 dark:text-slate-400">
									{ctx.airtableId ? 'No score computed yet for this client\u2019s contracts.' : 'No contract on file to score.'}
								</span>
							)}
						</div>
						<Link href={`/clients/${clientId}/health`} className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1">
							Factor breakdown <ExternalLink className="w-3 h-3" />
						</Link>
					</div>
					{health && (
						<div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
							{health.factors.map((fac) => (
								<div
									key={fac.key}
									className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-2"
									title={fac.measured ? fac.description : (fac.note ?? fac.pending ?? fac.description)}
								>
									<p className="text-2xs uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate">{fac.label}</p>
									<p className="text-sm font-mono text-slate-900 dark:text-slate-100">
										{fac.measured ? fac.value : <span className="text-slate-400">—</span>}
										<span className="text-2xs text-slate-400"> · {fac.weight_pct}%</span>
									</p>
									<p className="text-2xs text-slate-500 dark:text-slate-400">
										{fac.measured ? 'measured' : fac.future ? 'later' : 'unmeasured'}
									</p>
								</div>
							))}
						</div>
					)}
				</Card>

				{/* Activity snapshot */}
				<Card>
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
						<TrendingUp className="w-4 h-4 text-slate-400" />
						Activity snapshot
					</h3>
					<dl className="space-y-2 text-sm">
						<Row label="Media opps" value={String(linkedCounts.mediaOpps)} />
						<Row
							label="Live placements (90d)"
							value={`${livePlacements.length} of ${placements.length}`}
						/>
						<Row label="Active assignments" value={String(linkedCounts.assignments)} />
						<Row label="12-week goals" value={String(linkedCounts.twelveWeek)} />
						<Row label="Payments on record" value={String(linkedCounts.payments)} />
					</dl>
				</Card>

				{/* Contract */}
				<Card>
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
						<Calendar className="w-4 h-4 text-slate-400" />
						Contract
					</h3>
					<dl className="space-y-2 text-sm">
						<Row label="Retainer" value={formatCurrency(f['Per Month'])} />
						<Row label="Notice term" value={`${meta?.notice_period_days ?? 60} days`} />
						<Row label="Signed (SOW)" value={formatDate(f['SOW Date(Signup)'])} />
						<Row label="1st payment" value={formatDate(f['1st Payment'])} />
						<Row label="Kickoff" value={formatDate(f['Kickoff(Service Start)'])} />
						{meta?.brand_anniversary && (
							<Row
								label="Brand anniversary"
								value={formatDate(meta.brand_anniversary)}
							/>
						)}
						{f['End of Service'] && (
							<Row label="Ended" value={formatDate(f['End of Service'])} />
						)}
					</dl>
				</Card>

				{/* Contacts */}
				<Card>
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
						<Mail className="w-4 h-4 text-slate-400" />
						Contacts
					</h3>
					<dl className="space-y-2 text-sm">
						<Row label="POC email" value={f['POC Email'] ?? '—'} />
						<Row label="Billing email" value={f['Billing Email'] ?? '—'} />
						<Row label="Billing PoC" value={f['Billing PoC'] ?? '—'} />
						{meta?.website_url && (
							<div className="flex items-baseline justify-between gap-2">
								<dt className="text-xs text-slate-500">Website</dt>
								<dd className="text-sm">
									<a
										href={meta.website_url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary-600 hover:underline inline-flex items-center gap-1"
									>
										<Globe className="w-3 h-3" />
										open
									</a>
								</dd>
							</div>
						)}
					</dl>
				</Card>

				{/* Scope flags + Resource links */}
				<Card className="lg:col-span-2">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
						Deliverable scope
					</h3>
					<div className="flex flex-wrap gap-2">
						{scopeBadges.map((s) => (
							<Badge key={s.label} color={s.on ? 'success' : 'default'}>
								{s.on ? '✓ ' : ''}
								{s.label}
							</Badge>
						))}
					</div>

					{linkEntries.length > 0 && (
						<>
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-5 mb-2">
								Resources
							</h3>
							<div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
								{linkEntries.map(([key, url]) => (
									<a
										key={key}
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
									>
										<ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
										<span className="truncate">{LINK_LABELS[key] ?? key}</span>
									</a>
								))}
							</div>
						</>
					)}
				</Card>

				{/* Milestones */}
				<Card>
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
						<Cake className="w-4 h-4 text-slate-400" />
						Milestones
					</h3>
					<dl className="space-y-2 text-sm">
						{meta?.first_live_link_url ? (
							<div>
								<dt className="text-xs text-slate-500 mb-0.5">1st live link</dt>
								<dd>
									<a
										href={meta.first_live_link_url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary-600 hover:underline text-sm"
									>
										open →
									</a>
								</dd>
							</div>
						) : (
							<Row label="1st live link" value="—" />
						)}
						{meta?.first_national_url ? (
							<div>
								<dt className="text-xs text-slate-500 mb-0.5">1st national</dt>
								<dd>
									<a
										href={meta.first_national_url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary-600 hover:underline text-sm"
									>
										open →
									</a>
								</dd>
							</div>
						) : (
							<Row label="1st national" value="—" />
						)}
					</dl>
				</Card>

				{/* Narrative blocks */}
				{(meta?.context_md ||
					meta?.story_md ||
					meta?.history_md ||
					meta?.pr_goals_md ||
					meta?.contracted_deliverables_md ||
					meta?.feedback_md) && (
					<Card className="lg:col-span-3">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
							Profile
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
							{meta?.context_md && (
								<NarrativeBlock title="Context with Open Ronin" body={meta.context_md} />
							)}
							{meta?.pr_goals_md && (
								<NarrativeBlock title="PR Goals" body={meta.pr_goals_md} />
							)}
							{meta?.story_md && <NarrativeBlock title="Story" body={meta.story_md} />}
							{meta?.history_md && (
								<NarrativeBlock title="History with Open Ronin" body={meta.history_md} />
							)}
							{meta?.contracted_deliverables_md && (
								<NarrativeBlock
									title="Contracted deliverables"
									body={meta.contracted_deliverables_md}
								/>
							)}
							{meta?.feedback_md && (
								<NarrativeBlock title="Feedback" body={meta.feedback_md} />
							)}
						</div>
					</Card>
				)}

				{/* Recent placements */}
				<Card className="lg:col-span-3">
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<FileText className="w-4 h-4 text-slate-400" />
							Recent media — last 90 days
						</h3>
						<Link
							href={`/media/opps?client=${encodeURIComponent(ctx.name)}`}
							className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
						>
							View all <ExternalLink className="w-3 h-3" />
						</Link>
					</div>
					{placements.length === 0 ? (
						<p className="text-sm text-slate-400">
							No recent media activity in the last 90 days.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
										<th className="py-2 pr-3 font-medium">Outlet</th>
										<th className="py-2 pr-3 font-medium">Status</th>
										<th className="py-2 pr-3 font-medium">Secured</th>
										<th className="py-2 pr-3 font-medium">Live</th>
										<th className="py-2 pr-3 font-medium text-right">Reach</th>
									</tr>
								</thead>
								<tbody>
									{placements.slice(0, 15).map((p) => {
										const pf = p.fields as Record<string, unknown>;
										return (
											<tr
												key={p.id}
												className="border-b border-slate-200 dark:border-slate-700"
											>
												<td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
													{(pf.Outlet as string) ?? '—'}
												</td>
												<td className="py-2 pr-3">
													{/* Shared stage mapping — the old inline test used 'Live'/'Pending',
													    tokens Airtable never emits, so every badge rendered gray. */}
													<Badge color={stageColor(pf.Status as string)}>
														{(pf.Status as string) ?? '—'}
													</Badge>
												</td>
												<td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
													{formatDate(pf['Date Secured'] as string)}
												</td>
												<td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
													{formatDate(pf['Live Date'] as string)}
												</td>
												<td className="py-2 pr-3 text-right font-mono text-slate-700 dark:text-slate-300">
													{pf.Reach ? formatCurrency(pf.Reach as number) : '—'}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
							{placements.length > 15 && (
								<p className="text-xs text-slate-400 mt-2">
									{placements.length - 15} more not shown.
								</p>
							)}
						</div>
					)}
				</Card>
			</div>
		</>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
			<dd
				className="text-sm text-slate-900 dark:text-slate-100 text-right truncate"
				title={value}
			>
				{value}
			</dd>
		</div>
	);
}

function NarrativeBlock({ title, body }: { title: string; body: string }) {
	return (
		<div>
			<p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
				{title}
			</p>
			<p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
				{body}
			</p>
		</div>
	);
}
