import { clsx } from 'clsx';

/**
 * Loading placeholder. Prefer skeletons over spinners/"Loading…" text for
 * lists, tables and cards — they keep the layout stable while data loads.
 */
export default function Skeleton({ className }: { className?: string }) {
	return (
		<div
			className={clsx('animate-pulse rounded-md bg-slate-100 dark:bg-slate-700/50', className)}
		/>
	);
}

/** N stacked text-line skeletons (for list/table bodies). */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
	return (
		<div className={clsx('space-y-2', className)}>
			{Array.from({ length: rows }).map((_, i) => (
				<Skeleton key={i} className="h-4 w-full" />
			))}
		</div>
	);
}
