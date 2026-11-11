'use client';

// File attachments card for The Work items — per Sam 2026-08-10
// ("Precisamos que o usuário possa anexar arquivos ao the work"). Self-fetches
// its own list (same pattern as ChildrenPanel) so it works both inside the
// compact WorkItemDrawer and on the full /the-work/[id] detail page (both the
// universal form layout and the Linear-style Overview). Files live in the
// private 'work-item-attachments' Storage bucket (migration 0022); downloads
// go through a freshly-signed URL fetched on click, never a stored link.
//
// 0052 added URL rows: a row is EITHER a stored file (storage_path) OR a link
// (url), never both. A link row renders as an <a> (with a `deliverable` Badge
// when it is one); a file row keeps its exact download-on-click behaviour.

import { useEffect, useRef, useState } from 'react';
import { Paperclip, X, Download, Link2, ExternalLink } from 'lucide-react';
import { listAttachments, uploadAttachment, deleteAttachment, getAttachmentDownloadUrl, type AttachmentRow } from './attachments-actions';
import { addUrlAttachment } from './social';
import Badge from '@/components/ui/Badge';
import { SkeletonRows } from '@/components/ui/Skeleton';
import Checkbox from '@/components/ui/Checkbox';

interface Props {
	workItemId: string;
	/** Section label. Defaults to the historical "Attachments" so every existing
	 *  caller (drawer, Overview) is untouched; the task detail page passes
	 *  "Deliverables & attachments". */
	heading?: string;
}

