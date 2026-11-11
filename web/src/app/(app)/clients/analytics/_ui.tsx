// Shared bits for the Analytics page: KPI tile, section label, empty state.

import Card from '@/components/ui/Card';

export function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
	return (
		<Card>
			<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</div>
			<div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
			{hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
		</Card>
	);
}

export function SectionLabel({ children, count }: { children: React.ReactNode; count?: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2 mb-2">
			<h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h2>
			{count != null && <span className="text-xs tabular-nums text-slate-400">{count}</span>}
			<div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
		</div>
	);
}

/** Honest empty state: names the importer that feeds the missing mirror. */
export function MirrorEmpty({ table, importer }: { table: string; importer: string }) {
	return (
		<p className="text-xs text-slate-500 dark:text-slate-400">
			No rows in <code className="text-2xs">{table}</code> yet. This page reads the mirror only; run{' '}
			<code className="text-2xs">{importer}</code> to fill it.
		</p>
	);
}

export const th = 'px-3 py-2 text-left text-xs font-medium text-slate-400 dark:text-slate-500';
export const thNum = `${th} text-right`;
export const td = 'px-3 py-2 text-xs text-slate-700 dark:text-slate-300';
export const tdNum = `${td} text-right tabular-nums`;
export const tr = 'border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors';
