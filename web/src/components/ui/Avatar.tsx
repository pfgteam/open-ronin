import { clsx } from 'clsx';
import { vizFor } from '@/lib/colors';

// Avatar — initials on a token-backed colour (style guide decision 8), or a
// photo when one is set. One component for the board, the drawer, the
// personal page and the directory chips.

interface AvatarProps {
	id: string | null | undefined;
	name: string;
	initials?: string;
	photoUrl?: string | null;
	size?: number;
	className?: string;
	title?: string;
}

export function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return '?';
	return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase();
}

export default function Avatar({ id, name, initials, photoUrl, size = 24, className, title }: AvatarProps) {
	const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) };
	if (photoUrl) {
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img src={photoUrl} alt="" title={title ?? name} className={clsx('shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-slate-800', className)} style={style} />
		);
	}
	return (
		<span
			title={title ?? name}
			aria-label={name}
			role="img"
			className={clsx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-800', className)}
			style={{ ...style, background: vizFor(id) }}
		>
			{initials ?? initialsOf(name)}
		</span>
	);
}
