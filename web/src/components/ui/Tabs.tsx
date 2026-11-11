'use client';

import { clsx } from 'clsx';
import { useRef } from 'react';
import { controlFocus } from './focus';

// Tabs — one tab strip for the app (The Work hub tabs, drawer tabs, the
// design system's Light / Dark switch). Arrow keys move between tabs
// (WAI-ARIA tabs pattern, automatic activation). `count` renders a badge;
// it must be the TRUE filtered count (rework D2), never a page size.

export interface TabItem<K extends string = string> {
	key: K;
	label: string;
	count?: number | null;
	icon?: React.ComponentType<{ className?: string }>;
	href?: string;
}

interface TabsProps<K extends string> {
	items: TabItem<K>[];
	value: K;
	onChange: (key: K) => void;
	label: string;
	size?: 'sm' | 'md';
	className?: string;
}

export default function Tabs<K extends string>({ items, value, onChange, label, size = 'md', className }: TabsProps<K>) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const onKey = (e: React.KeyboardEvent, i: number) => {
		let next = -1;
		if (e.key === 'ArrowRight') next = (i + 1) % items.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = items.length - 1;
		if (next < 0) return;
		e.preventDefault();
		refs.current[next]?.focus();
		onChange(items[next].key);
	};
	return (
		<div role="tablist" aria-label={label} className={clsx('flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700 [scrollbar-width:none]', className)}>
			{items.map((t, i) => {
				const on = t.key === value;
				const Icon = t.icon;
				return (
					<button
						key={t.key}
						ref={(el) => { refs.current[i] = el; }}
						type="button"
						role="tab"
						aria-selected={on}
						tabIndex={on ? 0 : -1}
						onClick={() => onChange(t.key)}
						onKeyDown={(e) => onKey(e, i)}
						className={clsx(
							'-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 transition-colors duration-150',
							size === 'sm' ? 'px-2.5 py-1.5 text-13' : 'px-3 py-2 text-sm',
							on
								? 'border-primary-600 font-semibold text-primary-800 dark:border-primary-400 dark:text-primary-300'
								: 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
							controlFocus,
						)}
					>
						{Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
						{t.label}
						{typeof t.count === 'number' && (
							<span className={clsx('rounded-full px-1.5 text-2xs tabular-nums', on ? 'bg-primary-100 text-primary-900 dark:bg-primary-950 dark:text-primary-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300')}>
								{t.count.toLocaleString()}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
