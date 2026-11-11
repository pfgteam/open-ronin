// Server entry for every hub tab (/the-work/<tab>) and custom board
// (/the-work/b/<slug>): resolves the definition, parses the URL state,
// loads the first paint (true counts, facets, first page, every id) and
// renders the one list screen. Private folder (_hub): not a route.

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadFormSupportingData } from '../_lib';
import { PARENT_KIND_FOR } from '../hierarchy';
import { groupableColumns } from '@/lib/work/boards/columns';
import { KIND_LABELS, localToday } from '@/lib/work/boards/groups';
import { hubTabForKind, hubHref } from '@/lib/work/hub/tabs';
import { hubQueryString, parseHubState } from '@/lib/work/hub/state';
import { hubDefFor, loadHub } from '@/lib/work/hub/server';
import HubScreen from '@/components/work/hub/HubScreen';

const EMPTY_PARENT_GROUP_KINDS = new Set(['goal', 'priority']);

export type HubSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HubPage({ mode, hubKey, searchParams, embedded }: { mode: 'tab' | 'board' | 'pending' | 'client'; hubKey: string; searchParams: HubSearchParams; embedded?: boolean }) {
	const sp = await searchParams;

	// Old hub links (/the-work/priorities?kind=goal&q=26-3&owner=…): the kind
	// picks the tab, every filter carries over (rework phase 7: redirects
	// keep their filters).
	const legacyKind = typeof sp.kind === 'string' ? sp.kind : undefined;
	if (legacyKind && mode === 'tab') {
		const tab = hubTabForKind(legacyKind);
		const state = parseHubState(sp);
		// The old hub applied its quarter (q) to priorities and projects only;
		// on every other tab q was ignored, so the same link drops it here.
		if (tab && tab.quarterDefault === 'all' && typeof sp.q === 'string' && !sp.quarter) state.quarter = null;
		// The old hub listed done items too (board columns for every status);
		// the same link keeps showing them.
		if (state.closed === null) state.closed = true;
		if (tab) redirect(`${hubHref(tab)}${hubQueryString(state)}`);
	}

	const found = await hubDefFor(hubKey, mode);
	if (!found) notFound();
	const { def, customColumns, canEdit } = found;
	const state = parseHubState(sp);

	// Group-by choices: parent (when these kinds have one), type (several
	// kinds), no grouping, then every groupable column.
	const groupOptions: { key: string; label: string }[] = [];
	const parentKind = def.kinds.map((k) => PARENT_KIND_FOR[k]).find(Boolean);
	if (parentKind) groupOptions.push({ key: 'parent', label: KIND_LABELS[parentKind] ?? parentKind });
	if (def.kinds.length > 1) groupOptions.push({ key: 'kind', label: 'Type' });
	for (const c of groupableColumns(customColumns)) {
		if (c.key === 'parent' || c.key === 'kind') continue;
		groupOptions.push({ key: c.key, label: c.label });
	}
	groupOptions.push({ key: 'none', label: 'No grouping' });
	const groupBy = groupOptions.some((g) => g.key === state.group) ? state.group! : def.group;
	if (state.group && !groupOptions.some((g) => g.key === state.group)) state.group = null;

	const payload = await loadHub(def, state, groupBy === 'none' ? null : groupBy, customColumns);

	// Grouped by a goal or a priority: every open parent is a group, even an
	// empty one, so a new goal shows at once with its own add line.
	if (groupBy === 'parent' && parentKind && EMPTY_PARENT_GROUP_KINDS.has(parentKind) && !state.archived && !payload.quarterId) {
		const supabase = await createClient();
		const support = await loadFormSupportingData();
		const terminal = (support.statusesByKind[parentKind] ?? []).filter((s) => s.is_terminal).map((s) => s.slug);
		let pq = supabase.from('projects').select('id, name, kind').eq('kind', parentKind).eq('archived', false).order('name').range(0, 199);
		if (terminal.length) pq = pq.not('status', 'in', `(${terminal.join(',')})`);
		const { data: parentRows } = await pq;
		for (const g of (parentRows ?? []) as { id: string; name: string; kind: string }[]) payload.ctx.parents[g.id] ??= { name: g.name, kind: g.kind };
		payload.ctx.parentGroups = ((parentRows ?? []) as { id: string }[]).map((g) => g.id);
	}

	return (
		<HubScreen
			def={def}
			mode={mode}
			embedded={embedded}
			state={state}
			payload={payload}
			customColumns={customColumns}
			canEdit={canEdit}
			groupOptions={groupOptions}
			defaults={{
				quarter_id: payload.quarterId,
				department_tag_id: def.pinned?.department_tag_ids?.length === 1 ? def.pinned.department_tag_ids[0] : null,
				client_id: def.pinned?.client_id ?? null,
			}}
			serverToday={localToday()}
		/>
	);
}
