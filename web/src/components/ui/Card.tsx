import { clsx } from 'clsx';

interface CardProps {
	children: React.ReactNode;
	className?: string;
	padding?: 'none' | 'sm' | 'md' | 'lg';
	/** Anchor target (e.g. #metric-form deep links). */
	id?: string;
}

const paddingMap = {
	none: '',
	sm: 'p-3',
	md: 'p-4',
	lg: 'p-6',
};

export default function Card({ children, className, padding = 'md', id }: CardProps) {
	return (
		<div
			id={id}
			className={clsx(
				'bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700',
				paddingMap[padding],
				className,
			)}
		>
			{children}
		</div>
	);
}