function formatBytes(bytes: number | null): string {
	if (!bytes) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsPanel({ workItemId, heading = 'Attachments' }: Props) {
	const [items, setItems] = useState<AttachmentRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// URL deliverables (0052) — the composer is collapsed by default so an
	// item with nothing attached still shows nothing but a muted line.
	const [linking, setLinking] = useState(false);
	const [linkUrl, setLinkUrl] = useState('');
	const [linkLabel, setLinkLabel] = useState('');
	const [linkIsDeliverable, setLinkIsDeliverable] = useState(true);
	const [savingLink, setSavingLink] = useState(false);

	async function refetch() {
		setLoading(true);
		const data = await listAttachments(workItemId);
		setItems(data);
		setLoading(false);
	}

	useEffect(() => {
		refetch();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workItemId]);

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		setError(null);
		setUploading(true);
		// Sequential, not Promise.all — keeps upload order predictable and
		// avoids hammering Storage with a burst when someone drops in a dozen
		// files at once.
		for (const file of Array.from(files)) {
			const formData = new FormData();
			formData.set('file', file);
			formData.set('work_item_id', workItemId);
			const res = await uploadAttachment(formData);
			if (!res.ok) setError(res.error);
		}
		setUploading(false);
		if (fileInputRef.current) fileInputRef.current.value = '';
		await refetch();
	}

	async function handleDelete(id: string) {
		setPendingId(id);
		setError(null);
		const res = await deleteAttachment(id);
		setPendingId(null);
		if (!res.ok) { setError(res.error); return; }
		await refetch();
	}

	async function handleAddLink(e: React.FormEvent) {
		e.preventDefault();
		const url = linkUrl.trim();
		if (!url) return;
		setSavingLink(true);
		setError(null);
		try {
			await addUrlAttachment({
				workItemId,
				url,
				isDeliverable: linkIsDeliverable,
				label: linkLabel.trim() || undefined,
			});
			setLinkUrl('');
			setLinkLabel('');
			setLinking(false);
			await refetch();
		} catch {
			// addUrlAttachment throws a plain Error (zod message or an RLS
			// refusal). Never surface the raw text — the URL check is the only
			// realistic failure and this names it.
			setError('Could not add that link. Use a full http(s) URL.');
		} finally {
			setSavingLink(false);
		}
	}

	async function handleDownload(id: string) {
		setPendingId(id);
		const res = await getAttachmentDownloadUrl(id);
		setPendingId(null);
		if (!res.ok) { setError(res.error); return; }
		window.open(res.url, '_blank', 'noopener');
	}

	return (
		<div>
			<div className="flex items-center justify-between mb-2">
				<div className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">
					{heading} {!loading && `(${items.length})`}
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setLinking((v) => !v)}
						className="transition-colors text-slate-400 hover:text-primary-600 p-0.5 rounded-md"
						title="Add a link"
						aria-expanded={linking}
					>
						<Link2 className="w-3.5 h-3.5" />
					</button>
					<label
						className={`transition-colors text-slate-400 hover:text-primary-600 p-0.5 rounded-md ${uploading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
						title="Attach file(s)"
					>
						<Paperclip className="w-3.5 h-3.5" />
						<input
							ref={fileInputRef}
							type="file"
							multiple
							className="hidden"
							disabled={uploading}
							onChange={(e) => handleFiles(e.target.files)}
						/>
					</label>
				</div>
			</div>

			{linking && (
				<form onSubmit={handleAddLink} className="mb-2 space-y-1.5">
					<input
						type="url"
						value={linkUrl}
						onChange={(e) => setLinkUrl(e.target.value)}
						placeholder="https://docs.google.com/…"
						required
						className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
					/>
					<input
						type="text"
						value={linkLabel}
						onChange={(e) => setLinkLabel(e.target.value)}
						placeholder="Label (optional)"
						className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
					/>
					<div className="flex items-center justify-between gap-2">
						<label className="flex items-center gap-1.5 text-2xs text-slate-500 dark:text-slate-400">
							<Checkbox
								checked={linkIsDeliverable}
								onChange={(e) => setLinkIsDeliverable(e.target.checked)}
							/>
							This is a deliverable
						</label>
						<button
							type="submit"
							disabled={savingLink}
							className="text-2xs font-medium px-2 py-1 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
						>
							{savingLink ? 'Adding…' : 'Add link'}
						</button>
					</div>
				</form>
			)}

			{error && (
				<div className="text-2xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-2 py-1.5 mb-2">
					{error}
				</div>
			)}

			{uploading && <p className="text-xs text-slate-400 mb-1">Uploading…</p>}

			{loading ? (
				<SkeletonRows rows={2} />
			) : items.length === 0 ? (
				// Deliberately quiet: a deliverable is an offer, never a
				// requirement (spec, 2026-08-25). One muted line — no card, no
				// call to action, no warning styling.
				<p className="text-xs text-slate-400">No attachments yet.</p>
			) : (
				<ul className="space-y-1">
					{items.map((a) => (
						<li key={a.id} className="flex items-center justify-between gap-2 group">
							{a.url ? (
								<a
									href={a.url}
									target="_blank"
									rel="noreferrer"
									className="text-xs text-slate-700 dark:text-slate-300 hover:text-primary-600 flex items-center gap-1.5 py-1 min-w-0 flex-1 transition-colors"
									title={a.url}
								>
									<ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
									<span className="truncate">{a.file_name}</span>
									{/* Badge only when it IS a deliverable — the
									    ExternalLink icon already says "link", and
									    labelling a URL row `file` names the one
									    thing it is not. */}
									{a.is_deliverable && (
										<Badge color="primary" className="shrink-0 !text-2xs !px-1.5 !py-0">deliverable</Badge>
									)}
								</a>
							) : (
								<button
									type="button"
									onClick={() => handleDownload(a.id)}
									disabled={pendingId === a.id}
									className="text-xs text-slate-700 dark:text-slate-300 hover:text-primary-600 flex items-center gap-1.5 py-1 min-w-0 flex-1 text-left disabled:opacity-50 transition-colors"
									title="Download"
								>
									<Download className="w-3 h-3 shrink-0 text-slate-400" />
									<span className="truncate">{a.file_name}</span>
									<span className="text-2xs text-slate-600 dark:text-slate-400 shrink-0">{formatBytes(a.file_size)}</span>
								</button>
							)}
							<button
								type="button"
								onClick={() => handleDelete(a.id)}
								disabled={pendingId === a.id}
								className="text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 disabled:opacity-50"
								title="Remove"
							>
								<X className="w-3 h-3" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
