// The one alert/callout box. Before this existed the same amber/red/green
// banner was hand-built in nine places with drifting borders
// (dark:border-amber-800/70 vs -900), text tones and paddings — _form.tsx's
// FormError was the pattern; this generalizes it with a tone.

import { clsx } from 'clsx';

const tones = {
	error:
		'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300',
	warning:
		'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
	success:
		'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300',
	info:
		'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300',
} as const;

export default function Callout({
	tone = 'info',
	children,
	className,
}: {
	tone?: keyof typeof tones;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div role={tone === 'error' ? 'alert' : 'status'} className={clsx('rounded-md border px-3 py-2 text-sm', tones[tone], className)}>
			{children}
		</div>
	);
}
