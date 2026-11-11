// Bi-weekly trend line for a metric row/card. Server-rendered SVG, no client JS.
//
// Specs: 2px line in the de-emphasis hue, last point in the accent with a 2px
// surface ring so it stays legible over the line, no axis and no per-point
// labels — the numbers live in the columns next to it. The <title> gives the
// hover/screen-reader text, which is why this needs no JavaScript.
//
// The scale math lives in ./charts/scale.ts and is shared with the larger
// chart set (LineChart, BarChart, StackedBarChart in ./charts) that Client
// Analytics uses; this stays the small inline form.

import { domain, linePath, scale, type Point } from './charts/scale';

interface Props {
	/** Oldest first. Nulls are gaps (a day the sheet never got). */
	series: Point[];
	width?: number;
	height?: number;
	/** Hover text, e.g. "14 days to 08/12". */
	title?: string;
	className?: string;
}

export default function Sparkline({ series, width = 66, height = 18, title, className }: Props) {
	const lastIdx = series.reduce<number>((acc, v, i) => (v != null && Number.isFinite(v) ? i : acc), -1);
	const pointCount = series.filter((v) => v != null && Number.isFinite(v)).length;
	if (pointCount < 2 || series.length < 2) return null;

	const s = scale(series.length, { width, height, pad: 3, labelGutter: 0 }, domain([series]));
	const d = linePath(series, s, true);
	const last = series[lastIdx] as number;

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className={`text-slate-400 dark:text-slate-500 ${className ?? ''}`}
			role="img"
		>
			{title && <title>{title}</title>}
			<path
				d={d}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle
				cx={s.x(lastIdx).toFixed(1)}
				cy={s.y(last).toFixed(1)}
				r="3"
				className="fill-primary-600 dark:fill-primary-400 stroke-white dark:stroke-slate-800"
				strokeWidth="2"
			/>
		</svg>
	);
}
