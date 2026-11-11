// The signed-in app shell, for every route except /auth/* and /api/*.
//
// This layout is the whole point of the `(app)` route group. The chrome used
// to live inside each of the ~60 pages, which cost real speed on every click:
//
//   - Each page awaited getAuthUser() + getAuthProfile() + getAccessibleModules()
//     before rendering anything, so the auth round trip was paid per navigation.
//   - The eight `loading.tsx` files had to render <AppLayout> too — otherwise
//     the nav blanked mid-navigation — which made every skeleton async and
//     auth-blocked, so it could not paint immediately. That defeated the point
//     of having skeletons, and made Link prefetch nearly worthless: it warmed
//     a boundary that was itself waiting on Auth.
//   - TopNav, SideNav and NotificationBell remounted on every route change.
//     The bell re-queried notifications; SideNav re-read its width from
//     localStorage in an effect, so it visibly jumped.
//
// App Router layouts are preserved across navigation within the group, so the
// nav now renders once per session, the skeletons are synchronous, and only
// the page segment suspends. Route groups add no URL segment: `(app)/clients`
// still serves /clients.
//
// Adding a page here means NOT importing AppLayout — the shell is already
// around you. ModuleGate no longer renders it either (its deny card is just a
// card now), and the same goes for ComingSoon and DepartmentDashboard.

import AppLayout from '@/components/layout/AppLayout';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
	return <AppLayout>{children}</AppLayout>;
}
