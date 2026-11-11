// Server helpers for loading + resolving a user's dashboard layout.
// See ./catalog.ts for tile definitions and ./actions.ts for the save action.

import React from 'react';

import { createClient, getAuthUser } from '@/lib/supabase/server';
import {
	formatCurrency,
	formatCurrencyPrecise,
	formatMetricNumber,
	formatPercent,
} from '@/lib/format';
import type { DailyPoint } from '@/lib/metrics/daily';
import type { MetricPoint } from '@/lib/metrics/sheets';

import type { TileFormat, TileSpec } from './catalog';
import type {
	DashboardLayout,
	LayoutItem,
	RenderedTile,
	TileDelta,
	TileSecondary,
	TileStats,
	TileTarget,
} from './types';

const ICON_CLS = 'w-4 h-4 text-primary-600 dark:text-primary-400';

// Read the saved layout for the current authenticated user. Returns null if
// there's no row yet (first-time user) or no session.
// Uses the request-memoized getAuthUser() — no extra Auth round-trip on top
// of the one AppLayout already pays in the same request.
export async function loadLayout(dashboardKey: string): Promise<DashboardLayout | null> {
	const user = await getAuthUser();
	if (!user) return null;

	const supabase = await createClient();

	const { data } = await supabase
		.from('user_dashboard_layout')
		.select('layout')
		.eq('user_id', user.id)
		.eq('dashboard_key', dashboardKey)
		.maybeSingle();

	if (!data) return null;
	return (data.layout as DashboardLayout) ?? null;
}

// ---------------------------------------------------------------------------
// Week-metric stats (delta vs prev week + progress vs target)
// ---------------------------------------------------------------------------

const FMT: Record<TileFormat, (n: number | null) => string> = {
	number: (n) => formatMetricNumber(n),
	currency: (n) => formatCurrency(n),
	currency2: (n) => formatCurrencyPrecise(n),
	percent: (n) => formatPercent(n),
};

function toneFor(
	dir: TileDelta['dir'],
	deltaTone: 'normal' | 'inverted' | 'neutral',
): TileDelta['tone'] {
	if (deltaTone === 'neutral' || dir === 'flat') return 'neutral';
	const goodDir = deltaTone === 'inverted' ? 'down' : 'up';
	return dir === goodDir ? 'good' : 'bad';
}

// Shared period-over-period math: weekly tiles compare week columns, daily
// tiles compare day columns. Only the note text differs.
function buildChange(
	current: number | null,
	previous: number | null,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral',
	note: string,
): TileDelta | null {
	if (current == null || previous == null) return null;

	// Percent metrics: report the change in percentage points, not a % of a %.
	if (format === 'percent') {
		const pp = (current - previous) * 100;
		const dir = pp > 0.05 ? 'up' : pp < -0.05 ? 'down' : 'flat';
		const abs = Math.abs(pp);
		const text =
			dir === 'flat'
				? '0pp'
				: `${pp > 0 ? '+' : '−'}${abs.toFixed(abs < 10 ? 1 : 0).replace(/\.0$/, '')}pp`;
		return { dir, tone: toneFor(dir, deltaTone), text, note };
	}

	if (previous === 0) {
		if (current === 0) return { dir: 'flat', tone: 'neutral', text: '0%', note };
		const dir = current > 0 ? 'up' : 'down';
		return { dir, tone: toneFor(dir, deltaTone), text: 'new', note };
	}

	const change = ((current - previous) / Math.abs(previous)) * 100;
	const dir = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
	const abs = Math.abs(change);
	const text =
		dir === 'flat' ? '0%' : `${change > 0 ? '+' : '−'}${abs.toFixed(abs < 10 ? 1 : 0).replace(/\.0$/, '')}%`;
	return { dir, tone: toneFor(dir, deltaTone), text, note };
}

function buildDelta(
	p: MetricPoint,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral',
): TileDelta | null {
	return buildChange(p.week, p.prevWeek, format, deltaTone, `vs prev wk (${FMT[format](p.prevWeek)})`);
}

