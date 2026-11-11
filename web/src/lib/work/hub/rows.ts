// Row-level vocabulary for The Work hub (pure, unit-tested): status tones
// (rework 8.5: quieter badges, token colours only), sorting, and the flat
// render list the virtualized table walks.

import { vizAt } from '@/lib/colors';
import type { BoardContext, StatusCategory, StatusDef, WorkRow } from '@/lib/work/boards/types';
import { statusDef, isDone } from '@/lib/work/boards/groups';
import type { HubState, SortKey } from './state';

// ------------------------------------------------------------------ tones

export type Tone = 'neutral' | 'primary' | 'warning' | 'success' | 'danger' | 'muted';

/** Category of a status: the 0162 column, else derived from the flags and slug. */
export function categoryOf(s: Pick<StatusDef, 'slug' | 'is_terminal' | 'is_initial' | 'category'>): StatusCategory {
	if (s.category) return s.category;
	if (s.is_terminal) return /discard|cancel|archived|abandon|wont|duplicate/.test(s.slug) ? 'cancelled' : 'done';
	if (s.is_initial || /backlog|to_do|planning|planned|pending|draft|create|follow_on|triage/.test(s.slug)) return 'not_started';
	return 'active';
}

export function statusTone(s: Pick<StatusDef, 'slug' | 'is_terminal' | 'is_initial' | 'category'>): Tone {
	const cat = categoryOf(s);
	if (cat === 'done') return 'success';
	if (cat === 'cancelled') return 'muted';
	if (/blocked|off_track/.test(s.slug)) return 'danger';
	if (/review|approval|paused|at_risk|update/.test(s.slug)) return 'warning';
	if (cat === 'not_started') return s.slug === 'backlog' ? 'muted' : 'neutral';
	return 'primary';
}

/** Quiet badge classes per tone (token colours only, both modes). */
export const TONE_BADGE: Record<Tone, string> = {
	neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
	primary: 'bg-primary-50 text-primary-900 dark:bg-primary-950 dark:text-primary-300',
	warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
	success: 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300',
	danger: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
	muted: 'bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
};

export const TONE_DOT: Record<Tone, string> = {
	neutral: 'bg-slate-400',
	primary: 'bg-primary-600',
	warning: 'bg-amber-500',
	success: 'bg-green-600',
	danger: 'bg-red-600',
	muted: 'bg-slate-300 dark:bg-slate-600',
};

/** A CSS colour (token variable) per tone, for group bars and kanban column tops. */
export const TONE_COLOR: Record<Tone, string> = {
	neutral: 'var(--tx3)',
	primary: 'var(--c-primary-600)',
	warning: 'var(--c-warning)',
	success: 'var(--c-success)',
	danger: 'var(--c-danger)',
	muted: 'var(--line2)',
};

export const URGENCY_TONE: Record<string, Tone> = { urgent: 'danger', high: 'warning', medium: 'primary', low: 'neutral' };
export const SEVERITY_TONE: Record<string, Tone> = { critical: 'danger', high: 'warning', medium: 'primary', low: 'neutral' };

/** Group bar colour: status → its tone; anything else → the token palette by position. */
export function groupColor(groupBy: string, key: string, index: number, ctx: Pick<BoardContext, 'statusesByKind'>, kinds: string[]): string {
	if (key === '__none__') return 'var(--line2)';
	if (groupBy === 'status') {
		const s = kinds.map((k) => (ctx.statusesByKind[k] ?? []).find((x) => x.slug === key)).find(Boolean);
		return TONE_COLOR[statusTone(s ?? { slug: key })];
	}
	if (groupBy === 'urgency') return TONE_COLOR[URGENCY_TONE[key] ?? 'neutral'];
	if (groupBy === 'severity') return TONE_COLOR[SEVERITY_TONE[key] ?? 'neutral'];
	return vizAt(index);
}

// ---------------------------------------------------------------- progress

