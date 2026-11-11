// Pure scale math shared by the SVG chart set (Sparkline, LineChart,
// BarChart, StackedBarChart). No DOM, no React, so it is unit tested.

export type Point = number | null;

export interface Frame {
	width: number;
	height: number;
	/** Inner padding on every side. */
	pad: number;
	/** Extra room at the bottom for x labels, 0 when there are none. */
	labelGutter: number;
}

export interface Scale {
	x: (index: number) => number;
	y: (value: number) => number;
	min: number;
	max: number;
	/** Y of the zero line when 0 is inside the domain, else null. */
	zeroY: number | null;
}

/** Numbers only, gaps dropped. */
export function finite(series: Point[]): number[] {
	return series.filter((v): v is number => v != null && Number.isFinite(v));
}

/**
 * Domain for one or more series. Bars and goal lines want the baseline at 0
 * (`includeZero`); a sparkline of a bounded metric does not.
 */
export function domain(seriesList: Point[][], includeZero = false): { min: number; max: number } {
	const values = seriesList.flatMap(finite);
	if (values.length === 0) return { min: 0, max: 1 };
	let min = Math.min(...values);
	let max = Math.max(...values);
	if (includeZero) {
		min = Math.min(min, 0);
		max = Math.max(max, 0);
	}
	if (max === min) max = min + 1;
	return { min, max };
}

export function scale(count: number, frame: Frame, dom: { min: number; max: number }): Scale {
	const { width, height, pad, labelGutter } = frame;
	const innerW = width - pad * 2;
	const innerH = height - pad * 2 - labelGutter;
	const span = dom.max - dom.min || 1;
	const x = (i: number) => (count <= 1 ? pad + innerW / 2 : pad + (i / (count - 1)) * innerW);
	const y = (v: number) => pad + innerH - ((v - dom.min) / span) * innerH;
	return {
		x,
		y,
		min: dom.min,
		max: dom.max,
		zeroY: dom.min <= 0 && dom.max >= 0 ? y(0) : null,
	};
}

/**
 * SVG path for a series. Gaps (null) break the line by default; with
 * `bridgeGaps` the line runs straight across them (the Sparkline look).
 */
export function linePath(series: Point[], s: Scale, bridgeGaps = false): string {
	let d = '';
	let pen = false;
	series.forEach((v, i) => {
		if (v == null || !Number.isFinite(v)) {
			if (!bridgeGaps) pen = false;
			return;
		}
		d += `${pen ? 'L' : 'M'} ${s.x(i).toFixed(1)} ${s.y(v).toFixed(1)} `;
		pen = true;
	});
	return d.trim();
}

/** Column geometry for a bar chart: one slot per index, bars centred in it. */
export function barSlots(count: number, frame: Frame, gapRatio = 0.35): { slot: number; bar: number; left: (i: number) => number } {
	const innerW = frame.width - frame.pad * 2;
	const slot = count > 0 ? innerW / count : innerW;
	const bar = Math.max(1, slot * (1 - gapRatio));
	return { slot, bar, left: (i: number) => frame.pad + i * slot + (slot - bar) / 2 };
}

/** "Nice" tick values for a y axis: 0, mid, max in the domain's units. */
export function yTicks(dom: { min: number; max: number }, n = 3): number[] {
	if (n < 2) return [dom.max];
	const out: number[] = [];
	for (let k = 0; k < n; k++) out.push(dom.min + ((dom.max - dom.min) * k) / (n - 1));
	return out;
}

/** Short label for an axis tick: 1200 becomes 1.2k. */
export function tickLabel(v: number): string {
	const abs = Math.abs(v);
	if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
	if (abs >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
	return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
