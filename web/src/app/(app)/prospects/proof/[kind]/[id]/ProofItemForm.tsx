'use client';

// The one edit form for case studies, testimonials and assets. Field sets
// differ per kind; the save action validates with zod per kind.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import {
	ASSET_TYPES,
	ASSET_TYPE_LABELS,
	INDUSTRY_LABELS,
	KIND_SEGMENTS,
	PROOF_INDUSTRIES,
	PROOF_SERVICES,
	PROOF_STATUSES,
	SERVICE_LABELS,
	type ItemKind,
} from '@/lib/proof/shared';
import { deleteProofItem, saveProofItem } from '../../actions';

type Row = Record<string, unknown>;
const str = (row: Row | null, k: string) => (row && row[k] != null ? String(row[k]) : '');
const arr = (row: Row | null, k: string) => (row && Array.isArray(row[k]) ? (row[k] as string[]) : []);

export default function ProofItemForm({ kind, id, row, canManage, clients }: { kind: ItemKind; id: string | null; row: Row | null; canManage: boolean; clients: { id: string; name: string }[] }) {
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();
	const { toast } = useToast();
	const ro = !canManage;

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const fd = new FormData(e.currentTarget);
		setError(null);
		start(async () => {
			const res = await saveProofItem(kind, id, fd);
			if (!res.ok) {
				setError(res.error);
				return;
			}
			toast({ message: 'Saved.', variant: 'success' });
			if (!id) router.replace(`/prospects/proof/${KIND_SEGMENTS[kind]}/${res.id}`);
			else router.refresh();
		});
	}

	function onDelete() {
		if (!id || !window.confirm('Delete this item and its slot placements?')) return;
		start(async () => {
			const res = await deleteProofItem(kind, id);
			if (!res.ok) {
				setError(res.error);
				return;
			}
			router.replace(`/prospects/proof?tab=${KIND_SEGMENTS[kind]}`);
		});
	}

	return (
		<form onSubmit={onSubmit} className="space-y-4 max-w-3xl">
			{ro && <Callout tone="info">Read only: editing the Proof Library needs the manage_revenue capability.</Callout>}
			{error && <Callout tone="error">{error}</Callout>}
			<fieldset disabled={ro || pending} className="space-y-4">
				<Card className="space-y-3">
					{kind === 'case_study' && (
						<>
							<div className="grid gap-3 sm:grid-cols-2">
								<Input label="Client name" name="client_name" required defaultValue={str(row, 'client_name')} />
								<Input label="Year" name="year" type="number" min={2010} max={2100} defaultValue={str(row, 'year')} />
							</div>
							<Input label="Headline" name="headline" defaultValue={str(row, 'headline')} placeholder="What happened, in one line" />
						</>
					)}
					{kind === 'testimonial' && (
						<>
							<Textarea label="Quote (the client's own words)" name="quote" required rows={4} defaultValue={str(row, 'quote')} />
							<div className="grid gap-3 sm:grid-cols-3">
								<Input label="Person" name="person" defaultValue={str(row, 'person')} />
								<Input label="Title" name="title" defaultValue={str(row, 'title')} />
								<Input label="Company" name="company" defaultValue={str(row, 'company')} />
							</div>
						</>
					)}
					{kind === 'asset' && (
						<>
							<div className="grid gap-3 sm:grid-cols-2">
								<Select label="Type" name="type" defaultValue={str(row, 'type') || 'press_logo'}>
									{ASSET_TYPES.map((t) => (
										<option key={t} value={t}>
											{ASSET_TYPE_LABELS[t]}
										</option>
									))}
								</Select>
								<Input label="Label" name="label" required defaultValue={str(row, 'label')} placeholder="Forbes · Acme logo · Placements in 2025" />
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<Input label="URL (image / video / page)" name="url" defaultValue={str(row, 'url')} placeholder="https://…" />
								<Input label="Stat value (type = stat)" name="value" defaultValue={str(row, 'value')} placeholder="1,200+ placements" />
							</div>
							<Textarea label="Description" name="description" rows={2} defaultValue={str(row, 'description')} />
							{str(row, 'storage_path') && <p className="text-xs text-slate-500">Stored in bucket proof-assets at <code>{str(row, 'storage_path')}</code>.</p>}
						</>
					)}

					<div className="grid gap-3 sm:grid-cols-3">
						<Select label="Industry" name="industry" defaultValue={str(row, 'industry') || 'other'}>
							{PROOF_INDUSTRIES.map((i) => (
								<option key={i} value={i}>
									{INDUSTRY_LABELS[i]}
								</option>
							))}
						</Select>
						<Select label="Status" name="status" defaultValue={str(row, 'status') || 'draft'}>
							{PROOF_STATUSES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</Select>
						<Select label="Client (Open Ronin)" name="client_id" defaultValue={str(row, 'client_id')}>
							<option value="">— not linked —</option>
							{clients.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</Select>
					</div>
					<div>
						<div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Services</div>
						<div className="flex flex-wrap gap-4">
							{PROOF_SERVICES.map((s) => (
								<label key={s} className="flex items-center gap-2 text-sm">
									<Checkbox name="services" value={s} defaultChecked={arr(row, 'services').includes(s)} />
									{SERVICE_LABELS[s]}
								</label>
							))}
						</div>
					</div>
				</Card>

				{kind === 'case_study' && (
					<Card className="space-y-3">
						<Textarea label="Problem" name="problem" rows={3} defaultValue={str(row, 'problem')} />
						<Textarea label="Approach" name="approach" rows={3} defaultValue={str(row, 'approach')} />
						<Textarea label="Results (text)" name="results" rows={4} defaultValue={str(row, 'results')} />
						<Textarea
							label="Metrics (JSON object, only numbers the source states)"
							name="metrics"
							rows={3}
							className="font-mono text-xs"
							defaultValue={row && row.metrics && Object.keys(row.metrics as object).length ? JSON.stringify(row.metrics, null, 2) : ''}
							placeholder='{"placements": 12, "impressions": 4500000, "outlets": ["Forbes"]}'
						/>
						<Input label="Notable outlets (comma separated)" name="notable_outlets" defaultValue={arr(row, 'notable_outlets').join(', ')} />
						<Textarea label="Client quote" name="quote" rows={2} defaultValue={str(row, 'quote')} />
						<div className="grid gap-3 sm:grid-cols-2">
							<Input label="Quote person" name="quote_person" defaultValue={str(row, 'quote_person')} />
							<Input label="Quote title" name="quote_title" defaultValue={str(row, 'quote_title')} />
						</div>
					</Card>
				)}

				<Card className="space-y-3">
					<div className="grid gap-3 sm:grid-cols-2">
						{kind !== 'asset' && (
							<Select label="Media type (which slots can rotate it)" name="media_type" defaultValue={str(row, 'media_type') || 'text'}>
								<option value="text">Text (written)</option>
								<option value="video">Video</option>
								{kind === 'testimonial' && <option value="image">Image (screenshot of the review)</option>}
							</Select>
						)}
						{kind !== 'asset' && <Input label="Video URL" name="video_url" defaultValue={str(row, 'video_url')} placeholder="Drive / YouTube / Vimeo link" />}
						<Input label="Thumbnail URL" name="thumbnail_url" defaultValue={str(row, 'thumbnail_url')} />
						{kind !== 'asset' && <Input label="Image URL" name="image_url" defaultValue={str(row, 'image_url')} />}
					</div>
					{kind === 'testimonial' && (
						<div className="grid gap-3 sm:grid-cols-2">
							<Input label="Source (where it was said)" name="source" defaultValue={str(row, 'source')} placeholder="Google review · email · video reel Aug 2026" />
							<Input label="Rating (1-5)" name="rating" type="number" min={1} max={5} defaultValue={str(row, 'rating')} />
						</div>
					)}
					{kind !== 'asset' && (
						<Input label="Slug" name="slug" defaultValue={str(row, 'slug')} placeholder="auto from the name when blank" />
					)}
					<Input label="Tags (comma separated)" name="tags" defaultValue={arr(row, 'tags').join(', ')} />
					<Textarea label="Source URLs (one per line)" name="source_urls" rows={2} defaultValue={arr(row, 'source_urls').join('\n')} />
					{arr(row, 'source_file_ids').length > 0 && (
						<p className="text-xs text-slate-500">
							Drive sources:{' '}
							{arr(row, 'source_file_ids').map((f) => (
								<a key={f} href={`https://drive.google.com/open?id=${f}`} target="_blank" rel="noreferrer" className="underline mr-2">
									{f.slice(0, 10)}…
								</a>
							))}
						</p>
					)}
					<div className="flex flex-wrap gap-6 items-center">
						{kind !== 'asset' && (
							<label className="flex items-center gap-2 text-sm">
								<Checkbox name="is_featured" defaultChecked={!!row?.is_featured} /> Featured
							</label>
						)}
						{kind === 'case_study' && (
							<div className="w-40">
								<Input label="Strength (0-100)" name="strength" type="number" min={0} max={100} defaultValue={str(row, 'strength') || '0'} />
							</div>
						)}
					</div>
				</Card>
			</fieldset>

			{canManage && (
				<div className="flex items-center gap-2">
					<Button type="submit" loading={pending}>
						{id ? 'Save' : 'Create'}
					</Button>
					{id && (
						<Button type="button" variant="ghost" onClick={onDelete} disabled={pending} className="text-red-600">
							Delete
						</Button>
					)}
				</div>
			)}
		</form>
	);
}
