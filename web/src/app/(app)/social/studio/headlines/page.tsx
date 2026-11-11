// /social/studio/headlines: the same brief, 10 to 20 options back, one
// click to star into hook_library (0093). The old Hook Library stub, done.

import PageHeader from '@/components/ui/PageHeader';
import { listClientOptions, listHooks, listJobs, providersFor } from '@/lib/content-studio/server';
import HeadlinesForm from './HeadlinesForm';

export const dynamic = 'force-dynamic';

export default async function HeadlinesPage() {
	const [clients, hooks, jobs] = await Promise.all([listClientOptions(), listHooks(), listJobs({ capabilities: ['generate_text'], limit: 8 })]);
	const providers = providersFor('generate_text');
	return (
		<>
			<PageHeader title="Headlines and hooks" description="Ten to twenty options from one brief. Star the keepers; they live in your hook library." />
			<HeadlinesForm providers={providers} clients={clients} hooks={hooks} jobs={jobs} />
		</>
	);
}
