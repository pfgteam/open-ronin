'use client';

// TagInput — free-string list editor (fit industries, free email domains):
// chips with ×, an input that adds on Enter or comma, an optional per-item
// validator. Replaces raw JSON arrays in textareas.

import { useState } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { controlFocus, fieldFocus } from '@/components/ui/focus';

export default function TagInput({ value, onChange, validate, placeholder, disabled, ariaLabel }: {
	value: string[];
	onChange: (next: string[]) => void;
	validate?: (item: string) => string | null;
	placeholder?: string;
	disabled?: boolean;
	ariaLabel: string;
}) {
	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);
	const add = () => {
		const items = draft.split(',').map((s) => s.trim()).filter(Boolean);
		if (!items.length) return;
		for (const it of items) {
			const e = validate?.(it);
			if (e) {
				setError(`${it}: ${e}`);
				return;
			}
		}
		const lower = new Set(value.map((v) => v.toLowerCase()));
		onChange([...value, ...items.filter((it) => !lower.has(it.toLowerCase()))]);
		setDraft('');
		setError(null);
	};
	return (
		<div className="space-y-1.5" role="group" aria-label={ariaLabel}>
			<div className="flex flex-wrap gap-1.5">
				{value.map((v, i) => (
					// Index in the key: a stored list can hold the same entry twice, and two equal keys confuse React.
					<span key={`${i}:${v}`} className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-0.5 text-xs dark:border-slate-600">
						{v}
						{!disabled && (
							<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className={clsx('rounded-full text-slate-500', controlFocus)}>
								<X className="h-3 w-3" />
							</button>
						)}
					</span>
				))}
				{!disabled && (
					<input
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ',') {
								e.preventDefault();
								add();
							}
						}}
						onBlur={add}
						placeholder={placeholder ?? 'Add…'}
						aria-label={`Add to ${ariaLabel}`}
						className={clsx('min-w-36 flex-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800', fieldFocus)}
					/>
				)}
			</div>
			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
		</div>
	);
}
