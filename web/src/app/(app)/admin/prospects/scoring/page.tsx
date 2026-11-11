// Admin → Prospects → Scoring & routing (spec 2026-10-19 §7): Quality/Heat
// weights and lists, routing tiers, Rescore all (paged), MQL form links and
// the call rubrics.

import { createClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadConfig, loadFormLinks, loadRubrics, loadScoringConfig } from '@/lib/revenue/server';
import NotAppliedCard from '@/app/(app)/prospects/NotAppliedCard';
import FormsSection, { type FormDef } from './FormsSection';
import RubricsSection from './RubricsSection';
import ScoringSection from './ScoringSection';

export const metadata = { title: 'Scoring & routing · Prospects settings' };
export const dynamic = 'force-dynamic';
// Each Rescore page runs up to 300 rev_rescore calls.
export const maxDuration = 60;

export default async function ScoringPage() {
	const supabase = await createClient();
	const [config, canManage, scoring, links, rubrics, forms] = await Promise.all([
		loadConfig(supabase),
		hasCapability('manage_revenue'),
		loadScoringConfig(supabase),
		loadFormLinks(supabase),
		loadRubrics(supabase),
		supabase.from('forms').select('id, slug, title, status, fields').order('title').range(0, 199),
	]);
	if (config.notApplied) return <NotAppliedCard />;
	const formDefs = ((forms.data ?? []) as { id: string; slug: string; title: string; status: string; fields: unknown }[]).map(
		(f): FormDef => ({
			id: f.id,
			slug: f.slug,
			title: f.title,
			questions: (Array.isArray(f.fields) ? (f.fields as { key?: string; label?: string }[]) : []).filter((q) => q.key).map((q) => ({ value: q.key as string, label: q.label ?? (q.key as string) })),
		}),
	);
	return (
		<>
			<ScoringSection rows={scoring} canManage={canManage} />
			<FormsSection links={links} forms={formDefs} pipelines={config.pipelines.filter((p) => p.is_active).map((p) => ({ slug: p.slug, name: p.name }))} canManage={canManage} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'} />
			<RubricsSection rubrics={rubrics} canManage={canManage} />
		</>
	);
}
