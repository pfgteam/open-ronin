// Board engine — shared types (spec §5–§6). Pure module: imported by server
// loaders, server actions and client components alike.

export type BoardSection = 'company' | 'department' | 'client' | 'queue';
export type BoardSource = 'work_items' | 'staff_requests' | 'content_requests' | 'acquisition_targets';
export type BoardView = 'table' | 'kanban' | 'timeline' | 'calendar' | 'form';

export const BOARD_SECTIONS: { key: BoardSection; label: string }[] = [
	{ key: 'company', label: 'Company' },
	{ key: 'department', label: 'Departments' },
	{ key: 'client', label: 'Clients' },
	{ key: 'queue', label: 'Queues' },
];

/** Whitelisted base filter (boards.base_filter). Anything else is dropped. */
export interface BaseFilter {
	kinds?: string[];
	/** 'current' resolves to today's quarter at query time. */
	quarter?: 'current' | string;
	department_tag_ids?: string[];
	client_id?: string;
	owner_id?: string;
	/** Done (terminal) items show by default; the "Show done" chip still hides them (?closed=0). */
	show_done?: boolean;
}

export interface ColumnConfig {
	key: string;
	visible: boolean;
	width?: number;
}

export type CustomColumnType = 'text' | 'number' | 'date' | 'dropdown' | 'person' | 'link' | 'checkbox';

export interface DropdownOption {
	id: string;
	label: string;
	color: string;
}

export interface CustomColumn {
	id: string;
	key: string;
	label: string;
	type: CustomColumnType;
	options: { options?: DropdownOption[] };
	position: number;
}

export interface Board {
	id: string;
	slug: string;
	name: string;
	icon: string | null;
	section: BoardSection;
	source: BoardSource;
	base_filter: BaseFilter;
	group_by: string;
	default_view: BoardView;
	columns: ColumnConfig[];
	visibility: 'module' | 'members';
	is_system: boolean;
	position: number;
	created_by: string | null;
}

/** A work item row as the board loads it (public.projects subset). */
export interface WorkRow {
	id: string;
	name: string;
	kind: string;
	status: string;
	owner_id: string | null;
	parent_id: string | null;
	starts_at: string | null;
	ends_at: string | null;
	quarter_id: string | null;
	department_tag_id: string | null;
	client_id: string | null;
	priority: string | null;
	completed_at: string | null;
	updated_at: string;
	created_by: string | null;
	/** Soft-deleted (boards' "Archived" view lists these; Restore / Delete act on them). */
	archived: boolean;
	created_at?: string;
	project_lead_id?: string | null;
	sub_team_tag_id?: string | null;
	/** D14 (0162): hand-set progress 0-100; null = automatic rollup. */
	manual_progress?: number | null;
	manual_health?: 'on_track' | 'at_risk' | 'off_track' | null;
	/** Bug kind (0162). */
	severity?: 'critical' | 'high' | 'medium' | 'low' | null;
	environment?: string | null;
	is_regression?: boolean | null;
	/** Assignment discipline (0162). */
	discipline_id?: string | null;
}

export const WORK_ROW_COLUMNS =
	'id, name, kind, status, owner_id, parent_id, starts_at, ends_at, quarter_id, department_tag_id, client_id, priority, completed_at, updated_at, created_at, created_by, archived, project_lead_id, sub_team_tag_id, manual_progress, manual_health, severity, environment, is_regression, discipline_id';

/** Value of one custom cell, normalised from work_item_field_values. */
export type CustomValue = string | number | boolean | null;

/** Status category (0162): type change maps statuses by category; badges take their tone from it. */
export type StatusCategory = 'not_started' | 'active' | 'done' | 'cancelled';

export interface StatusDef {
	slug: string;
	label: string;
	color: string | null;
	is_initial?: boolean;
	is_terminal?: boolean;
	category?: StatusCategory;
}

/** Everything a board needs to render labels and colours. */
export interface BoardContext {
	statusesByKind: Record<string, StatusDef[]>;
	people: Record<string, { name: string; initials: string }>;
	departments: Record<string, { label: string; color: string | null }>;
	/** Sub-department tags (tags.category = sub_team). */
	subdepts?: Record<string, { label: string; parent: string | null }>;
	/** Assignment disciplines (0162 work_disciplines). */
	disciplines?: Record<string, { label: string; slug: string; position: number }>;
	/** Every tag, for the tag filter. */
	tags?: Record<string, { label: string; slug: string; category: string | null }>;
	quarters: Record<string, { name: string }>;
	parents: Record<string, { name: string; kind: string }>;
	clients: Record<string, { name: string }>;
	/** child id rollup per parent id: done / total (terminal non-discard = done). */
	progress: Record<string, { done: number; total: number }>;
	followers: Record<string, string[]>;
	customValues: Record<string, Record<string, CustomValue>>;
	customColumns: CustomColumn[];
	/**
	 * Parent-kind items (e.g. every open goal on Goals & Priorities) that get a
	 * group even when no row hangs under them yet, so a new goal is visible and
	 * has its own "+ Add priority" line. Only set when grouped by parent.
	 */
	parentGroups?: string[];
}

const BASE_FILTER_KEYS = new Set(['kinds', 'quarter', 'department_tag_ids', 'client_id', 'owner_id', 'show_done']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z_]{2,30}$/;

/** Parse boards.base_filter defensively — the DB only checks it's an object. */
export function parseBaseFilter(raw: unknown): BaseFilter {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: BaseFilter = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (!BASE_FILTER_KEYS.has(k)) continue;
		if (k === 'kinds' && Array.isArray(v)) out.kinds = v.filter((x): x is string => typeof x === 'string' && KIND.test(x));
		if (k === 'quarter' && typeof v === 'string' && (v === 'current' || UUID.test(v))) out.quarter = v;
		if (k === 'department_tag_ids' && Array.isArray(v)) out.department_tag_ids = v.filter((x): x is string => typeof x === 'string' && UUID.test(x));
		if ((k === 'client_id' || k === 'owner_id') && typeof v === 'string' && UUID.test(v)) out[k] = v;
		if (k === 'show_done' && v === true) out.show_done = true;
	}
	return out;
}

export function parseColumns(raw: unknown): ColumnConfig[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((c): c is { key: string; visible?: unknown; width?: unknown } => !!c && typeof c === 'object' && typeof (c as { key?: unknown }).key === 'string')
		.map((c) => ({
			key: c.key,
			visible: c.visible !== false,
			...(typeof c.width === 'number' && c.width >= 60 && c.width <= 600 ? { width: c.width } : {}),
		}));
}
