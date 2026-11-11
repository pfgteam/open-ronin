'use client';

// AssetGrid: content assets with a signed preview, download, copy link and
// "attach to task" (copies the file into work-item-attachments and writes
// the 0022 row through attachAssetToWorkItem).

import { useState, useTransition } from 'react';
import { Check, Copy, Download, Paperclip } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Select from '@/components/ui/Select';
import type { StudioAsset } from '@/lib/content-studio/shared';
import { attachAssetToWorkItem } from '@/app/(app)/social/studio/actions';

interface Props {
	assets: StudioAsset[];
	workItems: { id: string; name: string }[];
	/** Extra per-asset action (Image Studio's Edit). */
	renderExtra?: (asset: StudioAsset) => React.ReactNode;
	columns?: 2 | 3 | 4;
}

function sizeLabel(a: StudioAsset): string {
	const parts: string[] = [];
	if (a.width && a.height) parts.push(`${a.width}×${a.height}`);
	if (a.duration_seconds) parts.push(`${Math.round(a.duration_seconds)}s`);
	if (a.bytes) parts.push(a.bytes < 1024 * 1024 ? `${Math.round(a.bytes / 1024)} KB` : `${(a.bytes / 1024 / 1024).toFixed(1)} MB`);
	return parts.join(' · ');
}

function Preview({ a }: { a: StudioAsset }) {
	if (!a.url) return <div className="aspect-video bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">No preview</div>;
	if (a.mime.startsWith('image/')) {
		// eslint-disable-next-line @next/next/no-img-element -- signed, short lived URL; next/image cannot optimise it
		return <img src={a.url} alt={a.label ?? 'Generated image'} className="w-full aspect-video object-cover bg-slate-100 dark:bg-slate-700" />;
	}
	if (a.mime.startsWith('video/')) return <video src={a.url} controls className="w-full aspect-video bg-slate-900" />;
	if (a.mime.startsWith('audio/')) {
		return (
			<div className="aspect-video bg-slate-100 dark:bg-slate-700 flex items-center justify-center px-3">
				<audio src={a.url} controls className="w-full" />
			</div>
		);
	}
	return <div className="aspect-video bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">{a.mime}</div>;
}

export default function AssetGrid({ assets, workItems, renderExtra, columns = 3 }: Props) {
	const [copied, setCopied] = useState<string | null>(null);
	const [attachTarget, setAttachTarget] = useState<Record<string, string>>({});
	const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
	const [pending, start] = useTransition();

	if (assets.length === 0) return null;

	async function copy(a: StudioAsset) {
		if (!a.url) return;
		try {
			await navigator.clipboard.writeText(a.url);
			setCopied(a.id);
			setTimeout(() => setCopied(null), 1500);
		} catch {
			setNotice({ tone: 'error', text: 'Clipboard is not available in this browser.' });
		}
	}

	function attach(a: StudioAsset) {
		const target = attachTarget[a.id] ?? workItems[0]?.id;
		if (!target) return;
		setNotice(null);
		start(async () => {
			const res = await attachAssetToWorkItem(a.id, target);
			setNotice(res.ok ? { tone: 'success', text: `Attached to ${workItems.find((w) => w.id === target)?.name ?? 'the task'}.` } : { tone: 'error', text: res.error });
		});
	}

	const cols = columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';

	return (
		<div className="space-y-3">
			{notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
			<div className={`grid grid-cols-1 ${cols} gap-3`}>
				{assets.map((a) => (
					<div key={a.id} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
						<Preview a={a} />
						<div className="p-3 space-y-2">
							<div className="flex items-center justify-between gap-2">
								<p className="text-xs text-slate-600 dark:text-slate-300 truncate">{a.label ?? a.mime}</p>
								<p className="text-2xs text-slate-400 dark:text-slate-500 whitespace-nowrap">{sizeLabel(a)}</p>
							</div>
							<div className="flex items-center gap-1.5 flex-wrap">
								{a.url && (
									<a
										href={a.url}
										download
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45"
									>
										<Download className="w-3.5 h-3.5" /> Download
									</a>
								)}
								<Button size="sm" variant="outline" onClick={() => copy(a)} disabled={!a.url}>
									{copied === a.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
									{copied === a.id ? 'Copied' : 'Copy link'}
								</Button>
								{renderExtra?.(a)}
							</div>
							{workItems.length > 0 && (
								<div className="flex items-end gap-1.5">
									<div className="flex-1 min-w-0">
										<Select size="sm" aria-label="Task" value={attachTarget[a.id] ?? workItems[0].id} onChange={(e) => setAttachTarget((m) => ({ ...m, [a.id]: e.target.value }))}>
											{workItems.map((w) => (
												<option key={w.id} value={w.id}>
													{w.name}
												</option>
											))}
										</Select>
									</div>
									<Button size="sm" variant="secondary" onClick={() => attach(a)} disabled={pending}>
										<Paperclip className="w-3.5 h-3.5" /> Attach
									</Button>
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
