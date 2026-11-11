'use client';

// Shared checkbox — native <input type="checkbox"> renders inconsistently in
// dark mode (some browsers keep a light box / default-blue tick regardless
// of theme), which is why the bulk-select checkboxes in Priorities/Client
// Work looked wrong against a dark background (Sam, 2026-08-10: "o fundo
// deles tem que ser escuro e o check teal"). Fully custom via
// appearance-none: the box always follows the surface it's on (white/light
// border in light mode, dark slate in dark mode) and the checkmark is always
// brand teal (primary), in both themes — not a solid teal-filled box, just a
// teal tick so it reads consistently with the rest of the UI's accent color.

import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { Check } from 'lucide-react';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
	({ className, ...props }, ref) => {
		return (
			<span className="relative inline-flex items-center justify-center w-4 h-4 shrink-0">
				<input
					ref={ref}
					type="checkbox"
					className={clsx(
						'peer appearance-none w-4 h-4 rounded-md border cursor-pointer transition-colors',
						'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800',
						'checked:border-primary-500 dark:checked:border-primary-500',
						'hover:border-primary-400 dark:hover:border-primary-400',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
						'disabled:opacity-50 disabled:cursor-not-allowed',
						className,
					)}
					{...props}
				/>
				<Check
					className="absolute w-3 h-3 text-primary-600 dark:text-primary-400 pointer-events-none opacity-0 peer-checked:opacity-100"
					strokeWidth={3}
				/>
			</span>
		);
	},
);

Checkbox.displayName = 'Checkbox';

export default Checkbox;
