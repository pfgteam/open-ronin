import { clsx } from 'clsx';

interface BadgeProps {
	children: React.ReactNode;
	color?: 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger';
	className?: string;
}

const colorClasses: Record<string, string> = {
	// dark:text-slate-300, not -400: slate-400 on slate-700 is 4.35:1, just
	// under the 4.5:1 floor. slate-300 is 6.73:1. Every other tone already
	// clears it comfortably.
	default:
		'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-transparent',
	primary:
		'bg-primary-50 dark:bg-primary-950 text-primary-900 dark:text-primary-300 border-transparent',
	/**
	 * Brand lime — identity accents (e.g. Beacon package), never a status.
	 * Light mode uses accent-900: lime is very light, so accent-700 on
	 * accent-50 was only 2.47:1 (accent-800 is 3.67, still short). accent-900
	 * is 5.49:1. Dark mode was already fine at 7.45:1.
	 * Rule of thumb for this scale: lime never carries white text — white on
	 * accent-600 is 1.89:1.
	 */
	accent:
		'bg-accent-50 dark:bg-accent-950/30 text-accent-900 dark:text-accent-400 border-accent-200 dark:border-accent-800',
	success:
		'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
	warning:
		'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
	danger:
		'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
};

export default function Badge({ children, color = 'default', className }: BadgeProps) {
	return (
		<span
			className={clsx(
				'inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-md border',
				colorClasses[color],
				className,
			)}
		>
			{children}
		</span>
	);
}