// Day-over-day: D-1 against D-2, labelled with the actual date when the page
// knows it ("vs 08/11 (10)") so nobody has to guess which day is the baseline.
function buildDailyDelta(
	p: DailyPoint,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral',
	prevLabel?: string | null,
): TileDelta | null {
	const value = FMT[format](p.prevDay);
	const note = prevLabel ? `vs ${prevLabel} (${value})` : `vs prev day (${value})`;
	return buildChange(p.day, p.prevDay, format, deltaTone, note);
}

// Exposed for the metric table, so its delta columns follow exactly the same
// rules (and colors) as the KPI cards.
export function dailyDelta(
	p: DailyPoint,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral' = 'normal',
	prevLabel?: string | null,
): TileDelta | null {
	return buildDailyDelta(p, format, deltaTone, prevLabel);
}


export function weeklyDelta(
	p: MetricPoint,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral' = 'normal',
): TileDelta | null {
	return buildDelta(p, format, deltaTone);
}

// The card always carries BOTH readings: the focused period is the big number,
// the other one rides underneath. Which is which comes from ctx.period.
function buildWeeklySecondary(
	p: MetricPoint,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral',
	label = 'Weekly',
): TileSecondary | null {
	if (p.week == null && p.prevWeek == null) return null;
	const f = FMT[format];
	return {
		label,
		value: f(p.week),
		delta: buildDelta(p, format, deltaTone),
		note: p.prevWeek != null ? `prev ${f(p.prevWeek)}` : null,
	};
}

function buildDailySecondary(
	p: DailyPoint,
	format: TileFormat,
	deltaTone: 'normal' | 'inverted' | 'neutral',
	prevLabel?: string | null,
	label = 'Daily',
): TileSecondary | null {
	if (p.day == null && p.prevDay == null) return null;
	const f = FMT[format];
	return {
		label,
		value: f(p.day),
		delta: buildDailyDelta(p, format, deltaTone, prevLabel),
		note: p.prevDay != null ? `prev ${f(p.prevDay)}` : null,
	};
}

function buildTarget(p: MetricPoint, format: TileFormat): TileTarget | null {
	if (p.target == null || p.target === 0 || p.week == null) return null;
	const f = FMT[format];
	const actualPct = (p.week / p.target) * 100;
	const hit = actualPct >= 100;
	const mtd = p.month != null ? ` · MTD ${f(p.month)}` : '';
	return {
		barPct: Math.max(0, Math.min(100, actualPct)),
		hit,
		label: `${Math.round(actualPct)}% of target`,
		detail: `Target ${f(p.target)}${mtd}`,
	};
}

export interface ResolvedLayout {
	visible: RenderedTile[];
	hidden: RenderedTile[];
}

/** Which period the page is focused on — drives which number leads the card. */
export type DashboardPeriod = 'daily' | 'weekly';

export interface ResolveContext {
	/** Date label the daily delta compares against (D-2), e.g. "08/11". */
	dailyPrevLabel?: string | null;
	/** Period label for the secondary line, e.g. "08/12" or "08/07 - 08/13". */
	weeklyLabel?: string | null;
	/** Defaults to 'daily'. */
	period?: DashboardPeriod;
	/**
	 * Tile keys a first-time user sees (the pinned KPI row). Everything else in
	 * the catalog goes to `hidden` — still available in "Add a tile" and always
	 * present in the metric table below the grid.
	 */
	defaultVisible?: string[];
}

