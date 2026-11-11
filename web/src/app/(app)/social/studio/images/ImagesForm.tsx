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
import { IMAGE_SIZES, IMAGE_STYLES, type ProviderOption, type StudioAsset, type StudioJob } from '@/lib/content-studio/shared';
import { editImage, generateImages } from '../actions';

interface Props {
	providers: ProviderOption[];
	editProviders: ProviderOption[];
	clients: { id: string; name: string; status: string }[];
	workItems: { id: string; name: string }[];
	jobs: StudioJob[];
	assets: StudioAsset[];
}

export default function ImagesForm({ providers, editProviders, clients, workItems, jobs, assets }: Props) {
	const router = useRouter();
	const [prompt, setPrompt] = useState('');
	const [size, setSize] = useState<string>(IMAGE_SIZES[0].value);
	const [style, setStyle] = useState<string>('');
	const [count, setCount] = useState(1);
	const [clientId, setClientId] = useState('');
	const [provider, setProvider] = useState(providers[0]?.id ?? '');
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const [lastPrompt, setLastPrompt] = useState<string | null>(null);

	// Edit dialog state (inline, one at a time).
	const [editing, setEditing] = useState<StudioAsset | null>(null);
	const [editPrompt, setEditPrompt] = useState('');
	const [editProvider, setEditProvider] = useState(editProviders[0]?.id ?? '');

	function run(p = prompt) {
		setError(null);
		start(async () => {
			const res = await generateImages(provider, { prompt: p, size, style: style || undefined, count, clientId });
			if (!res.ok) setError(res.error);
			else setLastPrompt(p);
			router.refresh();
		});
	}

	function submitEdit() {
		if (!editing) return;
		setError(null);
		start(async () => {
			const res = await editImage(editProvider, editing.storage_path, editPrompt, size);
			if (!res.ok) setError(res.error);
			else {
				setEditing(null);
				setEditPrompt('');
			}
			router.refresh();
		});
	}

	const byJob = new Map<string, StudioAsset[]>();
	for (const a of assets) byJob.set(a.job_id, [...(byJob.get(a.job_id) ?? []), a]);

	return (
		<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
			<Card className="lg:col-span-2 space-y-3 self-start">
				<Textarea label="Prompt" placeholder="A founder at a farmers market holding compostable packaging, morning light, candid." value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={pending} maxLength={3000} />
				<div className="grid grid-cols-2 gap-3">
					<Select label="Size" value={size} onChange={(e) => setSize(e.target.value)} disabled={pending}>
						{IMAGE_SIZES.map((s) => (
							<option key={s.value} value={s.value}>
								{s.label}
							</option>
						))}
					</Select>
					<Select label="Style" value={style} onChange={(e) => setStyle(e.target.value)} disabled={pending}>
						<option value="">Any</option>
						{IMAGE_STYLES.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</Select>
					<Input label="Count" type="number" min={1} max={4} value={count} onChange={(e) => setCount(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} disabled={pending} />
					<Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={pending}>
						<option value="">None</option>
						{clients.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</Select>
				</div>
				<ProviderPicker label="Image provider" providers={providers} value={provider} onChange={setProvider} disabled={pending} />
				{error && <Callout tone="error">{error}</Callout>}
				<div className="flex items-center gap-2">
					<Button onClick={() => run()} loading={pending} disabled={!provider || prompt.trim().length < 3}>
						Generate
					</Button>
					{lastPrompt && (
						<Button variant="outline" onClick={() => run(lastPrompt)} disabled={pending || !provider}>
							Regenerate last
						</Button>
					)}
				</div>
			</Card>

			<div className="lg:col-span-3 space-y-3">
				{editing && (
					<Card className="space-y-3 border-primary-300 dark:border-primary-700">
						<p className="text-sm font-medium text-slate-900 dark:text-slate-100">Edit {editing.label ?? 'image'}</p>
						<Textarea label="What should change" value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="Replace the background with a plain teal wall." />
						<ProviderPicker label="Edit provider" providers={editProviders} value={editProvider} onChange={setEditProvider} emptyHint="No image-edit provider is configured (OpenAI, Ideogram or Stability)." />
						<div className="flex items-center gap-2">
							<Button size="sm" onClick={submitEdit} loading={pending} disabled={!editProvider || editPrompt.trim().length < 3}>
								Run edit
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
								Cancel
							</Button>
						</div>
					</Card>
				)}
				{jobs.length === 0 && (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400">Results land here as a grid.</p>
					</Card>
				)}
				{jobs.map((job) => (
					<JobCard key={job.id} job={job}>
						<AssetGrid
							assets={byJob.get(job.id) ?? []}
							workItems={workItems}
							columns={2}
							renderExtra={
								editProviders.length > 0
									? (a) =>
											a.mime.startsWith('image/') ? (
												<Button size="sm" variant="outline" onClick={() => setEditing(a)}>
													Edit
												</Button>
											) : null
									: undefined
							}
						/>
					</JobCard>
				))}
			</div>
		</div>
	);
}
