'use client';

import { useRef, useState, useTransition } from 'react';
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
import type { ProviderOption, StudioAsset, StudioJob } from '@/lib/content-studio/shared';
import { requestClips, uploadSourceVideo } from '../actions';

interface Props {
	providers: ProviderOption[];
	clients: { id: string; name: string; status: string }[];
	workItems: { id: string; name: string }[];
	recordings: { id: string; label: string; url: string }[];
	jobs: StudioJob[];
	assets: StudioAsset[];
}

type Source = 'link' | 'upload' | 'recording';

export default function ClipsForm({ providers, clients, workItems, recordings, jobs, assets }: Props) {
	const router = useRouter();
	const fileRef = useRef<HTMLInputElement>(null);
	const [source, setSource] = useState<Source>(recordings.length > 0 ? 'recording' : 'link');
	const [link, setLink] = useState('');
	const [recordingId, setRecordingId] = useState(recordings[0]?.id ?? '');
	const [uploaded, setUploaded] = useState<{ url: string; name: string } | null>(null);
	const [provider, setProvider] = useState(providers[0]?.id ?? '');
	const [maxClips, setMaxClips] = useState(5);
	const [instructions, setInstructions] = useState('');
	const [clientId, setClientId] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();

	function upload() {
		const f = fileRef.current?.files?.[0];
		if (!f) return;
		setError(null);
		const fd = new FormData();
		fd.set('file', f);
		start(async () => {
			const res = await uploadSourceVideo(fd);
			if (!res.ok) setError(res.error);
			else setUploaded({ url: res.url, name: res.name });
		});
	}

	function run() {
		setError(null);
		const videoUrl = source === 'link' ? link.trim() : source === 'upload' ? uploaded?.url ?? '' : recordings.find((r) => r.id === recordingId)?.url ?? '';
		const sourceLabel = source === 'upload' ? uploaded?.name : source === 'recording' ? recordings.find((r) => r.id === recordingId)?.label : undefined;
		if (!videoUrl) {
			setError('Pick a source video first.');
			return;
		}
		if (provider !== 'opusclip' && provider !== 'descript') {
			setError('Pick OpusClip or Descript.');
			return;
		}
		start(async () => {
			const res = await requestClips({ provider, videoUrl, maxClips, instructions: instructions || undefined, sourceLabel, clientId });
			if (!res.ok) setError(res.error);
			router.refresh();
		});
	}

	const byJob = new Map<string, StudioAsset[]>();
	for (const a of assets) byJob.set(a.job_id, [...(byJob.get(a.job_id) ?? []), a]);
	const ready = source === 'link' ? link.trim().length > 8 : source === 'upload' ? !!uploaded : !!recordingId;

	return (
		<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
			<Card className="lg:col-span-2 space-y-3 self-start">
				<Select label="Source" value={source} onChange={(e) => setSource(e.target.value as Source)} disabled={pending}>
					<option value="recording" disabled={recordings.length === 0}>
						Call recording from Sessions{recordings.length === 0 ? ' (none yet)' : ''}
					</option>
					<option value="link">Video link</option>
					<option value="upload">Upload a video</option>
				</Select>
				{source === 'recording' && (
					<Select label="Recording" value={recordingId} onChange={(e) => setRecordingId(e.target.value)} disabled={pending}>
						{recordings.map((r) => (
							<option key={r.id} value={r.id}>
								{r.label}
							</option>
						))}
					</Select>
				)}
				{source === 'link' && <Input label="Video URL" type="url" placeholder="https://…/recording.mp4 or a YouTube / Zoom share link" value={link} onChange={(e) => setLink(e.target.value)} disabled={pending} />}
				{source === 'upload' && (
					<div className="flex flex-col gap-1">
						<label htmlFor="clip-file" className="text-sm font-medium text-slate-700 dark:text-slate-300">
							Video file (up to 500 MB)
						</label>
						<div className="flex items-center gap-2">
							<input id="clip-file" ref={fileRef} type="file" accept="video/*" className="text-sm text-slate-600 dark:text-slate-300" disabled={pending} />
							<Button size="sm" variant="secondary" onClick={upload} loading={pending}>
								Upload
							</Button>
						</div>
						{uploaded && <p className="text-xs text-green-700 dark:text-green-400">Uploaded {uploaded.name}. The vendor link is valid for 24 hours.</p>}
					</div>
				)}
				<ProviderPicker label="Clip provider" providers={providers} value={provider} onChange={setProvider} disabled={pending} emptyHint="Neither OpusClip nor Descript is configured yet." />
				<div className="grid grid-cols-2 gap-3">
					<Input label="Max clips" type="number" min={1} max={20} value={maxClips} onChange={(e) => setMaxClips(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} disabled={pending} />
					<Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={pending}>
						<option value="">None</option>
						{clients.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</Select>
				</div>
				{provider === 'descript' && <Textarea label="Editing instructions" placeholder="Cut five 30 second clips around the strongest client quotes, burn in captions." value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} disabled={pending} />}
				{error && <Callout tone="error">{error}</Callout>}
				<Button onClick={run} loading={pending} disabled={!provider || !ready}>
					Send for clips
				</Button>
			</Card>

			<div className="lg:col-span-3 space-y-3">
				{jobs.length === 0 && (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400">Clip jobs run async; the card polls and the clips land below it.</p>
					</Card>
				)}
				{jobs.map((job) => (
					<JobCard key={job.id} job={job}>
						<AssetGrid assets={byJob.get(job.id) ?? []} workItems={workItems} columns={2} />
					</JobCard>
				))}
			</div>
		</div>
	);
}
