// Server rendered SVG chart set. Sparkline grew into this: the same scale math
// (./scale.ts), the same theme tokens, no client JS and no chart library
// (WIP_BUILD_PLAN.md, "what to say no to"). Hover text goes through <title>
// so screen readers and the mouse get the same numbers.
//
// Colors are Tailwind classes on the SVG nodes, never hex: the de-emphasis
// hue is slate, the highlight is primary, the goal line is amber (warning /
// at risk is the right family for a quota), success is green.

import type { ReactNode } from 'react';
import { barSlots, domain, linePath, scale, tickLabel, yTicks, type Frame, type Point } from './scale';

/** Series color roles, mapped to token classes for stroke and fill. */
export type SeriesTone = 'primary' | 'muted' | 'success' | 'warning' | 'danger' | 'accent';

const STROKE: Record<SeriesTone, string> = {
	primary: 'stroke-primary-600 dark:stroke-primary-400',
	muted: 'stroke-slate-400 dark:stroke-slate-500',
	success: 'stroke-green-600 dark:stroke-green-400',
	warning: 'stroke-amber-500 dark:stroke-amber-400',
	danger: 'stroke-red-600 dark:stroke-red-400',
	accent: 'stroke-accent-600 dark:stroke-accent-400',
};

const FILL: Record<SeriesTone, string> = {
	primary: 'fill-primary-600 dark:fill-primary-400',
	muted: 'fill-slate-300 dark:fill-slate-600',
	success: 'fill-green-500 dark:fill-green-400',
	warning: 'fill-amber-400 dark:fill-amber-400',
	danger: 'fill-red-500 dark:fill-red-400',
	accent: 'fill-accent-500 dark:fill-accent-400',
};

const AXIS_TEXT = 'fill-slate-400 dark:fill-slate-500';
const GRID = 'stroke-slate-200 dark:stroke-slate-700';

export interface Series {
	label: string;
	values: Point[];
	tone?: SeriesTone;
	/** Dashed, no end marker: goal and quota lines. */
	dashed?: boolean;
}

interface ChartFrameProps {
	width: number;
	height: number;
	title?: string;
	className?: string;
	children: ReactNode;
}

function ChartFrame({ width, height, title, className, children }: ChartFrameProps) {
	return (
		<svg
			width="100%"
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			className={`block text-slate-400 dark:text-slate-500 ${className ?? ''}`}
			role="img"
		>
			{title && <title>{title}</title>}
			{children}
		</svg>
	);
}

interface AxesProps {
	frame: Frame;
	dom: { min: number; max: number };
	labels?: string[];
	count: number;
	yFmt?: (v: number) => string;
}

/** Three horizontal grid lines with y labels on the left, x labels below. */
function Axes({ frame, dom, labels, count, yFmt = tickLabel }: AxesProps) {
	const s = scale(count, frame, dom);
	const ticks = yTicks(dom, 3);
	return (
		<g>
			{ticks.map((t) => (
				<g key={t}>
					<line
						x1={frame.pad}
						x2={frame.width - frame.pad}
						y1={s.y(t).toFixed(1)}
						y2={s.y(t).toFixed(1)}
						className={GRID}
						strokeWidth="1"
						strokeDasharray={t === dom.min ? undefined : '2 3'}
					/>
					<text x={frame.pad} y={(s.y(t) - 3).toFixed(1)} className={`${AXIS_TEXT} text-2xs`} fontSize="10">
						{yFmt(t)}
					</text>
				</g>
			))}
			{labels &&
				labels.map((l, i) => {
					if (!l) return null;
					const anchor = i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle';
					return (
						<text
							key={i}
							x={s.x(i).toFixed(1)}
							y={frame.height - 2}
							textAnchor={anchor}
							className={AXIS_TEXT}
							fontSize="10"
						>
							{l}
						</text>
					);
				})}
		</g>
	);
}

// ---------------------------------------------------------------------------
// LineChart: one or more series on a shared y axis, optional dashed lines.
// ---------------------------------------------------------------------------

interface LineChartProps {
	series: Series[];
	/** One label per index; empty strings are skipped. */
	labels?: string[];
	width?: number;
	height?: number;
	title?: string;
	includeZero?: boolean;
	yFmt?: (v: number) => string;
	className?: string;
}

export function LineChart({
	series,
	labels,
	width = 600,
	height = 180,
	title,
	includeZero = true,
	yFmt,
	className,
}: LineChartProps) {
	const count = Math.max(...series.map((s) => s.values.length), 0);
	if (count === 0) return null;
	const frame: Frame = { width, height, pad: 8, labelGutter: labels ? 14 : 0 };
	const dom = domain(
		series.map((s) => s.values),
		includeZero,
	);
	const s = scale(count, frame, dom);

	return (
		<ChartFrame width={width} height={height} title={title} className={className}>
			<Axes frame={frame} dom={dom} labels={labels} count={count} yFmt={yFmt} />
			{series.map((ser) => {
				const tone = ser.tone ?? 'primary';
				const d = linePath(ser.values, s);
				if (!d) return null;
				const lastIdx = ser.values.reduce<number>((acc, v, i) => (v != null && Number.isFinite(v) ? i : acc), -1);
				const last = lastIdx >= 0 ? (ser.values[lastIdx] as number) : null;
				return (
					<g key={ser.label}>
						<title>{ser.label}</title>
						<path
							d={d}
							fill="none"
							className={STROKE[tone]}
							strokeWidth={ser.dashed ? 1.5 : 2}
							strokeDasharray={ser.dashed ? '4 4' : undefined}
							strokeLinecap="round"
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
						/>
						{!ser.dashed && last != null && (
							<circle
								cx={s.x(lastIdx).toFixed(1)}
								cy={s.y(last).toFixed(1)}
								r="3"
								className={`${FILL[tone]} stroke-white dark:stroke-slate-800`}
								strokeWidth="2"
							/>
						)}
					</g>
				);
			})}
		</ChartFrame>
	);
}

