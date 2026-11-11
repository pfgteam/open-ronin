// Shared types for dashboard tile customization.
// Layout is stored per (user, dashboard_key) in user_dashboard_layout (Supabase 0003).

export interface LayoutItem {
	tile_key: string;
	label_override?: string;
}

export type DashboardLayout = LayoutItem[];

// Week-over-week variation, pre-formatted on the server.
export interface TileDelta {
	dir: 'up' | 'down' | 'flat';
	/** 'good' → green, 'bad' → red, 'neutral' → gray (spend-style metrics). */
	tone: 'good' | 'bad' | 'neutral';
	/** e.g. "+33%", "−15pp", "new" */
	text: string;
	/** e.g. "vs prev wk (18)" */
	note: string;
}

// Progress vs the sheet's Targets column, pre-formatted on the server.
export interface TileTarget {
	/** Bar width, clamped 0–100. */
	barPct: number;
	/** True when the target is met or exceeded. */
	hit: boolean;
	/** e.g. "96% of target" */
	label: string;
	/** e.g. "Target 25 · MTD 41" */
	detail: string;
}

// Second reading on a card, under the main value. On a daily tile it carries
// the same metric's week: "Week $395.87 ▲ +34% · prev $294.54".
export interface TileSecondary {
	/** Short period label, e.g. "Week". */
	label: string;
	/** Formatted value for that period. */
	value: string;
	delta: TileDelta | null;
	/** Muted tail, e.g. "prev $294.54". */
	note: string | null;
}

// Structured stats. Present only on sheet-fed tiles; its presence switches the
// tile to the value + delta + (target bar | secondary line) card layout.
export interface TileStats {
	delta: TileDelta | null;
	target: TileTarget | null;
	/** Weekly reading of a daily tile — null on weekly-backed tiles. */
	secondary?: TileSecondary | null;
}

// A rendered tile that crosses the server -> client boundary.
// Icons are pre-rendered as ReactNode so the client doesn't need lucide refs.
export interface RenderedTile {
	key: string;
	label: string;
	value: string;
	subtitle: string;
	icon: React.ReactNode;
	href?: string;
	/** Thematic group within the page (e.g. "Funnel"). Sectionless tiles render in one flat grid. */
	section?: string;
	stats?: TileStats;
}

