import { clsx } from 'clsx';
import { fieldFocus } from './focus';
import { forwardRef } from 'react';
import { Search } from 'lucide-react';

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	/** Required — the input has no visible label, only the icon. */
	'aria-label': string;
}

/**
 * Canonical search box. Replaces ad-hoc icon-plus-input markup — before this
 * component existed there were 7 hand-rolled search inputs with two different
 * dark backgrounds and two ring widths. Same visual language as Input/Select:
 * white/slate-800 surface, slate-200/700 border, primary focus ring, text-xs
 * (search lives in toolbars). Width goes on `className` (wraps the container);
 * works controlled (value + onChange) or uncontrolled.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
	({ className, type = 'search', ...props }, ref) => {
		return (
			<div className={clsx('relative', className)}>
				<Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
				<input
					ref={ref}
					type={type}
					className={clsx(
						'w-full pl-7 pr-2 py-1.5 text-xs rounded-md transition-colors duration-150',
						'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800',
						'text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500',
						fieldFocus,
					)}
					{...props}
				/>
			</div>
		);
	},
);

SearchInput.displayName = 'SearchInput';

export default SearchInput;
