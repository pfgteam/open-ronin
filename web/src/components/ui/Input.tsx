import { clsx } from 'clsx';
import { fieldFocus, fieldFocusError } from './focus';
import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	label?: string;
	error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
	({ label, error, className, id, ...props }, ref) => {
		const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

		return (
			<div className="flex flex-col gap-1">
				{label && (
					<label
						htmlFor={inputId}
						className="text-sm font-medium text-slate-700 dark:text-slate-300"
					>
						{label}
					</label>
				)}
				<input
					ref={ref}
					id={inputId}
					className={clsx(
						'w-full rounded-md border px-3 py-2 text-sm transition-colors duration-150',
						'bg-white dark:bg-slate-800',
						'placeholder:text-slate-400 dark:placeholder:text-slate-500',
						error ? fieldFocusError : fieldFocus,
						error
							? 'border-red-300 dark:border-red-700'
							: 'border-slate-300 dark:border-slate-600',
						className,
					)}
					{...props}
				/>
				{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
			</div>
		);
	},
);

Input.displayName = 'Input';

export default Input;
