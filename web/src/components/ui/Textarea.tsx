import { clsx } from 'clsx';
import { fieldFocus, fieldFocusError } from './focus';
import { forwardRef } from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
	label?: string;
	error?: string;
}

/**
 * Canonical textarea, the multi-line sibling of Input: same surface, border
 * and focus ring, so forms that mix the two read as one control family.
 */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, className, id, ...props }, ref) => {
	const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
	return (
		<div className="flex flex-col gap-1">
			{label && (
				<label htmlFor={textareaId} className="text-sm font-medium text-slate-700 dark:text-slate-300">
					{label}
				</label>
			)}
			<textarea
				ref={ref}
				id={textareaId}
				className={clsx(
					'w-full rounded-md border px-3 py-2 text-sm transition-colors duration-150 resize-y min-h-[80px]',
					'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200',
					'placeholder:text-slate-400 dark:placeholder:text-slate-500',
					error ? fieldFocusError : fieldFocus,
					error ? 'border-red-300 dark:border-red-700' : 'border-slate-300 dark:border-slate-600',
					className,
				)}
				{...props}
			/>
			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
		</div>
	);
});

Textarea.displayName = 'Textarea';

export default Textarea;
