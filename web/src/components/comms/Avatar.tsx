// Avatar for chat participants: photo when we have one, initials otherwise,
// a Bot glyph for agents. Plain <img> like TopNav — avatar hosts vary
// (Google, Supabase storage, Slack), so next/image's remotePatterns would
// have to chase every provider.

import { clsx } from 'clsx';
import { Bot } from 'lucide-react';

interface AvatarProps {
	name: string | null | undefined;
	url?: string | null;
	isAgent?: boolean;
	size?: 'xs' | 'sm' | 'md';
	className?: string;
}

const sizeClass = {
	xs: 'w-5 h-5 text-2xs',
	sm: 'w-6 h-6 text-2xs',
	md: 'w-8 h-8 text-xs',
};

const iconClass = {
	xs: 'w-3 h-3',
	sm: 'w-3.5 h-3.5',
	md: 'w-4 h-4',
};

export function initialsOf(name: string | null | undefined): string {
	const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, url, isAgent = false, size = 'sm', className }: AvatarProps) {
	if (url) {
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img
				src={url}
				alt=""
				className={clsx('rounded-full object-cover bg-slate-100 dark:bg-slate-700 shrink-0', sizeClass[size], className)}
			/>
		);
	}
	if (isAgent) {
		return (
			<span
				className={clsx(
					'rounded-full bg-accent-100 dark:bg-accent-950/40 text-accent-700 dark:text-accent-400 flex items-center justify-center shrink-0',
					sizeClass[size],
					className,
				)}
				aria-hidden="true"
			>
				<Bot className={iconClass[size]} />
			</span>
		);
	}
	return (
		<span
			className={clsx(
				'rounded-full bg-primary-600 text-white font-bold flex items-center justify-center shrink-0',
				sizeClass[size],
				className,
			)}
			aria-hidden="true"
		>
			{initialsOf(name)}
		</span>
	);
}
