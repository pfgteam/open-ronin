/**
 * Canonical page header — the single H1 pattern for every page.
 * Modeled on the Dashboards module (the reference layout for the app):
 * compact `text-xl font-semibold` title, muted one-line description,
 * actions right-aligned, `mb-6` before content.
 *
 * Do not hand-roll page titles: before this component existed, pages were
 * split between text-xl / text-2xl / text-3xl with no pattern per module.
 */
import { clsx } from 'clsx';

interface PageHeaderProps {
	title: React.ReactNode;
	/** One line of context under the title (record counts, data source, date). */
	description?: React.ReactNode;
	/** Right-aligned actions (buttons, view toggles). */
	actions?: React.ReactNode;
	/** Set when the parent already provides vertical rhythm (e.g. a space-y-* wrapper). */
	flush?: boolean;
	className?: string;
}

export default function PageHeader({ title, description, actions, flush = false, className }: PageHeaderProps) {
	return (
		<div className={clsx('flex items-start justify-between gap-4', !flush && 'mb-6', className)}>
			<div className="min-w-0">
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
				{description && (
					<p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{description}</p>
				)}
			</div>
			{actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
		</div>
	);
}
