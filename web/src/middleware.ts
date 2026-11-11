// Edge middleware — runs on every request before page rendering.
// Delegates to the Supabase SSR helper which refreshes the session cookie
// and redirects unauthenticated traffic to /auth/login.
//
// Also handles legacy URL redirects from the pre-/the-work IA. The old
// /projects/* + /the-work/{projects,tasks,my-work}/* route trees were
// deleted (2026-08-20 cleanup); these redirects keep old bookmarks and
// links alive.

import { updateSession } from '@/lib/supabase/middleware';
import { NextResponse, type NextRequest } from 'next/server';

// Pre-refactor URL prefixes → new home. Projects + Tasks pages were
// killed in favor of kind-tabs on /the-work/priorities. The /[id]/* tail
// (legacy project detail) maps to the unified work-item detail at
// /the-work/[id]. Bare list URLs map to the right tab on Priorities.
//
// The Work rework (2026-11-05): /the-work/projects and /the-work/tasks are
// hub tabs again (real pages), so only their legacy TAILS redirect; a bare
// /projects lands on the Projects tab with its query intact.
type Redirect = { from: string; toExact: string | null; toTail?: string };

const LEGACY_REDIRECTS: Redirect[] = [
	{ from: '/the-work/my-work',  toExact: '/' },   // My Work is the personal page (rework D5)
	{ from: '/priorities',        toExact: '/the-work/priorities' },
	{ from: '/the-work/projects', toExact: null, toTail: '/the-work' },
	{ from: '/the-work/tasks',    toExact: null, toTail: '/the-work' },
	{ from: '/projects',          toExact: '/the-work/projects', toTail: '/the-work' },
];

// Legacy list-view tails under the dead trees (not record ids).
const LEGACY_LIST_TAILS = new Set(['list', 'calendar', 'gantt', 'my-tasks', 'new', 'assignments']);

function buildRedirectURL(base: NextRequest, target: string, originalSearch: string) {
	const url = base.nextUrl.clone();
	if (target.includes('?')) {
		const [path, q] = target.split('?');
		url.pathname = path;
		url.search = '?' + q;
	} else {
		url.pathname = target;
		url.search = originalSearch;
	}
	return url;
}

export async function middleware(request: NextRequest) {
	const { pathname, search } = request.nextUrl;
	for (const r of LEGACY_REDIRECTS) {
		// Exact match → land on the list/tab. e.g. /projects → priorities?kind=project
		if (pathname === r.from) {
			if (!r.toExact) continue;
			return NextResponse.redirect(buildRedirectURL(request, r.toExact, search), 308);
		}
		// /<from>/<tail> — two cases:
		//  • tail is a legacy list view (list/gantt/…): those views don't exist
		//    anymore, land on the same tab the exact match uses.
		//  • tail starts with an id: map to the unified detail /the-work/<id>,
		//    dropping legacy sub-tabs (tasks/time/notes/…) that have no page.
		if (r.toTail && pathname.startsWith(r.from + '/')) {
			const first = pathname.slice(r.from.length + 1).split('/')[0];
			if (LEGACY_LIST_TAILS.has(first)) {
				return NextResponse.redirect(buildRedirectURL(request, r.toExact ?? r.from, search), 308);
			}
			return NextResponse.redirect(buildRedirectURL(request, `${r.toTail}/${first}`, search), 308);
		}
	}
	return updateSession(request);
}

export const config = {
	matcher: [
		// Skip static assets and API health pings.
		'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
	],
};
