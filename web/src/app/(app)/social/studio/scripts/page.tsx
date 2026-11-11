// /social/studio/scripts: brief -> script draft by a configured text
// provider, with the client's message house as context. Server component
// reads (providers, clients, tasks, recent script jobs); ScriptsForm does
// the rest.

import PageHeader from '@/components/ui/PageHeader';
import { listClientOptions, listJobs, listWorkItemOptions, providersFor } from '@/lib/content-studio/server';
import ScriptsForm from './ScriptsForm';

export const dynamic = 'force-dynamic';

export default async function ScriptsPage() {
	const [clients, workItems, jobs] = await Promise.all([listClientOptions(), listWorkItemOptions(), listJobs({ capabilities: ['generate_text'], limit: 12 })]);
	const providers = providersFor('generate_text');
	return (
		<>
			<PageHeader title="Scripts" description="A brief in, a spoken-word script out. Save it to a task in The Work or hand it to Video Studio." />
			<ScriptsForm providers={providers} clients={clients} workItems={workItems} jobs={jobs} />
		</>
	);
}
