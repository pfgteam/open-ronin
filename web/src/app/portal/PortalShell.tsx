// Portal chrome: light, client-facing, no staff nav. Tabs by package.

import Link from 'next/link';
import type { PortalSession } from '@/lib/flywheel/portal';

export const PORTAL_TABS = [
	{ key: 'home', label: 'Home' },
	{ key: 'packages', label: 'Packages' },
	{ key: 'approvals', label: 'Approvals' },
	{ key: 'trackers', label: 'Trackers' },
	{ key: 'visibility', label: 'AI visibility' },
	{ key: 'media', label: 'Media' },
	{ key: 'reports', label: 'Reports' },
	{ key: 'calls', label: 'Calls' },
	{ key: 'give', label: 'Requests & ideas' },
	{ key: 'library', label: 'Library' },
	{ key: 'recording', label: 'Recording' },
	{ key: 'billing', label: 'Billing' },
	{ key: 'connections', label: 'Connections' },
] as const;
export type PortalTab = (typeof PORTAL_TABS)[number]['key'];

export default function PortalShell({ session, tab, pendingApprovals, programId, children }: { session: PortalSession; tab: PortalTab; pendingApprovals: number; programId: string | null; children: React.ReactNode }) {
	const href = (t: PortalTab) => `/portal?tab=${t}${programId ? `&program=${programId}` : ''}${session.clients.length > 1 ? `&client=${session.client_id}` : ''}`;
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			<header className="bg-primary-700 text-white">
				<div className="max-w-5xl mx-auto px-4 py-5 flex flex-wrap items-center justify-between gap-3">
					<div>
						<div className="text-2xs uppercase tracking-wider text-primary-100">Open Ronin · Client portal</div>
						<h1 className="text-xl font-bold tracking-tight">{session.client_name}</h1>
					</div>
					<div className="text-xs text-primary-100 flex items-center gap-3">
						<span>{session.display_name}</span>
						{session.clients.length > 1 && (
							<span className="flex gap-2">
								{session.clients.map((c) => (
									<Link key={c.client_id} href={`/portal?client=${c.client_id}`} className={c.client_id === session.client_id ? 'underline font-medium' : 'hover:underline'}>
										{c.client_name}
									</Link>
								))}
							</span>
						)}
						<form action="/api/portal/signout" method="post">
							<button type="submit" className="underline">
								Sign out
							</button>
						</form>
					</div>
				</div>
				<nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
					{PORTAL_TABS.map((t) => (
						<Link key={t.key} href={href(t.key)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${tab === t.key ? 'border-white font-semibold' : 'border-transparent text-primary-100 hover:text-white'}`}>
							{t.label}
							{t.key === 'approvals' && pendingApprovals > 0 && <span className="ml-1 rounded-full bg-amber-400 text-slate-900 text-2xs px-1.5">{pendingApprovals}</span>}
						</Link>
					))}
				</nav>
			</header>
			<div className="max-w-5xl mx-auto px-4 py-6">{children}</div>
		</main>
	);
}
