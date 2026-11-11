// Pagination — URL-driven page links for server-rendered tables ("1–50 of
// 6,965 · ‹ 1 2 3 … 140 ›" + rows per page). No client state: every control
// is a Link built by the caller's hrefFor, so Back/Forward and shared links work.

import Link from 'next/link';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { controlFocus } from './focus';
import { PAGE_SIZES, pageWindow } from '@/lib/pagination';

const box = clsx('inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-xs tabular-nums', controlFocus);
const idle = 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-hover';

export default function Pagination({ page, size, total, hrefFor, sizeHrefFor }: {
	page: number;
	size: number;
	total: number;
	hrefFor: (page: number) => string;
	sizeHrefFor?: (size: number) => string;
}) {
	const pages = Math.max(1, Math.ceil(total / size));
	const cur = Math.min(Math.max(1, page), pages);
	const from = total === 0 ? 0 : (cur - 1) * size + 1;
	const to = Math.min(cur * size, total);
	return (
		<nav aria-label="Pagination" className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
			<span className="tabular-nums">
				{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
			</span>
			<span className="ml-auto flex flex-wrap items-center gap-1">
				{cur > 1 ? (
					<Link href={hrefFor(cur - 1)} className={clsx(box, idle)} aria-label="Previous page"><ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /></Link>
				) : (
					<span className={clsx(box, idle, 'opacity-40')} aria-hidden="true"><ChevronLeft className="w-3.5 h-3.5" /></span>
				)}
				{pageWindow(cur, pages).map((p, i) =>
					p === 'gap' ? (
						<span key={`gap-${i}`} className="px-1" aria-hidden="true">…</span>
					) : (
						<Link key={p} href={hrefFor(p)} aria-current={p === cur ? 'page' : undefined} className={clsx(box, p === cur ? 'border-primary-700 bg-primary-700 text-white' : idle)}>
							{p}
						</Link>
					),
				)}
				{cur < pages ? (
					<Link href={hrefFor(cur + 1)} className={clsx(box, idle)} aria-label="Next page"><ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
				) : (
					<span className={clsx(box, idle, 'opacity-40')} aria-hidden="true"><ChevronRight className="w-3.5 h-3.5" /></span>
				)}
				{sizeHrefFor && (
					<span className="ml-2 flex items-center gap-1" role="group" aria-label="Rows per page">
						{PAGE_SIZES.map((s) => (
							<Link key={s} href={sizeHrefFor(s)} aria-current={s === size ? 'true' : undefined} className={clsx(box, s === size ? 'border-primary-600 bg-primary-50 text-primary-900 dark:bg-primary-950 dark:text-primary-300' : idle)}>
								{s}
							</Link>
						))}
						<span className="pl-1">/ page</span>
					</span>
				)}
			</span>
		</nav>
	);
}
