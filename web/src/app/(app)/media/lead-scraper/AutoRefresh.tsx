'use client';

// Re-renders the page while a job is mid-flight, so the operator stops having
// to press refresh.
//
// router.refresh() re-runs the server component and swaps in new HTML without
// a full navigation — no Supabase Realtime subscription, which the portability
// contract (MIGRATION_READINESS) deliberately avoids taking on. That trade
// costs nothing here: jobs advance on cron ticks or a button press, so state
// changes by the minute, not the millisecond.
//
// Polling stops the moment nothing is active, so an idle page is silent.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const INTERVAL_MS = 8000;

export default function AutoRefresh({ active }: { active: boolean }) {
	const router = useRouter();
	// Kept in a ref so changing `active` does not reset the timer mid-cycle.
	const activeRef = useRef(active);
	activeRef.current = active;

	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => {
			// Refreshing a hidden tab wastes queries nobody is looking at.
			if (activeRef.current && document.visibilityState === 'visible') router.refresh();
		}, INTERVAL_MS);
		return () => clearInterval(id);
	}, [active, router]);

	if (!active) return null;
	return (
		<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
			<span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
			Updating automatically
		</span>
	);
}
