'use client';

// Brand asset library (0111, Tier B #7): upload, tag, annotate and download
// brand files. Uploads go browser -> private `brand-assets` bucket under the
// admin's session (the 0111 insert policy passes is_admin()); the server
// action then records the path. Previews and downloads use short-lived
// signed URLs (the bucket is private on purpose: fonts, templates and source
// files are not for the open web the way the 0076 logos are).

import { useMemo, useRef, useState, useTransition } from 'react';
import { Download, Loader2, Pencil, Trash2, Upload } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { createClient } from '@/lib/supabase/client';
import {
	BRAND_ASSETS_BUCKET,
	BRAND_ASSETS_PREFIX,
	BRAND_ASSET_KINDS,
	BRAND_ASSET_KIND_LABELS,
	BRAND_ASSET_MAX_BYTES,
	formatBytes,
	safeFileName,
	type BrandAssetKind,
	type BrandAssetRow,
} from '@/lib/brand/assets';
import { archiveBrandAsset, createBrandAsset, signBrandAssetUrl, updateBrandAsset } from './assetActions';

export default function BrandAssetLibrary({ assets, applied, canEdit }: { assets: BrandAssetRow[]; applied: boolean; canEdit: boolean }) {
	const [error, setError] = useState<string | null>(null);
	const [kindFilter, setKindFilter] = useState<string>('');
	const [tagFilter, setTagFilter] = useState<string>('');

	const allTags = useMemo(() => {
		const s = new Set<string>();
		for (const a of assets) for (const t of a.tags ?? []) s.add(t);
		return [...s].sort();
	}, [assets]);

	const visible = assets.filter((a) => (!kindFilter || a.kind === kindFilter) && (!tagFilter || (a.tags ?? []).includes(tagFilter)));

	return (
		<Card className="space-y-4">
			<div className="flex items-center justify-between gap-2 flex-wrap">
				<div>
					<h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">Asset library</h2>
					<p className="text-xs text-slate-500 dark:text-slate-400">Logos, icons, fonts, palettes, templates and photos with usage notes. Private bucket; download links expire after ten minutes.</p>
				</div>
				<div className="flex items-center gap-2">
					<Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Filter by kind">
						<option value="">All kinds</option>
						{BRAND_ASSET_KINDS.map((k) => (
							<option key={k} value={k}>{BRAND_ASSET_KIND_LABELS[k]}</option>
						))}
					</Select>
					{allTags.length > 0 && (
						<Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filter by tag">
							<option value="">All tags</option>
							{allTags.map((t) => (
								<option key={t} value={t}>{t}</option>
							))}
						</Select>
					)}
				</div>
			</div>

			{!applied && <Callout tone="warning">The asset library needs migration 0111_tier_b_bundle.sql applied (brand_assets table + brand-assets bucket).</Callout>}
			{error && <Callout tone="error">{error}</Callout>}

			{canEdit && applied && <UploadForm onError={setError} />}

			{visible.length === 0 ? (
				<p className="text-xs text-slate-500 dark:text-slate-400">{assets.length === 0 ? 'No assets yet.' : 'No assets match that filter.'}</p>
			) : (
				<ul className="divide-y divide-slate-100 dark:divide-slate-800">
					{visible.map((a) => (
						<AssetRow key={a.id} asset={a} canEdit={canEdit} onError={setError} />
					))}
				</ul>
			)}
		</Card>
	);
}

