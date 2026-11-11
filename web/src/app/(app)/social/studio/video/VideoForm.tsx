'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import ProviderPicker from '@/components/content-studio/ProviderPicker';
import JobCard from '@/components/content-studio/JobCard';
import AssetGrid from '@/components/content-studio/AssetGrid';
import { ASPECTS, AVATAR_PROVIDERS, type ProviderOption, type StudioAsset, type StudioJob } from '@/lib/content-studio/shared';
import { startVideoChain } from '../actions';

interface Props {
	voiceProviders: ProviderOption[];
	videoProviders: ProviderOption[];
	clients: { id: string; name: string; status: string }[];
	workItems: { id: string; name: string }[];
	chains: { root: StudioJob; steps: StudioJob[] }[];
	assets: StudioAsset[];
	seedScript: { jobId: string; text: string } | null;
}

export default function VideoForm({ voiceProviders, videoProviders, clients, workItems, chains, assets, seedScript }: Props) {
	const router = useRouter();
	const [script, setScript] = useState(seedScript?.text ?? '');
	const [scriptJobId, setScriptJobId] = useState(seedScript?.jobId ?? '');
	const [voiceProvider, setVoiceProvider] = useState(voiceProviders[0]?.id ?? '');
	const [voiceId, setVoiceId] = useState('');
	const [videoProvider, setVideoProvider] = useState(videoProviders[0]?.id ?? '');
	const [aspect, setAspect] = useState<string>(ASPECTS[0]);
	const [duration, setDuration] = useState(15);
	const [clientId, setClientId] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const isAvatar = (AVATAR_PROVIDERS as readonly string[]).includes(videoProvider);

	function run() {
		setError(null);
		start(async () => {
			const res = await startVideoChain({
				script,
				scriptJobId,
				voiceProvider,
				voiceId: voiceId || undefined,
				videoProvider,
				aspect: aspect as (typeof ASPECTS)[number],
				durationSeconds: duration,
				clientId,
			});
			if (!res.ok) setError(res.error);
			router.refresh();
		});
	}

	const byJob = new Map<string, StudioAsset[]>();
	for (const a of assets) byJob.set(a.job_id, [...(byJob.get(a.job_id) ?? []), a]);

	return (
		<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
			<Card className="lg:col-span-2 space-y-3 self-start">
				{seedScript && scriptJobId && <Callout tone="info">Script loaded from the Scripts page. Editing it here detaches it from that job.</Callout>}
				<Textarea
					label="Script"
					value={script}
					onChange={(e) => {
						setScript(e.target.value);
						if (scriptJobId) setScriptJobId('');
					}}
					placeholder="Paste or type the spoken script."
					className="min-h-40"
					maxLength={8000}
					disabled={pending}
				/>
				<ProviderPicker label="Voice" providers={voiceProviders} value={voiceProvider} onChange={setVoiceProvider} disabled={pending} emptyHint="No voice provider configured (ElevenLabs or OpenAI TTS)." />
				<Input label="Voice id (optional)" placeholder="Vendor voice id; blank uses the default" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} maxLength={120} disabled={pending} />
				<ProviderPicker label="Video" providers={videoProviders} value={videoProvider} onChange={setVideoProvider} disabled={pending} emptyHint="No video provider configured (HeyGen, Synthesia, Runway, Google, Kling, Luma)." />
				<div className="grid grid-cols-2 gap-3">
					<Select label="Aspect" value={aspect} onChange={(e) => setAspect(e.target.value)} disabled={pending}>
						{ASPECTS.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</Select>
					<Input label={isAvatar ? 'Duration (avatar follows the script)' : 'Duration (seconds)'} type="number" min={1} max={60} value={duration} onChange={(e) => setDuration(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} disabled={pending || isAvatar} />
				</div>
				<Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={pending}>
					<option value="">None</option>
					{clients.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>
				{error && <Callout tone="error">{error}</Callout>}
				<Button onClick={run} loading={pending} disabled={!voiceProvider || !videoProvider || script.trim().length < 10}>
					Start chain
				</Button>
				<p className="text-2xs text-slate-500 dark:text-slate-400">Three jobs: script, voice, video. Each shows its own cost on the card and on Jobs.</p>
			</Card>

			<div className="lg:col-span-3 space-y-3">
				{chains.length === 0 && (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400">Chains show here as one card with three steps.</p>
					</Card>
				)}
				{chains.map(({ root, steps }) => (
					<JobCard key={root.id} job={root} steps={steps} title={`Video chain · ${steps[steps.length - 1]?.provider ?? root.provider}`}>
						<AssetGrid assets={[root, ...steps].flatMap((j) => byJob.get(j.id) ?? [])} workItems={workItems} columns={2} />
					</JobCard>
				))}
			</div>
		</div>
	);
}
