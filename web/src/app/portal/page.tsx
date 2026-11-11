// /portal — the client portal (F5, 0144). Magic-link login per client
// contact; one portal for every package. No session → the sign-in form.
// Tabs via ?tab=. Everything reads through lib/flywheel/portal.ts (service
// role scoped by fw_portal_users); the restrictive RLS wall means the
// client's own JWT can never read a staff row even if a bug sent it.

import type { Metadata } from 'next';
import Link from 'next/link';
import { getPortalSession, loadApprovalBody, loadGoogleConnection, loadGoogleMetrics, loadPortalApprovals, loadPortalBilling, loadPortalCalls, loadPortalEvents, loadPortalFiles, loadPortalMedia, loadPortalNotes, loadPortalOverview, loadPortalSettings, loadPortalTrackers, loadPortalVisibility, googleConfigured, listGoogleAssets } from '@/lib/flywheel/portal';
import { createServiceRoleClient } from '@/lib/supabase/server';
import PortalShell, { PORTAL_TABS, type PortalTab } from './PortalShell';
import SignIn from './SignIn';
import { ApprovalsTab, BillingTab, CallsTab, ConnectionsTab, GiveTab, HomeTab, LibraryTab, MediaTab, PackagesTab, RecordingTab, ReportsTab, TrackersTab, VisibilityTab } from './Tabs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your portal · Open Ronin', robots: { index: false } };

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ tab?: string; client?: string; program?: string; approval?: string; sent?: string; error?: string; connected?: string }> }) {
	const sp = await searchParams;
	const session = await getPortalSession(sp.client ?? null);
	const settings = await loadPortalSettings();
	if (!session) return <SignIn sent={!!sp.sent} error={sp.error ?? null} supportEmail={settings.support_email} />;
	const tab: PortalTab = PORTAL_TABS.some((t) => t.key === sp.tab) ? (sp.tab as PortalTab) : 'home';
	const overview = await loadPortalOverview(session.client_id);
	const programs = overview?.programs ?? [];
	const flywheel = programs.filter((p) => p.package_key === 'flywheel');
	const programId = sp.program && programs.some((p) => p.id === sp.program) ? sp.program : (flywheel[0]?.id ?? programs[0]?.id ?? null);
	const svc = createServiceRoleClient();

	let body: React.ReactNode = null;
	switch (tab) {
		case 'home': {
			const [approvals, events] = await Promise.all([loadPortalApprovals(session.client_id), loadPortalEvents(session.client_id, 15)]);
			body = <HomeTab session={session} overview={overview} approvals={approvals.filter((a) => a.status === 'pending')} events={events} settings={settings} />;
			break;
		}
		case 'packages':
			body = <PackagesTab overview={overview} />;
			break;
		case 'approvals': {
			const approvals = await loadPortalApprovals(session.client_id);
			const open = sp.approval ? await loadApprovalBody(session.client_id, sp.approval) : null;
			body = <ApprovalsTab session={session} approvals={approvals} openId={sp.approval ?? null} openBody={open} programs={programs} />;
			break;
		}
		case 'trackers': {
			const trackers = programId ? await loadPortalTrackers(programId) : null;
			body = <TrackersTab trackers={trackers} programs={flywheel} programId={programId} />;
			break;
		}
		case 'visibility': {
			const vis = programId ? await loadPortalVisibility(programId) : null;
			body = <VisibilityTab vis={vis} programs={flywheel} programId={programId} />;
			break;
		}
		case 'media': {
			const opps = await loadPortalMedia(session.client_id);
			body = <MediaTab opps={opps} />;
			break;
		}
		case 'reports': {
			const { data } = await svc.from('fw_reports').select('id, kind, period_from, period_to, subject, body_md, status, sent_at').eq('client_id', session.client_id).eq('show_in_portal', true).in('status', ['sent', 'delivered', 'opened']).order('period_to', { ascending: false }).limit(40).then((r) => r, () => ({ data: [] }));
			body = <ReportsTab reports={(data ?? []) as { id: string; kind: string; period_from: string; period_to: string; subject: string | null; body_md: string | null; status: string; sent_at: string | null }[]} />;
			break;
		}
		case 'calls': {
			const calls = await loadPortalCalls(session.client_id);
			body = <CallsTab calls={calls} bookUrl={settings.book_call_url} />;
			break;
		}
		case 'give': {
			const notes = await loadPortalNotes(session.client_id);
			body = <GiveTab session={session} notes={notes} programs={programs} />;
			break;
		}
		case 'library': {
			const files = await loadPortalFiles(session.client_id);
			body = <LibraryTab files={files.filter((f) => f.kind !== 'recording')} />;
			break;
		}
		case 'recording': {
			const [trackers, files] = await Promise.all([programId ? loadPortalTrackers(programId) : Promise.resolve(null), loadPortalFiles(session.client_id)]);
			body = <RecordingTab videos={trackers?.videos ?? []} files={files.filter((f) => f.kind === 'recording')} programId={programId} />;
			break;
		}
		case 'billing': {
			const billing = await loadPortalBilling(session.client_id);
			body = <BillingTab billing={billing} bookUrl={settings.book_call_url} supportEmail={settings.support_email} />;
			break;
		}
		case 'connections': {
			const conn = await loadGoogleConnection(session.client_id);
			const assets = conn?.status === 'connected' ? await listGoogleAssets(session.client_id) : null;
			const metrics = conn?.status === 'connected' ? await loadGoogleMetrics(session.client_id) : null;
			body = <ConnectionsTab conn={conn} assets={assets} metrics={metrics} configured={googleConfigured()} orgAccount={settings.org_google_account} justConnected={!!sp.connected} error={sp.error ?? null} />;
			break;
		}
	}
	return (
		<PortalShell session={session} tab={tab} pendingApprovals={overview?.pending_approvals ?? 0} programId={programId}>
			{body}
			<p className="mt-8 text-2xs text-slate-500">
				Questions? <a href={`mailto:${settings.support_email}`} className="underline">{settings.support_email}</a> · <Link href="/portal?tab=calls" className="underline">book a call</Link>
			</p>
		</PortalShell>
	);
}
