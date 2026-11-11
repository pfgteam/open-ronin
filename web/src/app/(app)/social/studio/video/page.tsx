// /social/studio/video: script (from Scripts via ?script=<jobId>, or typed),
// voice (ElevenLabs or OpenAI TTS), avatar (HeyGen, Synthesia) or generative
// (Runway, Google Veo, Kling, Luma), aspect, duration. One chain: script ->
// voice -> video, three content_jobs linked by parent_job_id, one card.

import PageHeader from '@/components/ui/PageHeader';
import { assetsForJobs, jobsByIds, listClientOptions, listJobs, listWorkItemOptions, providersFor } from '@/lib/content-studio/server';
import { AVATAR_PROVIDERS, groupChains } from '@/lib/content-studio/shared';
import VideoForm from './VideoForm';

export const dynamic = 'force-dynamic';

export default async function VideoPage({ searchParams }: { searchParams: Promise<{ script?: string }> }) {
	const { script } = await searchParams;
	const scriptJobId = script && /^[0-9a-f-]{36}$/i.test(script) ? script : null;
	const [clients, workItems, jobs, seed] = await Promise.all([
		listClientOptions(),
		listWorkItemOptions(),
		listJobs({ capabilities: ['generate_text', 'generate_voice', 'generate_video', 'lipsync_avatar'], limit: 120 }),
		scriptJobId ? jobsByIds([scriptJobId]) : Promise.resolve([]),
	]);
	// Only chains that end in a video step belong on this page; lone text
	// jobs are the Scripts page's business.
	const chains = groupChains(jobs).filter(({ root, steps }) => [root, ...steps].some((j) => j.capability === 'generate_video' || j.capability === 'lipsync_avatar')).slice(0, 10);
	const doneIds = chains.flatMap(({ root, steps }) => [root, ...steps]).filter((j) => j.status === 'done').map((j) => j.id);
	const assets = await assetsForJobs(doneIds);
	const generative = providersFor('generate_video');
	const avatar = providersFor('lipsync_avatar', AVATAR_PROVIDERS);
	return (
		<>
			<PageHeader title="Video Studio" description="Script, voice, then video as one chained job. Generative renders take minutes; the card keeps polling." />
			<VideoForm
				voiceProviders={providersFor('generate_voice')}
				videoProviders={[...avatar, ...generative.filter((g) => !avatar.some((a) => a.id === g.id))]}
				clients={clients}
				workItems={workItems}
				chains={chains}
				assets={assets}
				seedScript={seed[0]?.text ? { jobId: seed[0].id, text: seed[0].text } : null}
			/>
		</>
	);
}
