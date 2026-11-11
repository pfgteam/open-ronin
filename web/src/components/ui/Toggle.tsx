'use client';

import { clsx } from 'clsx';
import { controlFocus } from './focus';

// Toggle — an immediate on/off setting (it saves when flipped). Use a
// Checkbox inside a form that has its own Save; use a Toggle when the change
// takes effect at once. Renders a real <button role="switch">.

interface ToggleProps {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	/** Visually hide the label (still read by screen readers). */
	hideLabel?: boolean;
	disabled?: boolean;
	id?: string;
	className?: string;
}

export default function Toggle({ checked, onChange, label, hideLabel = false, disabled, id, className }: ToggleProps) {
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={clsx('group inline-flex items-center gap-2 rounded-md text-sm text-slate-700 disabled:opacity-50 dark:text-slate-300', controlFocus, className)}
		>
			<span
				className={clsx(
					'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150',
					checked ? 'border-primary-700 bg-primary-700' : 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700',
				)}
				aria-hidden="true"
			>
				<span className={clsx('absolute h-3.5 w-3.5 rounded-full bg-white transition-transform duration-150', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
			</span>
			<span className={clsx(hideLabel && 'sr-only')}>{label}</span>
		</button>
	);
}
