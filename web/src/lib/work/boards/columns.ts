// Built-in column catalog (spec §6). Custom columns (board_columns) sit next
// to these with keys `c_*`. The board's `columns` jsonb orders and hides both.

import type { ColumnConfig, CustomColumn } from './types';

export type CellType =
	| 'person'
	| 'status'
	| 'timeline'
	| 'date'
	| 'department'
	| 'progress'
	| 'quarter'
	| 'followers'
	| 'client'
	| 'kind'
	| 'parent'
	| 'urgency'
	| 'severity'
	| 'discipline'
	| 'subdept'
	| 'lead'
	| 'start'
	| 'updated'
	| 'custom';

export interface ColumnDef {
	key: string;
	label: string;
	cell: CellType;
	width: number;
	/** Field on public.projects the cell edits (undefined = read-only/computed). */
	field?: 'owner_id' | 'status' | 'ends_at' | 'starts_at' | 'department_tag_id' | 'quarter_id' | 'client_id' | 'priority' | 'parent_id'
		| 'project_lead_id' | 'sub_team_tag_id' | 'severity' | 'discipline_id';
	/** Can the board group by this column? */
	groupable?: boolean;
	sortable?: boolean;
	custom?: CustomColumn;
}

export const BUILTIN_COLUMNS: ColumnDef[] = [
	{ key: 'owner', label: 'Owner', cell: 'person', width: 140, field: 'owner_id', groupable: true, sortable: true },
	{ key: 'status', label: 'Status', cell: 'status', width: 136, field: 'status', groupable: true, sortable: true },
	{ key: 'timeline', label: 'Timeline', cell: 'timeline', width: 176 },
	{ key: 'due', label: 'Due', cell: 'date', width: 116, field: 'ends_at', sortable: true },
	{ key: 'department', label: 'Department', cell: 'department', width: 120, field: 'department_tag_id', groupable: true, sortable: true },
	{ key: 'progress', label: 'Progress', cell: 'progress', width: 124 },
	{ key: 'quarter', label: 'Quarter', cell: 'quarter', width: 92, field: 'quarter_id', groupable: true, sortable: true },
	{ key: 'followers', label: 'Followers', cell: 'followers', width: 104 },
	{ key: 'client', label: 'Client', cell: 'client', width: 150, field: 'client_id', groupable: true, sortable: true },
	{ key: 'kind', label: 'Type', cell: 'kind', width: 100, groupable: true },
	{ key: 'parent', label: 'Parent', cell: 'parent', width: 180, field: 'parent_id', groupable: true },
	{ key: 'urgency', label: 'Urgency', cell: 'urgency', width: 100, field: 'priority', groupable: true, sortable: true },
	// Rework (0162): the planning field set as columns.
	{ key: 'lead', label: 'Lead', cell: 'lead', width: 140, field: 'project_lead_id', groupable: true, sortable: true },
	{ key: 'start', label: 'Start', cell: 'start', width: 116, field: 'starts_at', sortable: true },
	{ key: 'subdept', label: 'Sub-department', cell: 'subdept', width: 130, field: 'sub_team_tag_id', groupable: true },
	{ key: 'severity', label: 'Severity', cell: 'severity', width: 104, field: 'severity', groupable: true, sortable: true },
	{ key: 'discipline', label: 'Discipline', cell: 'discipline', width: 112, field: 'discipline_id', groupable: true },
	{ key: 'updated', label: 'Updated', cell: 'updated', width: 96, sortable: true },
];

const BY_KEY = new Map(BUILTIN_COLUMNS.map((c) => [c.key, c]));

export function customColumnDef(c: CustomColumn): ColumnDef {
	return {
		key: c.key,
		label: c.label,
		cell: 'custom',
		width: c.type === 'checkbox' ? 92 : c.type === 'number' ? 112 : c.type === 'date' ? 100 : 150,
		groupable: c.type === 'dropdown' || c.type === 'person' || c.type === 'checkbox',
		sortable: c.type !== 'link',
		custom: c,
	};
}

/**
 * The visible column list for a board: the configured order first (unknown
 * keys dropped), then any custom column the config doesn't mention yet (a
 * column added from the header shows up at the end without a config write).
 */
export function resolveColumns(config: ColumnConfig[], custom: CustomColumn[]): ColumnDef[] {
	const customByKey = new Map(custom.map((c) => [c.key, c]));
	const out: ColumnDef[] = [];
	const seen = new Set<string>();
	for (const c of config) {
		if (seen.has(c.key)) continue;
		const def = BY_KEY.get(c.key) ?? (customByKey.has(c.key) ? customColumnDef(customByKey.get(c.key)!) : undefined);
		if (!def) continue;
		seen.add(c.key);
		if (!c.visible) continue;
		out.push(c.width ? { ...def, width: c.width } : def);
	}
	for (const c of [...custom].sort((a, b) => a.position - b.position)) {
		if (!seen.has(c.key)) out.push(customColumnDef(c));
	}
	return out;
}

/** Every column a board could show, for the Columns menu / settings. */
export function allColumns(custom: CustomColumn[]): ColumnDef[] {
	return [...BUILTIN_COLUMNS, ...custom.map(customColumnDef)];
}

export function groupableColumns(custom: CustomColumn[]): ColumnDef[] {
	return allColumns(custom).filter((c) => c.groupable);
}
