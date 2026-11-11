'use client';

// AutoLoad — the end of a long list that loads the next part by itself as
// it scrolls into view (rework D8: no list ends in a Load more button). It
// shows what is still coming as text, never as a button. Place it inside
// the scroll container; pass `root` when that container is not the page.

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';

export default function AutoLoad({ hasMore, loading, onLoad, remaining, root, className }: {
	hasMore: boolean;
	loading: boolean;
	onLoad: () => void;
	remaining?: number | null;
	root?: React.RefObject<HTMLElement | null>;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const busy = useRef(loading);
	busy.current = loading;
	const load = useRef(onLoad);
	load.current = onLoad;
	useEffect(() => {
		const node = ref.current;
		if (!node || !hasMore) return;
		const io = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting) && !busy.current) load.current();
		}, { root: root?.current ?? null, rootMargin: '400px' });
		io.observe(node);
		return () => io.disconnect();
	}, [hasMore, root]);
	if (!hasMore) return null;
	return (
		<div ref={ref} className={clsx('py-2 text-center text-xs text-slate-500 dark:text-slate-400', className)} aria-live="polite">
			{loading ? 'Loading…' : remaining != null ? `${remaining.toLocaleString()} more coming as you scroll` : 'More coming as you scroll'}
		</div>
	);
}
