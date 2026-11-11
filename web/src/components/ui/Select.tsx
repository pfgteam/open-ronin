import { clsx } from 'clsx';
import { fieldFocus, fieldFocusError } from './focus';
import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
	label?: string;
	error?: string;
	/** sm = toolbar/filter contexts, md = forms (matches Input) */
	size?: 'sm' | 'md';
}

const sizeClasses: Record<string, string> = {
	sm: 'text-xs px-2 py-1.5 pr-7',
	md: 'text-sm px-3 py-2 pr-8',
};

/**
 * Canonical select. Replaces ad-hoc `<select>` styling — before this component
 * existed there were 75 hand-styled selects with two different dark backgrounds.
 * Same visual language as Input: white/slate-800 surface, slate-200/700 border,
 * primary focus ring.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(
	({ label, error, className, id, size = 'md', children, ...props }, ref) => {
		const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

		return (
			<div className="flex flex-col gap-1">
				{label && (
					<label
						htmlFor={selectId}
						className="text-sm font-medium text-slate-700 dark:text-slate-300"
					>
						{label}
					</label>
				)}
				<div className="relative">
					<select
						ref={ref}
						id={selectId}
						className={clsx(
							'w-full appearance-none rounded-md border transition-colors duration-150',
							'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300',
							error ? fieldFocusError : fieldFocus,
							'disabled:opacity-50 disabled:pointer-events-none',
							sizeClasses[size],
							error
								? 'border-red-300 dark:border-red-700'
								: 'border-slate-300 dark:border-slate-600',
							className,
						)}
						{...props}
					>
						{children}
					</select>
					<ChevronDown
						className={clsx(
							'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400',
							size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4',
						)}
					/>
				</div>
				{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
			</div>
		);
	},
);

Select.displayName = 'Select';

export default Select;
