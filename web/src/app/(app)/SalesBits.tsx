// Self → Sales: the small pieces both the Overview and the Sales tab render.
// Tone semantics per UI_GUIDELINES: red = late/urgent, amber = due/at risk,
// primary = scheduled/info, green = target hit.

import Link from 'next/link';
import { clsx } from 'clsx';
import { controlFocus } from '@/components/ui/focus';
import type { SalesGroupKey, SalesRow, TargetTile } from '@/lib/home/sales';
import { HEAT_LABELS, heatLevel } from '@/lib/revenue/shared';

const NEUTRAL_TAG = 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';

export const GROUP_TAG: Record<SalesGroupKey, { label: string; cls: string }> = {
	new: { label: 'New lead', cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
	calls: { label: 'Call', cls: 'bg-primary-100 text-primary-900 dark:bg-primary-950 dark:text-primary-300' },
	overdue: { label: 'Overdue', cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
	today: { label: 'Today', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
	week: { label: 'This week', cls: NEUTRAL_TAG },
	later: { label: 'Later', cls: NEUTRAL_TAG },
	hold: { label: 'On hold', cls: NEUTRAL_TAG },
	none: { label: 'No next action', cls: NEUTRAL_TAG },
};

export const GROUP_RAIL: Record<SalesGroupKey, string> = {
	new: 'bg-red-500',
	calls: 'bg-primary-500',
	overdue: 'bg-amber-600',
	today: 'bg-amber-400',
	week: 'bg-primary-200',
	later: 'bg-slate-300',
	hold: 'bg-slate-300',
	none: 'bg-slate-200',
};

const HEAT_CLS = { hot: 'text-red-700 dark:text-red-300', warm: 'text-amber-700 dark:text-amber-300', cold: 'text-slate-500' } as const;

export function HeatText({ row }: { row: Pick<SalesRow, 'heat_score' | 'quality_score'> }) {
	const lvl = heatLevel(row.heat_score);
	return (
		<span className={clsx('inline-flex items-center gap-1 text-xs font-semibold', HEAT_CLS[lvl])} title={`Quality ${row.quality_score ?? '–'} · Heat ${row.heat_score ?? '–'}`}>
			<span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
			{HEAT_LABELS[lvl]}
		</span>
	);
}

function Bar({ done, target }: { done: number; target: number }) {
	const p = Math.min(100, Math.round((done / Math.max(target, 1)) * 100));
	return (
		<div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden="true">
			<div className={clsx('h-full', p >= 100 ? 'bg-green-500' : 'bg-primary-500')} style={{ width: `${Math.max(p, 2)}%` }} />
		</div>
	);
}

export function SalesTargets({ tiles, variant, href }: { tiles: TargetTile[]; variant: 'tiles' | 'strip'; href?: string }) {
	if (tiles.length === 0) return null;
	if (variant === 'strip') {
		return (
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Today's targets">
				{tiles.map((t) => (
					<span key={t.key} className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
						{t.label}{t.period === 'week' ? ' (wk)' : ''}
						<span className="w-11"><Bar done={t.done} target={t.target} /></span>
						<span className="tabular-nums text-slate-900 dark:text-slate-100"><b>{t.done}</b>/{t.target}</span>
					</span>
				))}
			</div>
		);
	}
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Today's targets">
			{tiles.map((t) => (
				<Link key={t.key} href={href ?? '/?tab=work&queue=sales'} className={clsx('rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 hover:bg-hover', controlFocus)}>
					<span className="block text-xs text-slate-600 dark:text-slate-400">{t.label} · {t.period === 'day' ? 'today' : 'this week'}</span>
					<span className="block text-2xl font-bold tabular-nums tracking-tight">
						{t.done} <span className="text-sm font-medium text-slate-500">/ {t.target}</span>
					</span>
					<div className="mt-1.5"><Bar done={t.done} target={t.target} /></div>
				</Link>
			))}
		</div>
	);
}
