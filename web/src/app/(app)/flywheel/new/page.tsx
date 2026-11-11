// /flywheel/new — start a program from a contract line.

import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadFlywheelContracts } from '@/lib/flywheel/server';
import NotAppliedCard from '../NotAppliedCard';
import ProgramForm from '../ProgramForm';

export const metadata = { title: 'New program · Flywheel' };
export const dynamic = 'force-dynamic';

export default async function NewProgramPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const [contracts, { data: clients }] = await Promise.all([loadFlywheelContracts(supabase), supabase.from('clients_v2').select('id, display_name').order('display_name')]);
	return (
		<>
			<PageHeader title="New program" description="One program per client per contract line. Flywheel lines carry the $10k setup + $1,500/mo as separate fields; monthly billing starts on first-set-live." />
			<Card>
				<ProgramForm program={null} packages={config.packages} contracts={contracts} clients={((clients ?? []) as { id: string; display_name: string }[]).map((c) => ({ id: c.id, name: c.display_name }))} />
			</Card>
		</>
	);
}
