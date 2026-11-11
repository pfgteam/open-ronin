import Link from 'next/link';
import { clsx } from 'clsx';

/**
 * Link-shaped FilterChip for server pages whose filters are URL params (a
 * <button> can't wrap an <a>). Same pill visuals as FilterChip so the two
 * read as one filter language. Lifted from /team/sessions' ChipLink.
 */
export default function FilterChipLink({
	href,
	active = false,
	tone = 'default',
	count,
	children,
}: {
	href: string;
	active?: boolean;
	tone?: 'default' | 'warning';
	count?: number | string;
	children: React.ReactNode;
}) {
	const toneClasses =
		tone === 'warning'
			? active
				// slate-900 on amber-500 = 7.59:1; white was 2.15:1. Mirrors FilterChip.
				? 'bg-amber-500 border-amber-500 text-slate-900'
				: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
			: active
				? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
				: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600';
	return (
		<Link
			href={href}
			aria-pressed={active}
			className={clsx('text-xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center', toneClasses)}
		>
			{children}
			{count != null && <span className="ml-1.5 tabular-nums opacity-60">{count}</span>}
		</Link>
	);
}
