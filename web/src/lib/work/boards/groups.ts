// Grouping, status battery, progress and lateness — pure, unit-tested
// (groups.test.ts). The board table, kanban and timeline all read these so
// a row lands in the same group everywhere.

import { PARENT_KIND_FOR } from '@/app/(app)/the-work/hierarchy';
import type { BoardContext, StatusDef, WorkRow } from './types';
import { FALLBACK_COLOR } from '@/lib/colors';

/** monday-style group palette, used when the grouped value has no colour. */
/** Neutral fill for a status or option with no colour of its own: the one documented hex outside the group palette. */
export const NEUTRAL_COLOR = FALLBACK_COLOR;
export const GROUP_COLORS = ['#069494', '#a25ddc', '#e8890c', '#579bfc', '#e2445c', '#00a35c', '#ff5ac4', '#784bd1'];
const NONE = '__none__';

export interface RowGroup {
	key: string;
	label: string;
	color: string;
	rows: WorkRow[];
}

export const KIND_LABELS: Record<string, string> = {
	goal: 'Goal', priority: 'Priority', project: 'Project', task: 'Task', recurring: 'Recurring',
	process: 'Process', assignment: 'Assignment', campaign: 'Campaign', twelve_week_plan: '12 Week Plan',
	strategy: 'Strategy', target: 'Target', event: 'Event', bug: 'Bug',
};

const URGENCY_ORDER = ['urgent', 'high', 'medium', 'low'];

export function statusesFor(ctx: Pick<BoardContext, 'statusesByKind'>, kind: string): StatusDef[] {
	return ctx.statusesByKind[kind] ?? [];
}

export function statusDef(ctx: Pick<BoardContext, 'statusesByKind'>, row: Pick<WorkRow, 'kind' | 'status'>): StatusDef {
	return statusesFor(ctx, row.kind).find((s) => s.slug === row.status) ?? { slug: row.status, label: row.status.replace(/_/g, ' '), color: null };
}

/** Done = terminal and not a discard-like status. */
export function isDone(ctx: Pick<BoardContext, 'statusesByKind'>, row: Pick<WorkRow, 'kind' | 'status'>): boolean {
	const s = statusDef(ctx, row);
	return !!s.is_terminal && !/discard|archived|abandoned/.test(s.slug);
}

export function isClosed(ctx: Pick<BoardContext, 'statusesByKind'>, row: Pick<WorkRow, 'kind' | 'status'>): boolean {
	return !!statusDef(ctx, row).is_terminal;
}

/** Overdue: due before today (local YYYY-MM-DD) and not closed. */
export function isLate(ctx: Pick<BoardContext, 'statusesByKind'>, row: WorkRow, today: string): boolean {
	return !!row.ends_at && row.ends_at < today && !isClosed(ctx, row);
}

/** 0–100. Children rollup when the item has children, else its own status. */
export function progressOf(ctx: Pick<BoardContext, 'statusesByKind' | 'progress'>, row: WorkRow): number {
	// D14 (0162): a hand-set value wins until it is reverted to automatic.
	if (typeof row.manual_progress === 'number') return Math.round(row.manual_progress);
	const p = ctx.progress[row.id];
	if (p && p.total > 0) return Math.round((p.done / p.total) * 100);
	return isDone(ctx, row) ? 100 : 0;
}

export interface BatterySlice {
	slug: string;
	label: string;
	color: string;
	count: number;
}

/** The group footer bar: counts per status, in the kind's status order. */
export function statusBattery(ctx: Pick<BoardContext, 'statusesByKind'>, rows: WorkRow[]): BatterySlice[] {
	const counts = new Map<string, BatterySlice>();
	for (const r of rows) {
		const s = statusDef(ctx, r);
		const key = s.slug;
		const cur = counts.get(key);
		if (cur) cur.count++;
		else counts.set(key, { slug: key, label: s.label, color: s.color ?? FALLBACK_COLOR, count: 1 });
	}
	const order = rows[0] ? statusesFor(ctx, rows[0].kind).map((s) => s.slug) : [];
	return [...counts.values()].sort((a, b) => {
		const ia = order.indexOf(a.slug), ib = order.indexOf(b.slug);
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
	});
}

function valueOf(ctx: BoardContext, row: WorkRow, groupBy: string): string {
	switch (groupBy) {
		case 'parent': return row.parent_id ?? NONE;
		case 'status': return row.status;
		case 'owner': return row.owner_id ?? NONE;
		case 'department': return row.department_tag_id ?? NONE;
		case 'quarter': return row.quarter_id ?? NONE;
		case 'client': return row.client_id ?? NONE;
		case 'kind': return row.kind;
		case 'urgency': return row.priority ?? NONE;
		case 'lead': return row.project_lead_id ?? NONE;
		case 'subdept': return row.sub_team_tag_id ?? NONE;
		case 'severity': return row.severity ?? NONE;
		case 'discipline': return row.discipline_id ?? NONE;
		default: {
			const v = ctx.customValues[row.id]?.[groupBy];
			return v === null || v === undefined || v === '' ? NONE : String(v);
		}
	}
}

function noneLabel(groupBy: string, kinds: string[]): string {
	if (groupBy === 'parent') {
		const parentKind = kinds.map((k) => PARENT_KIND_FOR[k]).find(Boolean);
		return parentKind ? `No ${KIND_LABELS[parentKind]?.toLowerCase() ?? parentKind}` : 'No parent';
	}
	if (groupBy === 'owner') return 'No owner';
	if (groupBy === 'department') return 'No department';
	if (groupBy === 'quarter') return 'No quarter';
	if (groupBy === 'client') return 'No client';
	if (groupBy === 'urgency') return 'No urgency';
	if (groupBy === 'lead') return 'No lead';
	if (groupBy === 'subdept') return 'No sub-department';
	if (groupBy === 'severity') return 'No severity';
	if (groupBy === 'discipline') return 'No discipline';
	return 'Empty';
}

