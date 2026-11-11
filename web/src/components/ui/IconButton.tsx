import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { controlFocus } from './focus';

// IconButton — the square icon-only button (close, more, settings gear).
// `bordered` (default) is for buttons that sit in page content (decision 12:
// actions are bordered); chrome (TopNav, a Dialog header, a Toast) may pass
// bordered={false}. An aria-label is required: there is no visible text.

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
	'aria-label': string;
	size?: 'sm' | 'md';
	bordered?: boolean;
	active?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{ size = 'md', bordered = true, active = false, className, type = 'button', children, ...props },
	ref,
) {
	return (
		<button
			ref={ref}
			type={type}
			className={clsx(
				'inline-flex shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100',
				size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
				bordered && 'border border-slate-300 dark:border-slate-600',
				active && 'bg-selected text-primary-800 dark:text-primary-300',
				controlFocus,
				className,
			)}
			{...props}
		>
			{children}
		</button>
	);
});

export default IconButton;
