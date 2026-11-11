// Admin → Prospects → Pipelines (spec 2026-10-19 §5): pipelines and their
// stages (probability, SLA, required fields, hand-off, outbound GHL stage)
// and the call outcomes. Server loads; PipelinesSection edits in dialogs.

import { createClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadConfig } from '@/lib/revenue/server';
import NotAppliedCard from '@/app/(app)/prospects/NotAppliedCard';
import PipelinesSection from './PipelinesSection';

export const metadata = { title: 'Pipelines · Prospects settings' };
export const dynamic = 'force-dynamic';

export default async function PipelinesPage() {
	const supabase = await createClient();
	const [config, canManage, ghlP, ghlS, map] = await Promise.all([
		loadConfig(supabase),
		hasCapability('manage_revenue'),
		supabase.from('rev_pipelines').select('id, ghl_pipeline_id'),
		supabase.from('rev_stages').select('id, ghl_stage_id'),
		supabase.from('ghl_stage_map').select('ghl_stage_id, ghl_pipeline_id, ghl_pipeline_name, ghl_stage_name').order('ghl_pipeline_name').order('ghl_stage_name').range(0, 999),
	]);
	if (config.notApplied) return <NotAppliedCard />;
	const pipeGhl = new Map(((ghlP.data ?? []) as { id: string; ghl_pipeline_id: string | null }[]).map((r) => [r.id, r.ghl_pipeline_id]));
	const stageGhl = new Map(((ghlS.data ?? []) as { id: string; ghl_stage_id: string | null }[]).map((r) => [r.id, r.ghl_stage_id]));
	const rows = (map.data ?? []) as { ghl_stage_id: string; ghl_pipeline_id: string | null; ghl_pipeline_name: string | null; ghl_stage_name: string | null }[];
	const ghlPipelines = [...new Map(rows.filter((r) => r.ghl_pipeline_id).map((r) => [r.ghl_pipeline_id as string, r.ghl_pipeline_name ?? r.ghl_pipeline_id as string])).entries()].map(([id, name]) => ({ id, name }));
	const ghlStages = rows.map((r) => ({ id: r.ghl_stage_id, pipelineId: r.ghl_pipeline_id, name: r.ghl_stage_name ?? r.ghl_stage_id }));

	return (
		<PipelinesSection
			pipelines={config.pipelines.map((p) => ({ ...p, ghl_pipeline_id: pipeGhl.get(p.id) ?? null }))}
			stages={config.stages.map((s) => ({ ...s, ghl_stage_id: stageGhl.get(s.id) ?? null }))}
			dispositions={config.dispositions}
			ghlPipelines={ghlPipelines}
			ghlStages={ghlStages}
			canManage={canManage}
		/>
	);
}