/** 0–100: the manual value when set (D14), else the children rollup, else the item's own status. */
export function progressValue(ctx: Pick<BoardContext, 'statusesByKind' | 'progress'>, row: WorkRow): number {
	if (typeof row.manual_progress === 'number') return Math.round(row.manual_progress);
	const p = ctx.progress[row.id];
	if (p && p.total > 0) return Math.round((p.done / p.total) * 100);
	return isDone(ctx, row) ? 100 : 0;
}

export function autoProgress(ctx: Pick<BoardContext, 'statusesByKind' | 'progress'>, row: WorkRow): number {
	return progressValue(ctx, { ...row, manual_progress: null });
}

// ------------------------------------------------------------------- sort

const URGENCY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Client-side sort over the full working set (rework D8: the whole filtered
 * set is loaded, so sorting is exact). Nulls sort last in both directions;
 * ties fall back to name, then id, so the order is stable.
 */
export function sortRows(rows: WorkRow[], sort: HubState['sort'], ctx: Pick<BoardContext, 'statusesByKind' | 'people'>): WorkRow[] {
	if (!sort || sort.key === 'manual') return rows;
	const dir = sort.dir === 'desc' ? -1 : 1;
	const statusIndex = (r: WorkRow) => (ctx.statusesByKind[r.kind] ?? []).findIndex((s) => s.slug === r.status);
	const key = (r: WorkRow): string | number | null => {
		switch (sort.key as SortKey) {
			case 'name': return r.name.toLowerCase();
			case 'due': return r.ends_at;
			case 'start': return r.starts_at;
			case 'status': { const i = statusIndex(r); return i < 0 ? null : i; }
			case 'owner': return r.owner_id ? (ctx.people[r.owner_id]?.name ?? '').toLowerCase() || null : null;
			case 'updated': return r.updated_at;
			case 'created': return r.created_at ?? null;
			case 'urgency': return r.priority ? URGENCY_RANK[r.priority] ?? null : null;
			case 'severity': return r.severity ? SEVERITY_RANK[r.severity] ?? null : null;
			default: return null;
		}
	};
	return [...rows].sort((a, b) => {
		const ka = key(a), kb = key(b);
		if (ka === null && kb !== null) return 1;
		if (kb === null && ka !== null) return -1;
		if (ka !== null && kb !== null && ka !== kb) return (ka < kb ? -1 : 1) * dir;
		return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);
	});
}

// --------------------------------------------------------- flat render list

export interface RenderGroup {
	key: string;
	label: string;
	color: string;
	rows: WorkRow[];
	/** True count of the group over the whole filtered set (server facets until every row is loaded). */
	count: number;
}

export type RenderItem =
	| { type: 'group'; group: RenderGroup; collapsed: boolean }
	| { type: 'row'; row: WorkRow; group: RenderGroup; depth: number }
	| { type: 'add'; group: RenderGroup }
	| { type: 'footer'; group: RenderGroup };

/** The rows the virtualized table renders, in order (group header, rows, add line, footer). */
export function flattenGroups(groups: RenderGroup[], collapsed: Set<string>, opts: { add: boolean; grouped: boolean }): RenderItem[] {
	const out: RenderItem[] = [];
	for (const g of groups) {
		if (opts.grouped) out.push({ type: 'group', group: g, collapsed: collapsed.has(g.key) });
		if (opts.grouped && collapsed.has(g.key)) continue;
		for (const row of g.rows) out.push({ type: 'row', row, group: g, depth: 0 });
		if (opts.add) out.push({ type: 'add', group: g });
		if (opts.grouped) out.push({ type: 'footer', group: g });
	}
	return out;
}

/** Status label for a row (used by the kanban and the drawer). */
export function statusLabel(ctx: Pick<BoardContext, 'statusesByKind'>, row: Pick<WorkRow, 'kind' | 'status'>): string {
	return statusDef(ctx, row).label;
}
