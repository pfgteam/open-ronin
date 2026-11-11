// /social/studio/clips: upload a video, paste a link, or pick a call
// recording from Sessions; send to OpusClip (clip_video) or Descript
// (edit_video); clips come back as content_assets with captions.

import PageHeader from '@/components/ui/PageHeader';
import { assetsForJobs, listClientOptions, listJobs, listRecordingOptions, listWorkItemOptions, providersFor } from '@/lib/content-studio/server';
import ClipsForm from './ClipsForm';

export const dynamic = 'force-dynamic';

export default async function ClipsPage() {
	const [clients, workItems, recordings, jobs] = await Promise.all([
		listClientOptions(),
		listWorkItemOptions(),
		listRecordingOptions(),
		listJobs({ capabilities: ['clip_video', 'edit_video'], limit: 12 }),
	]);
	const assets = await assetsForJobs(jobs.filter((j) => j.status === 'done').map((j) => j.id));
	const providers = [...providersFor('clip_video', ['opusclip']), ...providersFor('edit_video', ['descript'])];
	return (
		<>
			<PageHeader title="Clips and editing" description="A long video in, short captioned clips out. Sources: an upload, a link, or a call recording from Sessions." />
			<ClipsForm providers={providers} clients={clients} workItems={workItems} recordings={recordings} jobs={jobs} assets={assets} />
		</>
	);
}
