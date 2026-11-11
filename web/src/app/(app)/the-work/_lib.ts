// Shared server-side data fetchers for The Work pages. Centralizes the
// "load everything WorkItemForm needs" query so each page doesn't
// duplicate the 4 supporting fetches (profiles, tags, quarters, statuses).

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { STATUS_KIND_ALIASES } from '@/lib/work/statusKindAliases';
import type { StatusCategory } from '@/lib/work/boards/types';

// Kinds that can sensibly contain other work items. Deliberately excludes
// leaf/high-volume kinds (task, assignment, target — 2000+ rows) so the
// parent picker in WorkItemForm stays a short, useful list instead of a
// 2000-option dropdown.
const PARENT_CANDIDATE_KINDS = ['goal', 'priority', 'project', 'twelve_week_plan', 'campaign', 'strategy'];

/**
 * React-cached: five pages call this, and /the-work/priorities called it
 * alongside its OWN copies of the same profiles and tags queries in one
 * Promise.all — so the request paid for both twice.
 */
export const loadFormSupportingData = cache(async () => {
	const supabase = await createClient();
	const [{ data: profiles }, { data: tags }, { data: quarters }, { data: statuses }, { data: parentCandidates }] = await Promise.all([
		supabase.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name'),
		supabase.from('tags').select('id, slug, label, color, category, parent_tag_id').order('position'),
		supabase.from('quarters').select('id, name, year, quarter, starts_on').order('starts_on', { ascending: false }),
		supabase
			.from('work_item_statuses')
			.select('slug, label, color, position, is_initial, is_terminal, category, config_id, work_item_status_configs!inner(kind)')
			.order('position'),
		supabase
			.from('projects')
			.select('id, name, kind')
			.in('kind', PARENT_CANDIDATE_KINDS)
			.eq('archived', false)
			.order('kind')
			.order('name'),
	]);

	// Bucket statuses by kind via the joined config.kind. is_initial /
	// is_terminal (and the 0162 category) ride along so consumers (e.g. the Overview's task
	// checkboxes) can pick the right slug instead of hardcoding 'done'.
	const statusesByKind: Record<string, { slug: string; label: string; color: string | null; is_initial?: boolean; is_terminal?: boolean; category?: StatusCategory }[]> = {};
	for (const s of statuses ?? []) {
		const k = (s.work_item_status_configs as unknown as { kind: string } | { kind: string }[]);
		const kind = Array.isArray(k) ? k[0]?.kind : k?.kind;
		if (!kind) continue;
		if (!statusesByKind[kind]) statusesByKind[kind] = [];
		statusesByKind[kind].push({ slug: s.slug, label: s.label, color: s.color, is_initial: s.is_initial ?? undefined, is_terminal: s.is_terminal ?? undefined, category: (s.category as StatusCategory | null) ?? undefined });
	}
	for (const [alias, src] of Object.entries(STATUS_KIND_ALIASES)) {
		if (!statusesByKind[alias] && statusesByKind[src]) {
			statusesByKind[alias] = statusesByKind[src];
		}
	}

	return {
		profiles: profiles ?? [],
		tags: tags ?? [],
		quarters: quarters ?? [],
		statusesByKind,
		parentCandidates: parentCandidates ?? [],
	};
});