function labelAndColor(ctx: BoardContext, groupBy: string, value: string, kinds: string[]): { label: string; color: string | null } {
	if (value === NONE) return { label: noneLabel(groupBy, kinds), color: FALLBACK_COLOR };
	switch (groupBy) {
		case 'parent': return { label: ctx.parents[value]?.name ?? 'Unknown parent', color: null };
		case 'status': {
			const s = kinds.map((k) => statusesFor(ctx, k).find((x) => x.slug === value)).find(Boolean);
			return { label: s?.label ?? value.replace(/_/g, ' '), color: s?.color ?? null };
		}
		case 'owner': return { label: ctx.people[value]?.name ?? 'Former member', color: null };
		case 'department': return { label: ctx.departments[value]?.label ?? 'Unknown', color: ctx.departments[value]?.color ?? null };
		case 'quarter': return { label: ctx.quarters[value]?.name ?? 'Unknown', color: null };
		case 'client': return { label: ctx.clients[value]?.name ?? 'Unknown client', color: null };
		case 'kind': return { label: KIND_LABELS[value] ?? value, color: null };
		case 'urgency': return { label: value[0].toUpperCase() + value.slice(1), color: null };
		case 'severity': return { label: value[0].toUpperCase() + value.slice(1), color: null };
		case 'lead': return { label: ctx.people[value]?.name ?? 'Former member', color: null };
		case 'subdept': return { label: ctx.subdepts?.[value]?.label ?? 'Unknown', color: null };
		case 'discipline': return { label: ctx.disciplines?.[value]?.label ?? 'Unknown', color: null };
		default: {
			const col = ctx.customColumns.find((c) => c.key === groupBy);
			if (col?.type === 'dropdown') {
				const o = col.options.options?.find((x) => x.id === value);
				return { label: o?.label ?? value, color: o?.color ?? null };
			}
			if (col?.type === 'person') return { label: ctx.people[value]?.name ?? 'Former member', color: null };
			if (col?.type === 'checkbox') return { label: value === 'true' ? 'Checked' : 'Unchecked', color: null };
			return { label: value, color: null };
		}
	}
}

function orderKey(ctx: BoardContext, groupBy: string, value: string, kinds: string[], label: string): [number, string] {
	if (value === NONE) return [1e6, ''];
	if (groupBy === 'status') {
		const order = kinds.flatMap((k) => statusesFor(ctx, k).map((s) => s.slug));
		const i = order.indexOf(value);
		return [i < 0 ? 999 : i, label];
	}
	if (groupBy === 'urgency') {
		const i = URGENCY_ORDER.indexOf(value);
		return [i < 0 ? 99 : i, label];
	}
	if (groupBy === 'severity') {
		const i = ['critical', 'high', 'medium', 'low'].indexOf(value);
		return [i < 0 ? 99 : i, label];
	}
	if (groupBy === 'discipline') return [ctx.disciplines?.[value]?.position ?? 999, label];
	if (groupBy === 'kind') return [Math.max(0, kinds.indexOf(value)), label];
	// Quarters are named YY-Q ("26-4"): newest first.
	if (groupBy === 'quarter') return [-(Number(label.replace(/\D/g, '')) || 0), label];
	const col = ctx.customColumns.find((c) => c.key === groupBy);
	if (col?.type === 'dropdown') {
		const i = col.options.options?.findIndex((o) => o.id === value) ?? -1;
		return [i < 0 ? 999 : i, label];
	}
	return [0, label.toLowerCase()];
}

/**
 * Group rows by a column. Order: the column's natural order (status order,
 * urgency, dropdown option order), otherwise alphabetical; the "No …" group
 * always last. Rows keep their incoming order inside a group.
 */
export function groupRows(ctx: BoardContext, rows: WorkRow[], groupBy: string, kinds: string[]): RowGroup[] {
	const map = new Map<string, WorkRow[]>();
	for (const r of rows) {
		const v = valueOf(ctx, r, groupBy);
		const arr = map.get(v);
		if (arr) arr.push(r);
		else map.set(v, [r]);
	}
	// Empty parent groups (a goal with no priorities yet) still get a header
	// and an add line — otherwise a freshly created goal is invisible.
	if (groupBy === 'parent') for (const id of ctx.parentGroups ?? []) if (!map.has(id)) map.set(id, []);
	const groups = [...map.entries()].map(([key, groupRows]) => {
		const { label, color } = labelAndColor(ctx, groupBy, key, kinds);
		return { key, label, color, rows: groupRows, sort: orderKey(ctx, groupBy, key, kinds, label) };
	});
	groups.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1].localeCompare(b.sort[1]));
	return groups.map((g, i) => ({ key: g.key, label: g.label, color: g.color ?? GROUP_COLORS[i % GROUP_COLORS.length], rows: g.rows }));
}

export const NO_GROUP_KEY = NONE;

/** Black or white text on a hex background (WCAG relative luminance). */
export function readableText(hex: string | null | undefined): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
	if (!m) return '#ffffff';
	const n = parseInt(m[1], 16);
	const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
	// Contrast vs white = 1.05/(L+.05); vs near-black #202020 (L≈.0144) = (L+.05)/.0644.
	return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0644 ? '#ffffff' : '#202020';
}

/** Local-date YYYY-MM-DD (never toISOString: that's UTC and shifts the day). */
export function localToday(d = new Date()): string {
	const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
