// SettingsSection — the anatomy every Admin → Prospects block shares: a card
// with a header (title, one-line description, actions) and its body.

import { clsx } from 'clsx';

export default function SettingsSection({ title, description, actions, children, padded = true, id }: {
	title: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	children: React.ReactNode;
	padded?: boolean;
	id?: string;
}) {
	return (
		<section id={id} className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
				{description && <p className="text-xs text-slate-500">{description}</p>}
				{actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
			</header>
			<div className={clsx(padded && 'px-4 py-3')}>{children}</div>
		</section>
	);
}
