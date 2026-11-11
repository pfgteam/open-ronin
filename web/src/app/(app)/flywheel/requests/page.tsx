// /flywheel/requests — everything clients sent through their portals:
// requests, ideas, news, media contacts, product requests, questions.

import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadAllPortalNotes, loadFlywheelConfig } from '@/lib/flywheel/server';
import NotAppliedCard from '../NotAppliedCard';
import { StaffNotesPanel } from '../PortalPanels';

export const metadata = { title: 'Client requests · Flywheel' };
export const dynamic = 'force-dynamic';

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const notes = await loadAllPortalNotes(supabase, sp.all ? ['open', 'acknowledged', 'in_progress', 'done', 'declined'] : undefined);
	return (
		<>
			<PageHeader title="Client requests & ideas" description={`${notes.length} from the portals · requests, ideas / news angles, media contacts, product requests, questions. Reply here; the client sees the reply and the status.`} />
			<StaffNotesPanel notes={notes} title={sp.all ? 'All' : 'Open'} />
		</>
	);
}
