'use client';

// Compatibility layer for the deep links that existed before ?tab=.
//
// This is NOT decoration and it is not replaceable by fixing the call sites.
// Two writers put hrefs into the `notifications` table — the check-in reminder
// cron and the check-in comment notifier — and rows already sitting unread in
// that table carry `/team/<id>#checkin`. A fragment is never sent to the
// server, so no server-side rewrite can rescue those rows: the only place that
// can see `#checkin` is the browser. The code call sites were updated too, so
// links written from now on are clean; this handles the ones already written.
//
// Kept deliberately dumb: read the hash, rewrite to the equivalent ?tab= with
// router.replace (replace, not push, so Back still goes where the user came
// from). Dropping the hash means the effect cannot loop.
//
// NO DEPENDENCY ARRAY, on purpose. With one, the effect runs only on mount —
// and the case that matters most is a SOFT navigation: someone already on
// their own profile clicks a legacy `#checkin` row in the notification bell.
// The pathname is unchanged, so React keeps the component instance and a
// mount-only effect never fires, leaving them on Overview. That is precisely
// the audience of the check-in reminder. Running every render is safe here
// because the body is idempotent: the replace strips the hash, so the next
// pass falls out at the first guard.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const HASH_TO_TAB: Record<string, string> = {
	'#metrics': 'metrics',
	'#checkin': 'checkins',
	// Never written by us, but a person retyping the link from memory will
	// pluralise it — cheap to honour.
	'#checkins': 'checkins',
	'#docs': 'docs',
};

export default function TabHashRedirect() {
	const router = useRouter();

	useEffect(() => {
		// window.location, not useSearchParams: reading the params here keeps this
		// component out of the Suspense requirement useSearchParams imposes, and
		// the hash is only ever available on the client anyway.
		const tab = HASH_TO_TAB[window.location.hash];
		if (!tab) return;
		const url = new URL(window.location.href);
		if (url.searchParams.get('tab') === tab) return;
		url.searchParams.set('tab', tab);
		router.replace(`${url.pathname}${url.search}`);
	});

	return null;
}