// ---------------------------------------------------------------------------
// BarChart: one series as columns, optional line overlay (a goal line).
// ---------------------------------------------------------------------------

interface BarChartProps {
	values: Point[];
	labels?: string[];
	/** Per bar hover text; defaults to the value. */
	titles?: string[];
	tone?: SeriesTone;
	/** Drawn over the bars as a dashed line, e.g. the monthly quota. */
	overlay?: Series;
	width?: number;
	height?: number;
	title?: string;
	yFmt?: (v: number) => string;
	className?: string;
}

export function BarChart({
	values,
	labels,
	titles,
	tone = 'primary',
	overlay,
	width = 600,
	height = 180,
	title,
	yFmt,
	className,
}: BarChartProps) {
	const count = values.length;
	if (count === 0) return null;
	const frame: Frame = { width, height, pad: 8, labelGutter: labels ? 14 : 0 };
	const dom = domain([values, overlay?.values ?? []], true);
	const s = scale(count, frame, dom);
	const slots = barSlots(count, frame);
	const base = s.zeroY ?? s.y(dom.min);

	return (
		<ChartFrame width={width} height={height} title={title} className={className}>
			<Axes frame={frame} dom={dom} labels={labels} count={count} yFmt={yFmt} />
			{values.map((v, i) => {
				if (v == null || !Number.isFinite(v)) return null;
				const top = Math.min(s.y(v), base);
				const h = Math.max(Math.abs(s.y(v) - base), v === 0 ? 0 : 1);
				return (
					<rect
						key={i}
						x={slots.left(i).toFixed(1)}
						y={top.toFixed(1)}
						width={slots.bar.toFixed(1)}
						height={h.toFixed(1)}
						rx="1.5"
						className={FILL[tone]}
					>
						<title>{titles?.[i] ?? String(v)}</title>
					</rect>
				);
			})}
			{overlay && (
				<path
					d={linePath(
						overlay.values,
						scale(count, frame, dom),
					)}
					fill="none"
					className={STROKE[overlay.tone ?? 'warning']}
					strokeWidth="1.5"
					strokeDasharray="4 4"
					vectorEffect="non-scaling-stroke"
				>
					<title>{overlay.label}</title>
				</path>
			)}
		</ChartFrame>
	);
}

// ---------------------------------------------------------------------------
// StackedBarChart: several series stacked per index (e.g. secured versus
// live, or package families per month).
// ---------------------------------------------------------------------------

interface StackedBarChartProps {
	series: Series[];
	labels?: string[];
	width?: number;
	height?: number;
	title?: string;
	yFmt?: (v: number) => string;
	className?: string;
}

export function StackedBarChart({ series, labels, width = 600, height = 180, title, yFmt, className }: StackedBarChartProps) {
	const count = Math.max(...series.map((s) => s.values.length), 0);
	if (count === 0) return null;
	const totals: Point[] = Array.from({ length: count }, (_, i) =>
		series.reduce<number>((acc, s) => acc + (s.values[i] ?? 0), 0),
	);
	const frame: Frame = { width, height, pad: 8, labelGutter: labels ? 14 : 0 };
	const dom = domain([totals], true);
	const s = scale(count, frame, dom);
	const slots = barSlots(count, frame);
	const base = s.zeroY ?? s.y(0);

	return (
		<ChartFrame width={width} height={height} title={title} className={className}>
			<Axes frame={frame} dom={dom} labels={labels} count={count} yFmt={yFmt} />
			{Array.from({ length: count }, (_, i) => {
				let running = 0;
				return (
					<g key={i}>
						{series.map((ser) => {
							const v = ser.values[i] ?? 0;
							if (!v) return null;
							const y0 = s.y(running);
							running += v;
							const y1 = s.y(running);
							return (
								<rect
									key={ser.label}
									x={slots.left(i).toFixed(1)}
									y={Math.min(y0, y1).toFixed(1)}
									width={slots.bar.toFixed(1)}
									height={Math.max(Math.abs(y0 - y1), 1).toFixed(1)}
									className={FILL[ser.tone ?? 'primary']}
								>
									<title>{`${ser.label}: ${v}${labels?.[i] ? ` (${labels[i]})` : ''}`}</title>
								</rect>
							);
						})}
						<line
							x1={slots.left(i).toFixed(1)}
							x2={(slots.left(i) + slots.bar).toFixed(1)}
							y1={base.toFixed(1)}
							y2={base.toFixed(1)}
							className={GRID}
							strokeWidth="1"
						/>
					</g>
				);
			})}
		</ChartFrame>
	);
}

// ---------------------------------------------------------------------------
// Legend: swatches with the token colors, for use beside any chart.
// ---------------------------------------------------------------------------

export function ChartLegend({ items }: { items: { label: string; tone?: SeriesTone; dashed?: boolean }[] }) {
	return (
		<ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-slate-500 dark:text-slate-400">
			{items.map((it) => (
				<li key={it.label} className="inline-flex items-center gap-1.5">
					<svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true">
						{it.dashed ? (
							<line x1="0" y1="4" x2="14" y2="4" className={STROKE[it.tone ?? 'warning']} strokeWidth="2" strokeDasharray="3 2" />
						) : (
							<rect x="0" y="0" width="14" height="8" rx="2" className={FILL[it.tone ?? 'primary']} />
						)}
					</svg>
					{it.label}
				</li>
			))}
		</ul>
	);
}
