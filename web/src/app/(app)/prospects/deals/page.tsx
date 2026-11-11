// /prospects/deals (All prospects, P0) merged into /prospects (Pipeline table)
// on 2026-10-15 — kept as a redirect that carries the filters over.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { legacyDealsHref } from '@/lib/revenue/listParams';

export default async function AllProspectsMoved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
	const sp = await searchParams;
	const supabase = await createClient();
	const { data } = await supabase.from('rev_pipelines').select('slug, lane').eq('is_active', true);
	const byLane: Record<string, string[]> = {};
	for (const p of (data ?? []) as { slug: string; lane: string }[]) (byLane[p.lane] ??= []).push(p.slug);
	redirect(legacyDealsHref(sp, byLane));
}
