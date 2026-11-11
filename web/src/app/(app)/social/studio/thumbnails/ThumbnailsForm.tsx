'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import ProviderPicker from '@/components/content-studio/ProviderPicker';
import JobCard from '@/components/content-studio/JobCard';
import AssetGrid from '@/components/content-studio/AssetGrid';
import { THUMBNAIL_PRESETS, THUMBNAIL_SIZES, type ProviderOption, type StudioAsset, type StudioJob } from '@/lib/content-studio/shared';
import { generateThumbnail } from '../actions';

interface Props {
	providers: ProviderOption[];
	clients: { id: string; name: string; status: string }[];
	workItems: { id: string; name: string }[];
	jobs: StudioJob[];
	assets: StudioAsset[];
	brand: { name: string; primaryColor: string; accentColor: string };
}

export default function ThumbnailsForm({ providers, clients, workItems, jobs, assets, brand }: Props) {
	const router = useRouter();
	const [title, setTitle] = useState('');
	const [subject, setSubject] = useState('');
	const [preset, setPreset] = useState<string>(THUMBNAIL_PRESETS[0].value);
	const [size, setSize] = useState<string>(THUMBNAIL_SIZES[0].value);
	const [clientId, setClientId] = useState('');
	const [provider, setProvider] = useState(providers[0]?.id ?? '');
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();

	function run() {
		setError(null);
		start(async () => {
			const res = await generateThumbnail(provider, { title, preset, size, subject: subject || undefined, clientId, brand });
			if (!res.ok) setError(res.error);
			router.refresh();
		});
	}

	const byJob = new Map<string, StudioAsset[]>();
	for (const a of assets) byJob.set(a.job_id, [...(byJob.get(a.job_id) ?? []), a]);

	return (
		<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
			<Card className="lg:col-span-2 space-y-3 self-start">
				<Input label="Title text" placeholder="3 PR moves every founder skips" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={pending} />
				<Input label="Subject (optional)" placeholder="Founder headshot, product close-up..." value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} disabled={pending} />
				<div className="grid grid-cols-2 gap-3">
					<Select label="Preset" value={preset} onChange={(e) => setPreset(e.target.value)} disabled={pending}>
						{THUMBNAIL_PRESETS.map((p) => (
							<option key={p.value} value={p.value}>
								{p.label}
							</option>
						))}
					</Select>
					<Select label="Size" value={size} onChange={(e) => setSize(e.target.value)} disabled={pending}>
						{THUMBNAIL_SIZES.map((s) => (
							<option key={s.value} value={s.value}>
								{s.label}
							</option>
						))}
					</Select>
				</div>
				<Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={pending}>
					<option value="">None</option>
					{clients.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>
				<div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
					<span className="inline-block w-4 h-4 rounded-md border border-slate-200 dark:border-slate-700" style={{ backgroundColor: brand.primaryColor }} aria-hidden />
					<span className="inline-block w-4 h-4 rounded-md border border-slate-200 dark:border-slate-700" style={{ backgroundColor: brand.accentColor }} aria-hidden />
					{brand.name} palette from /admin/brand
				</div>
				<ProviderPicker label="Image provider" providers={providers} value={provider} onChange={setProvider} disabled={pending} />
				{error && <Callout tone="error">{error}</Callout>}
				<Button onClick={run} loading={pending} disabled={!provider || title.trim().length < 2}>
					Generate thumbnail
				</Button>
			</Card>

			<div className="lg:col-span-3 space-y-3">
				{jobs.length === 0 && (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400">Thumbnails land here with download, copy link and attach to task.</p>
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
