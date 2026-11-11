// Admin → Prospects → Integrations (spec 2026-10-19 §8): all of GoHighLevel
// in setup order (connection → webhook → workflows → switches → stage map →
// settings → backfill → log), the other connectors, and the Lead Scraper link.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadConfig, loadGhlOverview, loadIntakeSources, loadScraperLink } from '@/lib/revenue/server';
import NotAppliedCard from '@/app/(app)/prospects/NotAppliedCard';
import ConnectorsBlock from './ConnectorsBlock';
import GhlBlocks from './GhlBlocks';

export const metadata = { title: 'Integrations · Prospects settings' };
export const dynamic = 'force-dynamic';
// runGhlBackfillNow (called from this page) spends up to 45 s per call.
export const maxDuration = 60;

const LOG_PAGE = 50;
const WEBHOOK_TYPES = ['OpportunityCreate', 'OpportunityStageUpdate', 'OpportunityStatusUpdate', 'InboundMessage', 'AppointmentUpdate'];

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ log?: string }> }) {
	const sp = await searchParams;
	const logPage = Math.max(1, Number.parseInt(sp.log ?? '1', 10) || 1);
	const supabase = await createClient();
	const svc = createServiceRoleClient();
	const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
	const [config, canManage, ghl, sources, scraper, eligible, logs, ...events] = await Promise.all([
		loadConfig(supabase),
		hasCapability('manage_revenue'),
		loadGhlOverview(supabase, svc),
		loadIntakeSources(supabase),
		loadScraperLink(svc),
		supabase.from('rev_deals').select('id', { count: 'exact', head: true }).eq('ghl_push_status', 'eligible'),
		supabase
			.from('ghl_sync_log')
			.select('id, direction, kind, status, deal_id, summary, error, attempts, created_at', { count: 'exact' })
			.order('created_at', { ascending: false })
			.order('id', { ascending: true })
			.range((logPage - 1) * LOG_PAGE, logPage * LOG_PAGE - 1),
		...WEBHOOK_TYPES.map((t) => supabase.from('ghl_webhook_events').select('id', { count: 'exact', head: true }).eq('event_type', t).gte('received_at', since)),
	]);
	if (config.notApplied) return <NotAppliedCard />;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const ghlSource = sources.find((s) => s.key === 'ghl') ?? null;
	const activePipelines = config.pipelines.filter((p) => p.is_active);
	const eventCounts = Object.fromEntries(WEBHOOK_TYPES.map((t, i) => [t, (events[i] as { count: number | null }).count ?? 0]));

	return (
		<>
			<GhlBlocks
				connections={ghl.connections}
				cutover={ghl.cutover}
				settings={ghl.settings}
				stageMap={ghl.stageMap}
				backfillRuns={ghl.backfillRuns}
				logs={(logs.data ?? []) as { id: string; direction: string; kind: string; status: string; deal_id: string | null; summary: string | null; error: string | null; attempts: number; created_at: string }[]}
				logTotal={logs.count ?? 0}
				logPage={logPage}
				logPageSize={LOG_PAGE}
				eligible={eligible.count ?? 0}
				webhook={ghlSource ? { enabled: ghlSource.enabled, tokenIssuedAt: ghlSource.token_issued_at, events: ghlSource.event_count ?? 0, lastEventAt: ghlSource.last_event_at } : null}
				eventCounts={eventCounts}
				pipelines={activePipelines.map((p) => ({ id: p.id, slug: p.slug, name: p.name }))}
				stages={config.stages.map((s) => ({ id: s.id, pipelineId: s.pipeline_id, slug: s.slug, name: s.name, position: s.position }))}
				appUrl={appUrl}
				canManage={canManage}
			/>
			<ConnectorsBlock
				sources={sources.filter((s) => s.key !== 'ghl')}
				scraper={scraper}
				pipelines={activePipelines.map((p) => ({ slug: p.slug, name: p.name }))}
				appUrl={appUrl}
				canManage={canManage}
			/>
		</>
	);
}
