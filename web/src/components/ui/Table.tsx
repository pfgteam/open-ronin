import { clsx } from 'clsx';

// Table building blocks (style guide phase 1). The Work's list screen, the
// design system preview and the module lists share these so the header
// look, the row hover, the sticky offsets and the z scale (z-10 for sticky
// table parts) are defined once.

export function TableScroller({ children, className }: { children: React.ReactNode; className?: string }) {
	// The ONE scroll container for a long list: both axes scroll here, so a
	// sticky header row and sticky first columns work at the same time.
	return <div className={clsx('relative min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800', className)}>{children}</div>;
}

export function Th({ children, className, sticky, left, width, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean; left?: number; width?: number }) {
	return (
		<th
			scope="col"
			className={clsx(
				'sticky top-0 z-10 h-9 border-b border-slate-200 bg-slate-50 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
				sticky && 'z-20',
				className,
			)}
			style={{ ...(sticky ? { left: left ?? 0 } : {}), ...(width ? { width, minWidth: width } : {}) }}
			{...rest}
		>
			{children}
		</th>
	);
}

export function Td({ children, className, sticky, left, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean; left?: number }) {
	return (
		<td
			className={clsx('h-9 border-b border-slate-200 px-2 text-13 text-slate-900 dark:border-slate-700 dark:text-slate-100', sticky && 'sticky z-10 bg-inherit', className)}
			style={sticky ? { left: left ?? 0 } : undefined}
			{...rest}
		>
			{children}
		</td>
	);
}

/** A row whose whole surface opens something (decision 11). Controls inside stop propagation. */
export function Tr({ children, className, selected, clickable, ...rest }: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; clickable?: boolean }) {
	return (
		<tr
			className={clsx(
				'group bg-white dark:bg-slate-800',
				clickable && 'cursor-pointer hover:bg-hover dark:hover:bg-hover',
				selected && 'bg-selected dark:bg-selected',
				className,
			)}
			aria-selected={selected}
			{...rest}
		>
			{children}
		</tr>
	);
}

export function SectionRow({ colSpan, children, className }: { colSpan: number; children: React.ReactNode; className?: string }) {
	return (
		<tr>
			<td colSpan={colSpan} className={clsx('sticky left-0 z-10 bg-slate-50 px-2 py-1.5 text-13 font-semibold text-slate-800 dark:bg-slate-900 dark:text-slate-200', className)}>
				{children}
			</td>
		</tr>
	);
}

/** Status / category dot (token colour or DB colour via style). */
export function StatusDot({ className, color }: { className?: string; color?: string }) {
	return <span className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={color ? { background: color } : undefined} aria-hidden="true" />;
}
