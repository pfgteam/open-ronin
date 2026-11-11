'use client';

// Accumulative (multi-select) filter dropdown — replaces the old single-
// <select> filters across Priorities and Client Work per Sam 2026-08-10:
// filters should let you pick several owners/statuses/etc at once (OR within
// the field) rather than being forced to pick exactly one. Different filter
// fields still combine as AND (owner IN [...] AND status IN [...] etc) —
// only the values within one field are additive.
//
// Deliberately hand-rolled (no combobox dependency) to match the rest of
// The Work's plain-Tailwind form controls.

import { useRef, useState } from 'react';
import { CheckSquare, ChevronDown, X } from 'lucide-react';
import Popover from '@/components/ui/Popover';

export interface MultiSelectOption {
	value: string;
	label: string;
	/** Indent one level — used for sub-team options grouped under a department. */
	indent?: boolean;
}

interface Props {
	label: string;
	icon?: React.ReactNode;
	options: MultiSelectOption[];
	selected: string[];
	onChange: (values: string[]) => void;
	placeholderAll?: string;
	disabled?: boolean;
	minWidth?: string;
	emptyText?: string;
	/** Overrides the button text, e.g. for exclusion-style filters that start with everything checked. */
	summary?: string;
}

export default function MultiSelectFilter({
	label, icon, options, selected, onChange, placeholderAll = 'All', disabled, minWidth = '150px', emptyText = 'No options', summary: summaryOverride,
}: Props) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);

	function toggle(value: string) {
		onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
	}

	const allSelected = options.length > 0 && options.every((o) => selected.includes(o.value));

	const summary = summaryOverride ??
		(selected.length === 0 ? placeholderAll
		: selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
		: `${selected.length} selected`);

	return (
		<div className="inline-block">
			<button
				ref={buttonRef}
				type="button"
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				style={{ minWidth }}
				className={`text-xs rounded-md border bg-white dark:bg-slate-900 px-2 py-1.5 inline-flex items-center justify-between gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed ${
					selected.length > 0
						? 'border-primary-300 dark:border-primary-700 text-slate-900 dark:text-slate-100'
						: 'border-slate-200 dark:border-slate-700 text-slate-500'
				}`}
			>
				<span className="inline-flex items-center gap-1.5 truncate">
					{icon}
					{label ? <span className="text-slate-400">{label}:</span> : null} {summary}
				</span>
				<ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
			</button>
			<Popover open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} width="w-56">
				<div className="max-h-64 overflow-y-auto py-1">
					{options.length > 0 && (
						<div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-slate-100 dark:border-slate-700/50 mb-1">
							<button
								type="button"
								disabled={allSelected}
								onClick={() => onChange(options.map((o) => o.value))}
								className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 disabled:opacity-40 disabled:hover:text-slate-600 dark:text-slate-400 inline-flex items-center gap-1 transition-colors"
							>
								<CheckSquare className="w-3 h-3" /> Select all
							</button>
							{selected.length > 0 && (
								<button
									type="button"
									onClick={() => onChange([])}
									className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 inline-flex items-center gap-1 transition-colors"
								>
									<X className="w-3 h-3" /> Clear
								</button>
							)}
						</div>
					)}
					{options.length === 0 && (
						<div className="text-2xs text-slate-600 dark:text-slate-400 px-2.5 py-1.5 italic">{emptyText}</div>
					)}
					{options.map((o) => {
						const on = selected.includes(o.value);
						return (
							<label
								key={o.value}
								className={`transition-colors flex items-center gap-2 text-xs px-2.5 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 ${o.indent ? 'pl-5' : ''}`}
							>
								<input
									type="checkbox"
									checked={on}
									onChange={() => toggle(o.value)}
									className="rounded-md border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
								/>
								<span className="truncate text-slate-700 dark:text-slate-300">{o.label}</span>
							</label>
						);
					})}
				</div>
			</Popover>
		</div>
	);
}
