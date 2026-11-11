import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import { controlFocus } from './focus';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
	size?: 'sm' | 'md' | 'lg';
	loading?: boolean;
	full?: boolean;
	/** React 19: ref is a plain prop on function components (Popover anchors). */
	ref?: React.Ref<HTMLButtonElement>;
}

// Style guide decision 12 (Alex, 2026-11-05): every button carries a
// border, so an action never reads as a bare word. The border width, corner
// radius and weight come from CSS variables (--btn-border-w, --btn-radius,
// --btn-weight) that Admin › Design system can override; globals.css holds
// the defaults (1px, the md radius, 500).
const variantClasses: Record<string, string> = {
	// primary-700, not -600: white on primary-600 is 3.70:1, below the 4.5:1
	// WCAG AA floor for body text. primary-700 is 4.89:1.
	primary:
		'border-primary-700 bg-primary-700 text-white hover:bg-primary-800 hover:border-primary-800 active:bg-primary-900',
	secondary:
		'border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-600',
	ghost:
		'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100',
	outline:
		'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700/45',
	// Destructive confirm (Delete for good). White on danger is 4.5:1.
	danger:
		'border-red-600 bg-red-600 text-white hover:bg-red-700 hover:border-red-700',
};

// Vertical padding subtracts the border so heights stay put whatever the
// border width setting is. The gap spaces the icon: don't add mr-*/ml-* to
// icons inside a Button.
const sizeClasses: Record<string, string> = {
	sm: 'px-2 py-[calc(0.25rem-var(--btn-border-w))] text-xs gap-1.5',
	md: 'px-3 py-[calc(0.5rem-var(--btn-border-w))] text-sm gap-1.5',
	lg: 'px-4 py-[calc(0.625rem-var(--btn-border-w))] text-sm gap-2',
};

export const buttonBase =
	'inline-flex items-center justify-center [border-width:var(--btn-border-w)] border-solid rounded-[var(--btn-radius)] [font-weight:var(--btn-weight)] transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

/** The class string a Button would render, for a Link that must look like one. */
export function buttonClasses(variant: NonNullable<ButtonProps['variant']> = 'primary', size: NonNullable<ButtonProps['size']> = 'md', extra?: string): string {
	return clsx(buttonBase, controlFocus, variantClasses[variant], sizeClasses[size], extra);
}

export default function Button({
	variant = 'primary',
	size = 'md',
	loading = false,
	full = false,
	children,
	className,
	disabled,
	...props
}: ButtonProps) {
	// No default `type`: forms across the app rely on a bare <Button> submitting.
	return (
		<button
			className={clsx(buttonBase, controlFocus, variantClasses[variant], sizeClasses[size], full && 'w-full', className)}
			disabled={disabled || loading}
			{...props}
		>
			{loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
			{children}
		</button>
	);
}
