import { clsx } from 'clsx';

interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	active?: boolean;
	/** Optional count rendered after the label, dashboards-style. */
	count?: number | string;
	/**
	 * default = primary tint (the dashboards look). danger/warning are for
	 * exception pills (overdue, needs-attention) — solid red/amber when
	 * active, tinted when idle. Taken from the home exception strip.
	 */
	tone?: 'default' | 'danger' | 'warning';
}

const toneClasses: Record<string, { active: string; idle: string }> = {
	default: {
		active: 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300',
		idle: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
	},
	danger: {
		active: 'bg-red-600 border-red-600 text-white',
		idle: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
	},
	warning: {
		// slate-900 on amber-500 is 7.59:1; white on amber-500 was 2.15:1.
		// Keeping the amber background preserves the warning hue — only the
		// text colour changes. (The danger tone below is already fine at
		// 4.83:1, so this was an inconsistency, not a pattern.)
		active: 'bg-amber-500 border-amber-500 text-slate-900',
		idle: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
	},
};

/**
 * Canonical filter pill — the single style for filter toggles across the app.
 * Taken from the Dashboards module (the reference layout): rounded-full,
 * soft primary tint when active, muted bordered pill when idle.
 */
export default function FilterChip({
	active = false,
	count,
	tone = 'default',
	className,
	children,
	...props
}: FilterChipProps) {
	return (
		<button
			type="button"
			aria-pressed={active}
			className={clsx(
				'text-xs px-2.5 py-1 rounded-full border transition-colors',
				// Every other control carries this; the chip was the one primitive
				// a keyboard user could tab onto with no visible indication.
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
				active ? toneClasses[tone].active : toneClasses[tone].idle,
				className,
			)}
			{...props}
		>
			{children}
			{count != null && <span className="ml-1.5 tabular-nums opacity-60">{count}</span>}
		</button>
	);
}
