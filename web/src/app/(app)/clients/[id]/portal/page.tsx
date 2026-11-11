// /clients/[id]/portal — this client's portal: logins (magic-link invites),
// what they sent, Google connection. The Flywheel program page has the
// same panels plus approvals; this tab exists for clients without a
// Flywheel program (PR / SMM only) so every client can get a portal.

import Link from 'next/link';
import Callout from '@/components/ui/Callout';
import { createClient } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadPortalStaff, loadPrograms } from '@/lib/flywheel/server';
import { GoogleStatusPanel, PortalUsersPanel, StaffNotesPanel } from '@/app/(app)/flywheel/PortalPanels';
import { requireClient } from '../_lib';

export const dynamic = 'force-dynamic';

export default async function ClientPortalTab({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const ctx = await requireClient(id, '/portal');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <Callout tone="warning">The client portal needs migration 0144.</Callout>;
	const programs = await loadPrograms(supabase, { clientId: ctx.clientId, status: 'all' });
	const programId = programs.find((p) => p.status !== 'closed')?.id ?? null;
	const portal = await loadPortalStaff(supabase, ctx.clientId, programId);
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="lg:col-span-2 space-y-4">
				<PortalUsersPanel clientId={ctx.clientId} programId={programId} users={portal.users} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'} contacts={portal.contacts} />
				<StaffNotesPanel notes={portal.notes} programId={programId} />
			</div>
			<div className="space-y-4">
				<GoogleStatusPanel clientId={ctx.clientId} programId={programId} conn={portal.conn} />
				{programId ? (
					<Callout tone="info">
						Approvals and the Flywheel trackers are managed on the <Link href={`/flywheel/${programId}?tab=portal`} className="underline">program page</Link>.
					</Callout>
				) : (
					<Callout tone="info">No Flywheel program; the portal shows this client&apos;s packages, media, billing and requests.</Callout>
				)}
			</div>
		</div>
	);
}
