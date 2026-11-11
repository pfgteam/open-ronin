'use client';

// Small "← Back" control for /the-work/[id]. Per Sam 2026-08-10: leaving
// a project/goal/priority/campaign detail page always dropped the user back
// on the Priorities tab with no filters, instead of wherever they actually
// came from (Client Work, My Work, a filtered/tabbed Priorities view, a
// board vs list toggle, etc).
//
// router.back() walks the real browser history stack instead of a hardcoded
// href, so it lands on the exact previous URL — tab + filters + view mode
// included — as long as the click that opened this page did a normal
// push-style navigation (every list view here uses <Link>/router.push, never
// replace, so this holds). Falls back to a fixed URL only when there's
// nowhere to go back to (e.g. a fresh tab opened straight to this link).
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function BackButton({ fallbackHref }: { fallbackHref: string }) {
	const router = useRouter();

	function handleClick() {
		if (typeof window !== 'undefined' && window.history.length > 1) {
			router.back();
		} else {
			router.push(fallbackHref);
		}
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 transition-colors"
		>
			<ArrowLeft className="w-3 h-3" /> Back
		</button>
	);
}
