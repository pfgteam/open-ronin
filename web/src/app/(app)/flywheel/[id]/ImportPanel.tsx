'use client';

// Flywheel F8: Import tab. Read a tracker tab (Google Sheet through the
// app's service account, or a pasted CSV), preview the plan (pages /
// citations / review rows, unknown headers reported), then apply. The
// review list below is every row that could not be placed, with its reason;
// a row can be ignored or sent back to unmatched. Nothing is ever dropped.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { IMPORT_FIELD_LABELS, type ApplyCounts, type ImportBatchRow, type ImportField, type ImportReviewRow, type PreviewPayload } from '@/lib/flywheel/import';
import ActionForm from '../ActionForm';
import { importTracker, listTabs, setReviewRowStatus } from '../importActions';

interface Props {
	programId: string;
	trackerSheetUrl: string | null;
	sheetsConfigured: boolean;
	serviceAccountEmail: string | null;
	batches: ImportBatchRow[];
	review: ImportReviewRow[];
	imported: { pages: number; citations: number };
	clusters: { id: string; number: number; anchor_keyword: string | null }[];
}

export default function ImportPanel({ programId, trackerSheetUrl, sheetsConfigured, serviceAccountEmail, batches, review, imported, clusters }: Props) {
	const [kind, setKind] = useState<'sheets' | 'csv'>(sheetsConfigured ? 'sheets' : 'csv');
	const [sheet, setSheet] = useState(trackerSheetUrl ?? '');
	const [tabs, setTabs] = useState<string[] | null>(null);
	const [tab, setTab] = useState('');
	const [csv, setCsv] = useState('');
	const [fileName, setFileName] = useState('');
	const [preview, setPreview] = useState<PreviewPayload | null>(null);
	const [applied, setApplied] = useState<ApplyCounts | null>(null);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, start] = useTransition();
	const clusterLabel = (id: string) => {
		const c = clusters.find((x) => x.id === id);
		return c ? `#${c.number}${c.anchor_keyword ? ` ${c.anchor_keyword}` : ''}` : id.slice(0, 8);
	};

	const run = (mode: 'preview' | 'apply') =>
		start(async () => {
			setMsg(null);
			if (mode === 'preview') setApplied(null);
			const fd = new FormData();
			fd.set('program_id', programId);
			fd.set('source_kind', kind);
			fd.set('mode', mode);
			if (kind === 'sheets') {
				fd.set('sheet', sheet);
				fd.set('tab', tab);
			} else {
				fd.set('csv', csv);
				fd.set('file_name', fileName);
			}
			const r = await importTracker(fd);
			if (!r.ok) {
				setMsg({ ok: false, text: r.error });
				return;
			}
			setPreview(r.preview);
			if (r.applied) {
				setApplied(r.applied);
				setMsg({ ok: true, text: `Imported: ${r.applied.pages_inserted + r.applied.pages_updated} pages (${r.applied.pages_inserted} new), ${r.applied.citations_inserted + r.applied.citations_updated} citations (${r.applied.citations_inserted} new), ${r.applied.review} on the review list.` });
			} else setMsg({ ok: true, text: `Preview only, nothing written. ${r.preview.summary}.` });
		});

	const loadTabs = () =>
		start(async () => {
			setMsg(null);
			const fd = new FormData();
			fd.set('sheet', sheet);
			const r = await listTabs(fd);
			if (!r.ok) {
				setMsg({ ok: false, text: r.error });
				setTabs(null);
				return;
			}
			setTabs(r.tabs);
			setTab((t) => (r.tabs.includes(t) ? t : r.tabs[0] ?? ''));
			setMsg({ ok: true, text: `${r.title}: ${r.tabs.length} tab${r.tabs.length === 1 ? '' : 's'}.` });
		});

	const open = review.filter((r) => r.status === 'unmatched');
	const closed = review.filter((r) => r.status !== 'unmatched');

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="lg:col-span-2 space-y-4">
				<Card>
					<div className="flex items-center justify-between mb-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Import a tracker</h2>
						<Badge color={imported.pages + imported.citations > 0 ? 'success' : 'default'}>
							{imported.pages} pages · {imported.citations} citations imported
						</Badge>
					</div>
					<p className="text-xs text-slate-500 mb-3">
						Rows become on-site pages (program domain / &ldquo;page&rdquo; rows) or Citation Ledger entries (Medium, LinkedIn, Quora, Reddit, Shorts, FAQ, podcast — by asset type or URL host). Keyed on the sheet row, so re-importing updates instead of duplicating. Unknown headers are reported, never guessed; rows that cannot be placed go to the review list below.
					</p>
					<div className="flex gap-1.5 mb-3">
						<Button type="button" size="sm" variant={kind === 'sheets' ? 'primary' : 'outline'} onClick={() => setKind('sheets')} disabled={pending}>
							Google Sheet
						</Button>
						<Button type="button" size="sm" variant={kind === 'csv' ? 'primary' : 'outline'} onClick={() => setKind('csv')} disabled={pending}>
							Paste CSV
						</Button>
					</div>
					{kind === 'sheets' ? (
						<div className="space-y-2">
							{!sheetsConfigured ? (
								<Callout tone="warning">GOOGLE_SERVICE_ACCOUNT_JSON is not set in this environment, so Google Sheets cannot be read here. Use Paste CSV (File → Download → CSV on the tab).</Callout>
							) : (
								<p className="text-2xs text-slate-500">
									Share the sheet with {serviceAccountEmail ? <code className="font-mono">{serviceAccountEmail}</code> : 'the app service account'} (Viewer) first.
								</p>
							)}
							<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
								<Input label="Sheet URL or id" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" disabled={pending || !sheetsConfigured} />
								<div className="self-end">
									<Button type="button" size="sm" variant="outline" onClick={loadTabs} disabled={pending || !sheetsConfigured || sheet.trim().length < 20}>
										Load tabs
									</Button>
								</div>
							</div>
							{tabs && (
								<Select label="Tab" size="sm" value={tab} onChange={(e) => setTab(e.target.value)} disabled={pending}>
									{tabs.map((t) => (
										<option key={t} value={t}>
											{t}
										</option>
									))}
								</Select>
							)}
						</div>
					) : (
						<div className="space-y-2">
							<Input label="Name (optional)" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="Published Asset Inventory" disabled={pending} />
							<Textarea label="CSV, header row first" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Date Published,Asset Type,Title,URL,Keyword,Cluster,Page,Posted By,Status,Notes\n9/12/2026,Medium article,…'} className="font-mono text-xs" disabled={pending} />
						</div>
					)}
					<div className="flex items-center gap-2 mt-3">
						<Button type="button" size="sm" variant="outline" onClick={() => run('preview')} disabled={pending || (kind === 'sheets' ? !tab : csv.trim().length === 0)}>
							Preview
						</Button>
						<Button type="button" size="sm" onClick={() => run('apply')} disabled={pending || !preview || Boolean(applied) || preview.missing.length > 0}>
							Import {preview ? `${preview.pages.length} pages + ${preview.citations.length} citations` : ''}
						</Button>
						{pending && <span className="text-xs text-slate-500">Working…</span>}
					</div>
					{msg && (
						<Callout tone={msg.ok ? 'success' : 'error'} className="mt-3">
							{msg.text}
						</Callout>
					)}
				</Card>

				{preview && (
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
							Plan · <span className="font-normal text-slate-500">{preview.source.title}</span>
						</h2>
						<div className="flex flex-wrap gap-1.5 mb-3 text-2xs">
							{(Object.keys(preview.mapping) as ImportField[]).map((f) => (
								<Badge key={f} color="primary">
									{IMPORT_FIELD_LABELS[f]} ← {preview.headers[preview.mapping[f]]}
								</Badge>
							))}
							{preview.unknown.map((h) => (
								<Badge key={`u-${h}`} color="warning">
									not mapped: {h}
								</Badge>
							))}
						</div>
						{preview.missing.length > 0 && <Callout tone="error" className="mb-3">No URL or asset type column was recognised, so rows cannot be classified. Rename the column in the sheet and preview again.</Callout>}
						<div className="grid gap-3 md:grid-cols-2">
							<div>
								<h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">On-site pages ({preview.pages.length})</h3>
								<ul className="text-xs divide-y divide-slate-200 dark:divide-slate-700">
									{preview.pages.map((p) => (
										<li key={p.row} className="py-1 flex items-start justify-between gap-2">
											<span className="min-w-0">
												<span className="text-slate-500">row {p.row}</span> · {clusterLabel(p.cluster_id)} p{p.number} · <span className="text-slate-900 dark:text-slate-100">{p.keyword}</span>
												{p.url && (
													<a href={p.url} target="_blank" rel="noreferrer" className="ml-1 text-primary-600 hover:underline">
														url
													</a>
												)}
											</span>
											<Badge color={p.update ? 'default' : 'success'}>{p.update ? `update · ${p.status}` : p.status}</Badge>
										</li>
									))}
									{preview.pages.length === 0 && <li className="py-1 text-slate-500">none</li>}
								</ul>
							</div>
							<div>
								<h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Citations ({preview.citations.length})</h3>
								<ul className="text-xs divide-y divide-slate-200 dark:divide-slate-700">
									{preview.citations.map((c) => (
										<li key={c.row} className="py-1 flex items-start justify-between gap-2">
											<span className="min-w-0">
												<span className="text-slate-500">row {c.row}</span> · {c.channel}
												{c.keyword ? ` · ${c.keyword}` : ''}
												{c.url && (
													<a href={c.url} target="_blank" rel="noreferrer" className="ml-1 text-primary-600 hover:underline">
														url
													</a>
												)}
												{!c.page_known && <span className="ml-1 text-amber-600 dark:text-amber-400">no page</span>}
											</span>
											<Badge color={c.status === 'live' ? 'success' : c.status === 'posted' ? 'primary' : 'default'}>{c.status}</Badge>
										</li>
									))}
									{preview.citations.length === 0 && <li className="py-1 text-slate-500">none</li>}
								</ul>
							</div>
						</div>
						{preview.review.length > 0 && (
							<div className="mt-3">
								<h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">To review ({preview.review.length}) — written to the review list on import, not dropped</h3>
								<ul className="text-xs divide-y divide-slate-200 dark:divide-slate-700">
									{preview.review.map((r) => (
										<li key={r.row} className="py-1">
											<span className="text-slate-500">row {r.row}</span> · {r.reason}
										</li>
									))}
								</ul>
							</div>
						)}
						{preview.blank > 0 && <p className="mt-2 text-2xs text-slate-500">{preview.blank} blank row{preview.blank === 1 ? '' : 's'} skipped.</p>}
					</Card>
				)}

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
						Review list <Badge color={open.length ? 'warning' : 'success'}>{open.length} open</Badge>
					</h2>
					{open.length === 0 && closed.length === 0 && <p className="text-xs text-slate-500">Nothing to review. Rows the importer cannot place land here with the reason.</p>}
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{[...open, ...closed].map((r) => (
							<li key={r.id} className="py-1.5 text-xs">
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<span className="font-mono text-2xs text-slate-500">{r.import_ref}</span>
										<p className={r.status === 'unmatched' ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 line-through'}>{r.reason}</p>
										<p className="text-2xs text-slate-500 truncate">
											{Object.entries(r.raw)
												.map(([k, v]) => `${k}: ${v}`)
												.join(' · ')}
										</p>
									</div>
									<div className="flex items-center gap-1 shrink-0">
										{r.status === 'resolved' && <Badge color="success">resolved{r.resolved_kind ? ` · ${r.resolved_kind}` : ''}</Badge>}
										{r.status === 'ignored' && <Badge>ignored</Badge>}
										{r.status !== 'resolved' && (
											<ActionForm action={setReviewRowStatus} success={null} className="inline">
												<input type="hidden" name="id" value={r.id} />
												<input type="hidden" name="program_id" value={programId} />
												<input type="hidden" name="status" value={r.status === 'unmatched' ? 'ignored' : 'unmatched'} />
												<Button type="submit" size="sm" variant="ghost">
													{r.status === 'unmatched' ? 'Ignore' : 'Reopen'}
												</Button>
											</ActionForm>
										)}
									</div>
								</div>
							</li>
						))}
					</ul>
					{open.length > 0 && (
						<p className="mt-2 text-2xs text-slate-500">
							Fix the row in the sheet and re-import (same row → updates in place), or add it by hand on the <Link href={`/flywheel/${programId}?tab=clusters`} className="underline">Clusters &amp; pages</Link> tab and ignore it here.
						</p>
					)}
				</Card>
			</div>

			<div className="space-y-4">
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Import history</h2>
					{batches.length === 0 ? (
						<p className="text-xs text-slate-500">No imports yet.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
							{batches.map((b) => (
								<li key={b.id} className="py-1.5">
									<div className="flex items-center justify-between gap-2">
										<span className="text-slate-900 dark:text-slate-100 truncate">{b.source_kind === 'sheets' ? b.tab ?? 'sheet' : b.file_name ?? 'csv'}</span>
										<Badge color={b.mode === 'apply' ? 'success' : 'default'}>{b.mode}</Badge>
									</div>
									<p className="text-2xs text-slate-500">
										{new Date(b.created_at).toLocaleString()} · {b.counts.rows ?? 0} rows
										{b.mode === 'apply' ? ` · ${(b.counts.pages_inserted ?? 0) + (b.counts.pages_updated ?? 0)} pages · ${(b.counts.citations_inserted ?? 0) + (b.counts.citations_updated ?? 0)} citations · ${b.counts.review ?? 0} review` : ''}
										{b.unknown_headers.length ? ` · unknown: ${b.unknown_headers.join(', ')}` : ''}
										{b.counts.error ? ` · ${b.counts.error}` : ''}
									</p>
								</li>
							))}
						</ul>
					)}
				</Card>
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">How rows are read</h2>
					<ul className="text-2xs text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-4">
						<li>Header aliases: Asset type / Channel / Platform, Title, URL / Link, Keyword, Cluster, Page, Status, Date, Posted by, Notes.</li>
						<li>Channel from the asset type first, else the URL host (medium.com, linkedin.com, quora.com, reddit.com, youtube.com/shorts, spotify / apple podcasts).</li>
						<li>On-site page: URL on the program domain, or asset type says page / blog / article. Goes to the cluster named on the row, else the single open cluster.</li>
						<li>A URL means posted (citation) / live (page) unless the status says draft / review. Verified → live.</li>
						<li>No cluster, unknown channel, URL already on the ledger, cluster full → review list, with the reason.</li>
					</ul>
				</Card>
			</div>
		</div>
	);
}