function UploadForm({ onError }: { onError: (m: string | null) => void }) {
	const [kind, setKind] = useState<BrandAssetKind>('logo');
	const [title, setTitle] = useState('');
	const [tags, setTags] = useState('');
	const [notes, setNotes] = useState('');
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const input = useRef<HTMLInputElement>(null);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		onError(null);
		if (!file) { onError('Pick a file first.'); return; }
		if (file.size > BRAND_ASSET_MAX_BYTES) { onError('Files must be under 25 MB.'); return; }
		setBusy(true);
		try {
			const supabase = createClient();
			const path = `${BRAND_ASSETS_PREFIX}${kind}/${Date.now()}-${safeFileName(file.name)}`;
			const { error: upErr } = await supabase.storage
				.from(BRAND_ASSETS_BUCKET)
				.upload(path, file, { contentType: file.type || undefined, upsert: false });
			if (upErr) { onError(`Upload failed: ${upErr.message}`); return; }
			const saved = await createBrandAsset({
				kind, title: title.trim() || file.name, filePath: path,
				mimeType: file.type || null, sizeBytes: file.size, tags, usageNotes: notes,
			});
			if (!saved.ok) {
				await supabase.storage.from(BRAND_ASSETS_BUCKET).remove([path]);
				onError(saved.error);
				return;
			}
			setTitle(''); setTags(''); setNotes(''); setFile(null);
			if (input.current) input.current.value = '';
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-slate-200 dark:border-slate-700 p-3">
			<label className="flex flex-col gap-1 sm:col-span-2">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">File</span>
				<input ref={input} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-slate-600 dark:text-slate-400" />
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Kind</span>
				<Select value={kind} onChange={(e) => setKind(e.target.value as BrandAssetKind)}>
					{BRAND_ASSET_KINDS.map((k) => (
						<option key={k} value={k}>{BRAND_ASSET_KIND_LABELS[k]}</option>
					))}
				</Select>
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Title</span>
				<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name ?? 'Primary logo, horizontal'} maxLength={200} />
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Tags</span>
				<Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dark, web, print" maxLength={600} />
			</label>
			<label className="flex flex-col gap-1">
				<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Usage notes</span>
				<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Where and how to use it; clear-space, minimum size, do-nots." maxLength={4000} />
			</label>
			<div className="sm:col-span-2">
				<Button type="submit" disabled={busy || !file} className="gap-1">
					{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
					Upload asset
				</Button>
			</div>
		</form>
	);
}

function AssetRow({ asset, canEdit, onError }: { asset: BrandAssetRow; canEdit: boolean; onError: (m: string | null) => void }) {
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState(asset.title);
	const [kind, setKind] = useState(asset.kind);
	const [tags, setTags] = useState((asset.tags ?? []).join(', '));
	const [notes, setNotes] = useState(asset.usage_notes_md ?? '');
	const [pending, start] = useTransition();

	function download() {
		start(async () => {
			const r = await signBrandAssetUrl(asset.id);
			if (!r.ok) { onError(r.error); return; }
			if (r.url) window.open(r.url, '_blank', 'noopener');
		});
	}
	function save() {
		start(async () => {
			const r = await updateBrandAsset({ id: asset.id, title, kind, tags, usageNotes: notes });
			if (!r.ok) { onError(r.error); return; }
			setEditing(false);
		});
	}
	function archive() {
		if (!window.confirm(`Archive "${asset.title}" and delete the file?`)) return;
		start(async () => {
			const r = await archiveBrandAsset(asset.id);
			if (!r.ok) onError(r.error);
		});
	}

	const size = formatBytes(asset.size_bytes);
	return (
		<li className="py-2 flex items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				{editing ? (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
						<Select value={kind} onChange={(e) => setKind(e.target.value)}>
							{BRAND_ASSET_KINDS.map((k) => (
								<option key={k} value={k}>{BRAND_ASSET_KIND_LABELS[k]}</option>
							))}
						</Select>
						<Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" maxLength={600} />
						<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
						<div className="sm:col-span-2 flex items-center gap-2">
							<Button size="sm" onClick={save} disabled={pending}>Save</Button>
							<Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
						</div>
					</div>
				) : (
					<>
						<p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
							{asset.title}
							<Badge>{BRAND_ASSET_KIND_LABELS[asset.kind as BrandAssetKind] ?? asset.kind}</Badge>
							{(asset.tags ?? []).map((t) => (
								<span key={t} className="text-2xs px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">{t}</span>
							))}
						</p>
						<p className="text-xs text-slate-500 dark:text-slate-400">
							{asset.file_path.slice(BRAND_ASSETS_PREFIX.length)}
							{asset.mime_type && <> · {asset.mime_type}</>}
							{size && <> · {size}</>}
						</p>
						{asset.usage_notes_md && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{asset.usage_notes_md}</p>}
					</>
				)}
			</div>
			{!editing && (
				<div className="flex items-center gap-1 shrink-0">
					<Button size="sm" variant="outline" onClick={download} disabled={pending} aria-label="Download" className="gap-1">
						<Download className="w-3.5 h-3.5" /> Download
					</Button>
					{canEdit && (
						<>
							<Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending} aria-label="Edit">
								<Pencil className="w-3.5 h-3.5" />
							</Button>
							<Button size="sm" variant="ghost" onClick={archive} disabled={pending} aria-label="Archive">
								<Trash2 className="w-3.5 h-3.5" />
							</Button>
						</>
					)}
				</div>
			)}
		</li>
	);
}
