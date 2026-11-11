// /social/studio/thumbnails: title text, Open Ronin brand presets (palette from
// lib/brand, module 10), provider picker, sizes for YouTube, Reels, LinkedIn.

import PageHeader from '@/components/ui/PageHeader';
import { getBrand } from '@/lib/brand/getBrand';
import { assetsForJobs, listClientOptions, listJobs, listWorkItemOptions, providersFor } from '@/lib/content-studio/server';
import ThumbnailsForm from './ThumbnailsForm';

export const dynamic = 'force-dynamic';

export default async function ThumbnailsPage() {
	const [brand, clients, workItems, jobs] = await Promise.all([getBrand(), listClientOptions(), listWorkItemOptions(), listJobs({ capabilities: ['generate_image'], limit: 12 })]);
	const thumbJobs = jobs; // image jobs; the thumbnail preset rides in input.style
	const assets = await assetsForJobs(thumbJobs.filter((j) => j.status === 'done').map((j) => j.id));
	return (
		<>
			<PageHeader title="Thumbnails" description={`Title text on a ${brand.name} preset, sized for the platform.`} />
			<ThumbnailsForm
				providers={providersFor('generate_image')}
				clients={clients}
				workItems={workItems}
				jobs={thumbJobs}
				assets={assets}
				brand={{ name: brand.name, primaryColor: brand.primaryColor, accentColor: brand.accentColor }}
			/>
		</>
	);
}
