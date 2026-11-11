import { Suspense } from 'react';
import TopNav from '@/components/nav/TopNav';
import SideNav from '@/components/nav/SideNav';
import PageTabs from '@/components/nav/PageTabs';
import GlobalNewTask from '@/components/quick-add/GlobalNewTask';
import ChatDrawer from '@/components/comms/ChatDrawer';
import ToastProvider from '@/components/ui/Toast';
import AuthHydrator from './AuthHydrator';
import { getAuthProfile, getAuthUser } from '@/lib/supabase/server';
import { getAccessibleModules } from '@/lib/permissions/modules';
import { getDesignSettings } from '@/lib/design/server';
import { identityOf } from '@/lib/design/settings';
import { redirect } from 'next/navigation';
import { getOrgSettingsFresh, getServiceLines } from '@/lib/tenant/server';

interface AppLayoutProps {
	children: React.ReactNode;
}

// Server component: resolves the viewer once per request (request-memoized in
// lib/supabase/server) and seeds the client auth store via AuthHydrator, so
// TopNav/SideNav don't re-fetch getUser() + profiles on mount.
export default async function AppLayout({ children }: AppLayoutProps) {
	const org = await getOrgSettingsFresh();
	if (!org._missing && !org.setup_completed_at) redirect('/setup');
	const user = await getAuthUser();
	const profile = await getAuthProfile();
	const modules = await getAccessibleModules();
	const identity = identityOf(await getDesignSettings());
	const sectionsOff = Object.entries(org.modules ?? {})
		.filter(([, on]) => on === false)
		.map(([k]) => k);
	const serviceLines = (await getServiceLines()).map((l) => ({ key: l.key, label: l.label }));

	return (
		<ToastProvider>
			<AuthHydrator user={user} profile={profile} modules={[...modules]} />
			<div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
				{/* Keyboard users otherwise tab the whole TopNav + SideNav on every page */}
				<a
					href="#main-content"
					className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-white dark:focus:bg-slate-800 focus:px-3 focus:py-2 focus:rounded-md focus:border focus:border-slate-200 dark:focus:border-slate-700 focus:text-sm"
				>
					Skip to content
				</a>
				<TopNav identity={identity} sectionsOff={sectionsOff} />
				{/* overflow-clip, not -hidden: clips the same but is not a scroll
				    container, so the sidebar columns can stick under the TopNav
				    while the document scrolls (nav v2). */}
				<div className="flex flex-1 overflow-clip">
					{/* Suspense: SideNav reads useSearchParams for the ?tab= highlight. */}
					<Suspense fallback={null}>
						<SideNav serviceLines={serviceLines} />
					</Suspense>
					<main id="main-content" className="flex-1 overflow-y-auto">
						<div className="px-6 py-5 max-w-screen-2xl mx-auto">
							{/* Nav v2: the former third menu level, as tabs over the page. */}
							<Suspense fallback={null}>
								<PageTabs />
							</Suspense>
							{children}
						</div>
					</main>
				</div>
				<GlobalNewTask />
				<ChatDrawer />
			</div>
		</ToastProvider>
	);
}
