// Admin → Prospects → Duplicates (spec 2026-10-19 §11): the merge queue,
// moved here from /prospects/duplicates. Paged; each side shows how many
// deals and activities it carries so the merge direction is an informed call.

import { createClient } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { PERSON_COLUMNS } from '@/lib/revenue/server';
import { countPerId } from '@/lib/revenue/lists';
import type { PersonRow } from '@/lib/revenue/shared';
import NotAppliedCard from '@/app/(app)/prospects/NotAppliedCard';
import DuplicatesSection, { type Candidate } from './DuplicatesSection';

export const metadata = { title: 'Duplicates · Prospects settings' };
export const dynamic = 'force-dynamic';

const SIZE = 50;

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
	const sp = await searchParams;
	const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
	const supabase = await createClient();
	const [canManage, res] = await Promise.all([
		hasCapability('manage_revenue'),
		supabase
			.from('rev_duplicate_candidates')
			.select('id, entity, keep_id, drop_id, match_on, confidence, created_at', { count: 'exact' })
			.eq('status', 'open')
			.order('created_at', { ascending: false })
			.order('id', { ascending: true })
			.range((page - 1) * SIZE, page * SIZE - 1),
	]);
	if (res.error && /does not exist|schema cache/i.test(res.error.message)) return <NotAppliedCard />;
	const rows = (res.data ?? []) as { id: string; entity: string; keep_id: string; drop_id: string; match_on: string; confidence: number; created_at: string }[];
	const ids = [...new Set(rows.filter((r) => r.entity === 'person').flatMap((r) => [r.keep_id, r.drop_id]))];
	// Exact per-person counts: these numbers decide an irreversible merge, so no .in() read that stops at 1000 rows.
	const [people, dealN, actN] = await Promise.all([
		ids.length ? supabase.from('rev_people').select(PERSON_COLUMNS).in('id', ids) : Promise.resolve({ data: [] }),
		countPerId(supabase, 'rev_deals', 'primary_person_id', ids),
		countPerId(supabase, 'rev_activities', 'person_id', ids),
	]);
	const byId = new Map(((people.data ?? []) as unknown as PersonRow[]).map((p) => [p.id, p]));
	const side = (id: string) => {
		const p = byId.get(id);
		return p ? { person: p, deals: dealN.get(id) ?? 0, activities: actN.get(id) ?? 0 } : null;
	};
	const candidates: Candidate[] = rows.map((r) => ({ id: r.id, matchOn: r.match_on, confidence: r.confidence, keepId: r.keep_id, dropId: r.drop_id, keep: side(r.keep_id), drop: side(r.drop_id) }));

	return <DuplicatesSection candidates={candidates} total={res.count ?? 0} page={page} size={SIZE} canManage={canManage} error={res.error?.message ?? null} />;
}
