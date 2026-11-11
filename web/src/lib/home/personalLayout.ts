// The personal page (rework D5, 5.5): one tile grid that replaces Home,
// Self Overview and My Work. Tiles are drag-and-drop, sized one or two
// columns, can be hidden, and the layout is saved per person in
// user_dashboard_layout (dashboard_key 'personal'). Pure module: the tile
// catalog, the default layouts per role (rework 8.4) and layout parsing.

export type TileId =
	| 'kpis' | 'my_queue' | 'goals_priorities' | 'projects_lead' | 'client_work' | 'agenda' | 'todos'
	| 'created' | 'delegated' | 'following' | 'radar' | 'quick_actions' | 'team' | 'ask_for' | 'open_requests' | 'sales_queue';

export interface TileDef { id: TileId; title: string; help: string; leadsOnly?: boolean; salesOnly?: boolean }

export const TILES: TileDef[] = [
	{ id: 'kpis', title: 'My numbers', help: 'Overdue, today, this week, following.' },
	{ id: 'my_queue', title: 'My queue', help: 'Everything you own, by due date; change status in one click.' },
	{ id: 'goals_priorities', title: 'Goals and priorities', help: 'The ones you own or lead, with progress.' },
	{ id: 'projects_lead', title: 'Projects I lead', help: 'Projects where you are the lead.' },
	{ id: 'client_work', title: 'Client work', help: 'Assignments on you, by discipline.' },
	{ id: 'agenda', title: "Today's agenda", help: 'Your Google Calendar day.' },
	{ id: 'todos', title: 'To dos', help: 'Check-in, metrics, calibration, Sessions suggestions waiting on you.' },
	{ id: 'created', title: 'Created by me', help: 'Open items you created.' },
	{ id: 'delegated', title: 'Delegated by me', help: 'Items you created that someone else owns.' },
	{ id: 'following', title: 'Following', help: 'Open items you follow that others own.' },
	{ id: 'radar', title: 'Radar', help: 'Signals that need a look.' },
	{ id: 'quick_actions', title: 'Quick actions', help: 'Your shortcuts.' },
	{ id: 'team', title: 'My team', help: 'Overdue and stale work on your direct reports.', leadsOnly: true },
	{ id: 'ask_for', title: 'Ask for…', help: 'Requests that route to the right team.' },
	{ id: 'open_requests', title: 'My open requests', help: 'What you asked for and is not done.' },
	{ id: 'sales_queue', title: 'Sales queue', help: 'Your lane in Prospects.', salesOnly: true },
];

export interface TileSlot { id: TileId; size: 1 | 2; hidden?: boolean }

export type PersonaKey = 'publicist' | 'manager' | 'exec';

const s = (id: TileId, size: 1 | 2 = 1): TileSlot => ({ id, size });

/**
 * Rework 8.4 (proposed, Alex can change): default tiles per persona.
 * Publicist: their queue, client work and agenda up front. Manager: queue,
 * team exceptions, goals and projects. Exec: goals and priorities, radar,
 * team and projects first; personal queue lower.
 */
export const DEFAULT_LAYOUTS: Record<PersonaKey, TileSlot[]> = {
	publicist: [s('kpis', 2), s('my_queue', 2), s('client_work', 2), s('agenda'), s('todos'), s('quick_actions'), s('following'), s('ask_for', 2), s('open_requests', 2), s('created'), s('radar')],
	manager: [s('kpis', 2), s('my_queue', 2), s('team', 2), s('todos'), s('agenda'), s('goals_priorities', 2), s('projects_lead', 2), s('radar', 2), s('delegated'), s('created'), s('open_requests', 2)],
	exec: [s('kpis', 2), s('goals_priorities', 2), s('radar', 2), s('team', 2), s('projects_lead', 2), s('agenda'), s('todos'), s('my_queue', 2), s('delegated'), s('quick_actions')],
};

export function personaFor(role: string | null | undefined, isLead: boolean): PersonaKey {
	if (role === 'exec' || role === 'admin') return 'exec';
	if (role === 'manager' || isLead) return 'manager';
	return 'publicist';
}

/**
 * Parse a stored layout defensively: unknown ids drop, duplicates drop, and
 * tiles missing from it (added to the catalog later) are appended hidden so
 * the person can turn them on.
 */
export function normalizeLayout(raw: unknown, fallback: TileSlot[]): TileSlot[] {
	if (!Array.isArray(raw) || !raw.length) return fallback;
	const known = new Set(TILES.map((t) => t.id));
	const seen = new Set<TileId>();
	const out: TileSlot[] = [];
	for (const x of raw) {
		if (!x || typeof x !== 'object') continue;
		const id = (x as { id?: unknown }).id;
		if (typeof id !== 'string' || !known.has(id as TileId) || seen.has(id as TileId)) continue;
		seen.add(id as TileId);
		const size = (x as { size?: unknown }).size === 2 ? 2 : 1;
		out.push({ id: id as TileId, size, ...((x as { hidden?: unknown }).hidden === true ? { hidden: true } : {}) });
	}
	if (!out.length) return fallback;
	for (const t of TILES) if (!seen.has(t.id)) out.push({ id: t.id, size: 1, hidden: true });
	return out;
}

/** The layout a viewer sees: theirs, else the persona default plus the rest hidden. */
export function layoutFor(raw: unknown, role: string | null | undefined, isLead: boolean): TileSlot[] {
	const base = DEFAULT_LAYOUTS[personaFor(role, isLead)];
	return normalizeLayout(raw, normalizeLayout(base, base));
}

/** Tiles that apply to this viewer (leads-only, sales-only). */
export function visibleTiles(layout: TileSlot[], opts: { isLead: boolean; hasSales: boolean }): TileSlot[] {
	const byId = new Map(TILES.map((t) => [t.id, t]));
	return layout.filter((slot) => {
		const def = byId.get(slot.id);
		if (!def) return false;
		if (def.leadsOnly && !opts.isLead) return false;
		if (def.salesOnly && !opts.hasSales) return false;
		return true;
	});
}
