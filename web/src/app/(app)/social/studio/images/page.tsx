// /social/studio/images: prompt, size, style, provider (configured image
// providers only), count. Results grid with regenerate, edit (providers with
// edit_image), download, copy link and attach to task.

import PageHeader from '@/components/ui/PageHeader';
import { assetsForJobs, listClientOptions, listJobs, listWorkItemOptions, providersFor } from '@/lib/content-studio/server';
import ImagesForm from './ImagesForm';

export const dynamic = 'force-dynamic';

export default async function ImagesPage() {
	const [clients, workItems, jobs] = await Promise.all([listClientOptions(), listWorkItemOptions(), listJobs({ capabilities: ['generate_image', 'edit_image'], limit: 12 })]);
	const assets = await assetsForJobs(jobs.filter((j) => j.status === 'done').map((j) => j.id));
	return (
		<>
			<PageHeader title="Image Studio" description="Prompt in, images out. Regenerate, edit with an image-edit provider, or attach straight to a task." />
			<ImagesForm providers={providersFor('generate_image')} editProviders={providersFor('edit_image')} clients={clients} workItems={workItems} jobs={jobs} assets={assets} />
		</>
	);
}
