'use client';

// ChipSelect — multi-select as toggle chips over a fixed option list (deal
// columns, counts-as buckets, stages). Stored values that are not options
// render amber ("unknown") and can only be removed, so bad legacy data is
// visible instead of silently kept.

import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { controlFocus } from '@/components/ui/focus';

type Opt = { value: string; label: string };

export default function ChipSelect({ options, value, onChange, disabled, groups, keepUnknown = [], ariaLabel }: {
	options?: Opt[];
	/** Grouped options (e.g. stages by pipeline); used instead of `options` when given. */
	groups?: { group: string; options: Opt[] }[];
	value: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
	/** Unknown values to keep without warning (legacy values the backend still accepts). */
	keepUnknown?: string[];
	ariaLabel: string;
}) {
	const all = groups ? groups.flatMap((g) => g.options) : (options ?? []);
	const known = new Set(all.map((o) => o.value));
	const unknown = value.filter((v) => !known.has(v));
	const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
	const chip = (o: Opt) => {
		const on = value.includes(o.value);
		return (
			<button
				key={o.value}
				type="button"
				disabled={disabled}
				aria-pressed={on}
				onClick={() => toggle(o.value)}
				className={clsx(
					'rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-60',
					controlFocus,
					on ? 'border-primary-600 bg-primary-50 font-semibold text-primary-900 dark:bg-primary-950 dark:text-primary-300' : 'border-slate-300 hover:bg-hover dark:border-slate-600',
				)}
			>
				{o.label}
			</button>
		);
	};
	return (
		<div role="group" aria-label={ariaLabel} className="space-y-1.5">
			{groups ? (
				groups.map((g) => (
					<div key={g.group}>
						<p className="mb-1 text-2xs font-medium uppercase tracking-wide text-slate-500">{g.group}</p>
						<div className="flex flex-wrap gap-1.5">{g.options.map(chip)}</div>
					</div>
				))
			) : (
				<div className="flex flex-wrap gap-1.5">{all.map(chip)}</div>
			)}
			{unknown.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{unknown.map((v) => {
						const legacy = keepUnknown.includes(v);
						return (
							<span key={v} className={clsx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs', legacy ? 'border-slate-300 text-slate-500 dark:border-slate-600' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}>
								{legacy ? `legacy: ${v}` : `unknown: ${v}`}
								{!disabled && (
									<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className={clsx('rounded-full', controlFocus)}>
										<X className="h-3 w-3" />
									</button>
								)}
							</span>
						);
					})}
				</div>
			)}
		</div>
	);
}
