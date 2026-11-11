// /prospects — Pipeline (spec 2026-10-15-prospects-lists-design.md §4): one
// screen for every deal — board (one pipeline) or table (any pipelines) — one
// filter bar, true totals from rev_pipeline_summary, real pagination. Replaced
// the board-only page and All prospects (/prospects/deals now redirects here).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { clsx } from 'clsx';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import ToolSettingsGear from '@/components/nav/ToolSettingsGear';
import Pagination from '@/components/ui/Pagination';
import { controlFocus } from '@/components/ui/focus';
import AddProspectButton from './AddProspectButton';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { loadConfig, loadStaff } from '@/lib/revenue/server';
import { cleanTerm, loadDealsPage, loadPipelineSummary, loadStageColumn, type DealQuery } from '@/lib/revenue/lists';
import { parsePipelineFilters, pipelineHref, resolveBoardPipeline, type PipelineView } from '@/lib/revenue/listParams';
import { formatCents, stagesByPipeline, type DealCard } from '@/lib/revenue/shared';
import DealsTable from './DealsTable';
import PipelineBoard from './PipelineBoard';
import PipelineFilters from './PipelineFilters';
import NotAppliedCard from './NotAppliedCard';

export const metadata = { title: 'Pipeline · Prospects' };
export const dynamic = 'force-dynamic';

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	// Settings link: the same check ModuleGate runs for /admin/*. A rep (an active
	// lane seat) opens on their own deals; everyone else on all of them.
	const [config, staff, canAdmin, laneSeat] = await Promise.all([
		loadConfig(supabase),
		loadStaff(supabase),
		hasModuleAccess('admin'),
		supabase.from('rev_lanes_people').select('lane').eq('user_id', profile.id).eq('is_active', true).limit(1),
	]);
	const f = parsePipelineFilters(await searchParams, laneSeat.data?.length ? 'me' : null);
	if (config.notApplied) return <NotAppliedCard />;
	if (config.error) return <Callout tone="error">{config.error}</Callout>;

	const active = config.pipelines.filter((p) => p.is_active);
	const slug = f.view === 'board' ? resolveBoardPipeline(f, active.map((p) => p.slug)) : f.pipeline;
	const pipeline = active.find((p) => p.slug === slug) ?? null;
	const byPipe = stagesByPipeline(config.stages);
	const query: DealQuery = {
		pipelineIds: pipeline ? [pipeline.id] : undefined,
		stageId: f.view === 'table' ? f.stage : null,
		ownerId: f.owner === 'me' ? profile.id : f.owner,
		source: f.source,
		status: f.status,
		// Searched in SQL (rev_pipeline_deals) over title, primary person and brand.
		q: f.q ? cleanTerm(f.q) || null : null,
	};
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
	const boardStages = pipeline ? (byPipe.get(pipeline.id) ?? []).filter((s) => f.status !== 'open' || s.outcome === 'open') : [];

	const [summary, table, columnLists] = await Promise.all([
		loadPipelineSummary(supabase, query),
		f.view === 'table' ? loadDealsPage(supabase, query, f.sort, f.dir, f.page, f.size) : Promise.resolve(null),
		f.view === 'board' && pipeline ? Promise.all(boardStages.map((s) => loadStageColumn(supabase, query, s.id, 0))) : Promise.resolve([] as { deals: DealCard[]; error: string | null }[]),
	]);
	const columns: Record<string, DealCard[]> = Object.fromEntries(boardStages.map((s, i) => [s.id, columnLists[i]?.deals ?? []]));
	const columnError = columnLists.find((c) => c.error)?.error ?? null;

	const total = summary.available ? summary.count : (table?.count ?? Object.values(columns).reduce((n, l) => n + l.length, 0));
	const statusWord = f.status === 'all' ? '' : `${f.status} `;
	const valueText = summary.available ? ` · ${formatCents(summary.valueCents)} est. value` : '';
	const toggle = (v: PipelineView, label: string) => (
		<Link
			href={pipelineHref(f, { view: v, ...(v === 'board' && !pipeline && active[0] ? { pipeline: active[0].slug } : {}) })}
			aria-current={f.view === v ? 'page' : undefined}
			className={clsx('px-3 py-1.5 text-xs', controlFocus, f.view === v ? 'bg-primary-50 font-semibold text-primary-900 dark:bg-primary-950 dark:text-primary-300' : 'hover:bg-hover')}
		>
			{label}
		</Link>
	);

	return (
		<>
			<PageHeader
				title="Pipeline"
				description={`${total.toLocaleString()} ${statusWord}deal${total === 1 ? '' : 's'}${valueText} · ${pipeline ? pipeline.name : 'all pipelines'}`}
				actions={
					<div className="flex items-center gap-2">
						{canAdmin && <ToolSettingsGear tool="/prospects" />}
						<div className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300 dark:divide-slate-600 dark:border-slate-600">
							{toggle('board', 'Board')}
							{toggle('table', 'Table')}
						</div>
						<AddProspectButton
							pipeline={pipeline?.slug ?? null}
							className={clsx('inline-flex items-center rounded-md bg-primary-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-800', controlFocus)}
						>
							Add prospect
						</AddProspectButton>
					</div>
				}
			/>
			<PipelineFilters
				f={f}
				pipelines={active.map((p) => ({ slug: p.slug, name: p.name }))}
				stageGroups={(pipeline ? [pipeline] : active).map((p) => ({ pipeline: p.name, stages: (byPipe.get(p.id) ?? []).map((s) => ({ id: s.id, name: s.name })) }))}
				staff={staff}
				showStage={f.view === 'table'}
			/>
			{f.view === 'board' ? (
				columnError ? (
					<Callout tone="error">{columnError}</Callout>
				) : pipeline ? (
					<PipelineBoard
						key={pipelineHref(f)}
						stages={boardStages}
						columns={columns}
						summary={summary.available ? summary.byStage : null}
						query={query}
						lane={pipeline.lane}
						staff={staffMap}
						pipelines={config.pipelines}
					/>
				) : (
					<Card className="border-dashed">
						<p className="text-sm text-slate-600 dark:text-slate-400">No active pipelines yet.</p>
					</Card>
				)
			) : table?.error ? (
				<Callout tone="error">{table.error}</Callout>
			) : (
				<Card padding="none" className="overflow-x-auto">
					{table && table.deals.length > 0 ? (
						<>
							<DealsTable deals={table.deals} f={f} pipelines={config.pipelines} stages={config.stages} staff={staffMap} />
							<Pagination page={f.page} size={f.size} total={table.count} hrefFor={(p) => pipelineHref(f, { page: p })} sizeHrefFor={(s) => pipelineHref(f, { size: s })} />
						</>
					) : (
						<p className="px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
							No deals match these filters.{' '}
							<Link href="/prospects?view=table" className="underline">
								Clear filters
							</Link>
						</p>
					)}
				</Card>
			)}
		</>
	);
}
