import Link from 'next/link';
import { clsx } from 'clsx';
import { controlFocus } from './focus';

// LinkCard — a Card whose WHOLE surface is the link (style guide decision
// 11, Alex): hover and cursor on all of it, never a title-only hot spot.
// Put secondary actions outside the card, or stop propagation on them.

interface LinkCardProps {
	href: string;
	children: React.ReactNode;
	className?: string;
	padding?: 'none' | 'sm' | 'md';
	prefetch?: boolean;
	'aria-label'?: string;
}

export default function LinkCard({ href, children, className, padding = 'md', prefetch, ...rest }: LinkCardProps) {
	return (
		<Link
			href={href}
			prefetch={prefetch}
			aria-label={rest['aria-label']}
			className={clsx(
				'block cursor-pointer rounded-lg border border-slate-200 bg-white transition-colors duration-150 hover:border-primary-300 hover:bg-hover dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-700',
				padding === 'sm' ? 'p-3' : padding === 'md' ? 'p-4' : '',
				controlFocus,
				className,
			)}
		>
			{children}
		</Link>
	);
}