// Merge a saved layout against the catalog and produce render-ready tiles.
// - First-time users (saved === null): every catalog tile shown in catalog order.
// - Saved layout: visible tiles follow saved order, with unknown keys filtered out.
//   Tiles in the catalog that aren't in the saved layout go into `hidden`.
export function resolveLayout<Data>(
	catalog: TileSpec<Data>[],
	saved: DashboardLayout | null,
	data: Data,
	ctx?: ResolveContext,
): ResolvedLayout {
	const byKey = new Map(catalog.map((t) => [t.key, t]));

	const renderTile = (spec: TileSpec<Data>, override?: string): RenderedTile => {
		const format = spec.format ?? 'number';
		const tone = spec.deltaTone ?? 'normal';
		const daily = spec.dailyPoint?.(data);
		const point = spec.point?.(data);
		// A daily-backed tile shows yesterday vs the day before; weekly targets
		// are a week-scale goal, so no target bar (the subtitle carries the 7-day
		// average instead). Weekly-backed tiles keep the original card.
		const weeklyFocus = ctx?.period === 'weekly';
		let stats: TileStats | undefined;
		if (daily && weeklyFocus && point) {
			// Weekly in focus: the week leads, yesterday rides underneath. No target
			// bar — the sheet's Targets column is empty for these sections and the
			// second reading is more useful than an absent goal.
			stats = {
				delta: buildDelta(point, format, tone),
				target: null,
				secondary: buildDailySecondary(daily, format, tone, ctx?.dailyPrevLabel),
			};
		} else if (daily) {
			stats = {
				delta: buildDailyDelta(daily, format, tone, ctx?.dailyPrevLabel),
				target: null,
				secondary: point ? buildWeeklySecondary(point, format, tone) : null,
			};
		} else if (point) {
			stats = {
				delta: buildDelta(point, format, tone),
				target: buildTarget(point, format),
			};
		}
		return {
			key: spec.key,
			label: override ?? spec.defaultLabel,
			value: spec.render(data),
			subtitle: spec.subtitle(data),
			icon: React.createElement(spec.icon, { className: ICON_CLS }),
			href: spec.href,
			section: spec.section,
			stats,
		};
	};

	if (!saved || saved.length === 0) {
		// First-time default: the pinned keys when the caller names them (sheet-fed
		// dashboards have 15-57 tiles — showing all of them as cards is the thing
		// the metric table exists to avoid), otherwise the whole catalog.
		const pinned = ctx?.defaultVisible;
		if (pinned && pinned.length) {
			const wanted = new Set(pinned);
			const order = new Map(pinned.map((k, i) => [k, i]));
			const visible = catalog
				.filter((spec) => wanted.has(spec.key))
				.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
				.map((spec) => renderTile(spec));
			const hidden = catalog.filter((spec) => !wanted.has(spec.key)).map((s) => renderTile(s));
			return { visible, hidden };
		}
		return {
			visible: catalog.map((spec) => renderTile(spec)),
			hidden: [],
		};
	}

	const seen = new Set<string>();
	const visible: RenderedTile[] = [];
	for (const item of saved) {
		const spec = byKey.get(item.tile_key);
		if (!spec || seen.has(item.tile_key)) continue;
		seen.add(item.tile_key);
		visible.push(renderTile(spec, item.label_override));
	}

	const hidden = catalog.filter((spec) => !seen.has(spec.key)).map((spec) => renderTile(spec));

	return { visible, hidden };
}

// Helper: given a working LayoutItem[] (e.g. just-reordered), strip unknown
// tile keys and clamp label overrides to a reasonable length.
//
// `catalog` is null for the sheet-generated dashboards, where the tile set is
// only known at request time (a row added to the sheet is a new key). Those
// still get de-duplicated and clamped, and resolveLayout() drops keys that no
// longer exist when the page renders.
export function sanitizeLayout(
	catalog: { key: string }[] | null,
	layout: LayoutItem[],
): LayoutItem[] {
	const valid = catalog ? new Set(catalog.map((t) => t.key)) : null;
	const seen = new Set<string>();
	const out: LayoutItem[] = [];
	for (const item of layout) {
		if (!item?.tile_key) continue;
		if (item.tile_key.length > 120) continue;
		if (valid && !valid.has(item.tile_key)) continue;
		if (seen.has(item.tile_key)) continue;
		seen.add(item.tile_key);
		const override = item.label_override?.trim().slice(0, 80);
		out.push({ tile_key: item.tile_key, ...(override ? { label_override: override } : {}) });
	}
	return out;
}
