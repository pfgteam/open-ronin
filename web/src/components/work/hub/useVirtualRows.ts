'use client';

// Windowed rendering for long lists (rework D8: lazy rendering as you scroll
// is fine past 1,000 rows; there is never a Load more button). Fixed row
// heights per item type keep the maths exact: offsets are a prefix sum, the
// first visible item is a binary search, and the table renders a top and a
// bottom spacer around the visible slice. No dependency.

import { useCallback, useEffect, useMemo, useState } from 'react';

export function useVirtualRows<T>(opts: {
	items: T[];
	height: (item: T) => number;
	scrollRef: React.RefObject<HTMLElement | null>;
	/** Pixels of sticky chrome above the body inside the scroller (the header row). */
	headerOffset?: number;
	overscan?: number;
}) {
	const { items, height, scrollRef, headerOffset = 0, overscan = 600 } = opts;
	const offsets = useMemo(() => {
		const out = new Array<number>(items.length + 1);
		out[0] = 0;
		for (let i = 0; i < items.length; i++) out[i + 1] = out[i] + height(items[i]);
		return out;
	}, [items, height]);
	const total = offsets[items.length] ?? 0;

	const [view, setView] = useState({ top: 0, height: 900 });
	const measure = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setView((v) => {
			const top = Math.max(0, el.scrollTop - headerOffset);
			const h = el.clientHeight;
			return Math.abs(v.top - top) < 8 && v.height === h ? v : { top, height: h };
		});
	}, [scrollRef, headerOffset]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		measure();
		el.addEventListener('scroll', measure, { passive: true });
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
	}, [scrollRef, measure]);

	const find = (y: number) => {
		let lo = 0, hi = items.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (offsets[mid + 1] <= y) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	const start = find(Math.max(0, view.top - overscan));
	const end = Math.min(items.length, find(view.top + view.height + overscan) + 1);
	return {
		start,
		end,
		padTop: offsets[start] ?? 0,
		padBottom: Math.max(0, total - (offsets[end] ?? total)),
		total,
		scrollToIndex: (i: number) => {
			const el = scrollRef.current;
			if (!el || i < 0 || i >= items.length) return;
			const y = offsets[i] + headerOffset;
			if (y < el.scrollTop + headerOffset) el.scrollTop = y - headerOffset;
			else if (y + height(items[i]) > el.scrollTop + el.clientHeight) el.scrollTop = y + height(items[i]) - el.clientHeight;
		},
	};
}
