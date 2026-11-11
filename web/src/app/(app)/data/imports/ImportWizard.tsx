'use client';

// The five step wizard. Each step is a Card; the step rail above shows where
// the batch is. Every action goes through ./actions and, when it succeeds,
// the URL moves to the next step so a refresh lands in the same place.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, Check, ArrowRight } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Callout from '@/components/ui/Callout';
import Badge from '@/components/ui/Badge';
import type { FieldSchema } from '@/lib/data/adapter';
import { coerce, TYPE_LABELS } from '@/lib/imports/coerce';
import { missingRequired } from '@/lib/imports/match';
import { TARGETS, AIRTABLE_TARGET, airtableColumns, targetInfo } from '@/lib/imports/targets';
import { CHUNK_SIZE, WIZARD_STEPS, stepIndex, type BatchRow, type ColumnSpec, type Mapping, type TargetKey, type WizardStep } from '@/lib/imports/types';
import {
	commitChunk,
	createBatchFromAirtable,
	createBatchFromUpload,
	discardBatch,
	dryRunChunk,
	listAirtableTables,
	pullAirtableChunk,
	rejectListCsv,
	rollbackBatch,
	saveMapping,
	setSheet,
	setTarget,
} from './actions';
import type { RowPreview } from './page';
import { StatusText } from './HistoryTable';

const STEP_LABELS: Record<WizardStep, string> = {
	upload: 'Upload',
	target: 'Target',
	map: 'Map',
	'dry-run': 'Dry run',
	commit: 'Commit',
};

interface Props {
	batch: BatchRow | null;
	step: WizardStep;
	columns: ColumnSpec[];
	rows: RowPreview[];
	bases: { id: string; name: string }[];
}

export default function ImportWizard({ batch, step, columns, rows, bases }: Props) {
	const router = useRouter();

	function go(batchId: string, next: WizardStep) {
		router.push(`/data/imports?batch=${batchId}&step=${next}`);
		router.refresh();
	}

	return (
		<div className="space-y-4">
			<StepRail current={step} batch={batch} onPick={(s) => batch && go(batch.id, s)} />
			{step === 'upload' && batch && isPullBatch(batch) && <PullStep batch={batch} onDone={() => go(batch.id, 'target')} onDiscard={() => router.push('/data/imports')} />}
			{step === 'upload' && !(batch && isPullBatch(batch)) && <UploadStep onDone={(id) => go(id, 'target')} onPull={(id) => go(id, 'upload')} />}
			{step === 'target' && batch && <TargetStep batch={batch} bases={bases} onDone={() => go(batch.id, 'map')} onDiscard={() => router.push('/data/imports')} />}
			{step === 'map' && batch && <MapStep batch={batch} columns={columns} onDone={() => go(batch.id, 'dry-run')} />}
			{step === 'dry-run' && batch && <DryRunStep batch={batch} columns={columns} rows={rows} onDone={() => go(batch.id, 'commit')} />}
			{step === 'commit' && batch && <CommitStep batch={batch} columns={columns} rows={rows} />}
		</div>
	);
}

// ---------------------------------------------------------------- rail

function StepRail({ current, batch, onPick }: { current: WizardStep; batch: BatchRow | null; onPick: (s: WizardStep) => void }) {
	const reached = batch ? stepIndex(current) : 0;
	const locked = batch ? ['committing', 'committed', 'rolled_back'].includes(batch.status) : false;
	return (
		<ol className="flex flex-wrap items-center gap-2 text-xs">
			{WIZARD_STEPS.map((s, i) => {
				const active = s === current;
				const done = i < reached;
				const clickable = !!batch && !locked && i <= reached && !active && i > 0;
				return (
					<li key={s} className="flex items-center gap-2">
						<button
							type="button"
							disabled={!clickable}
							onClick={() => clickable && onPick(s)}
							className={[
								'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
								active
									? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
									: done
										? 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45'
										: 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500',
								!clickable && 'cursor-default',
							]
								.filter(Boolean)
								.join(' ')}
						>
							<span className="tabular-nums">{i + 1}</span>
							{STEP_LABELS[s]}
							{done && <Check className="w-3 h-3" />}
						</button>
						{i < WIZARD_STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />}
					</li>
				);
			})}
			{batch && (
				<li className="ml-auto flex items-center gap-2 text-slate-500 dark:text-slate-400">
					<span className="truncate max-w-xs">{batch.file_name}</span>
					<span className="tabular-nums">{batch.row_count} rows</span>
					<StatusText status={batch.status} />
				</li>
			)}
		</ol>
	);
}

// ---------------------------------------------------------------- step 1

function isPullBatch(batch: BatchRow): boolean {
	const p = batch.options.pull as { source?: unknown } | undefined;
	return !!p?.source;
}

function UploadStep({ onDone, onPull }: { onDone: (id: string) => void; onPull: (id: string) => void }) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	function submit() {
		const file = inputRef.current?.files?.[0];
		if (!file) {
			setError('Pick a file first.');
			return;
		}
		setError(null);
		const fd = new FormData();
		fd.set('file', file);
		startTransition(async () => {
			const res = await createBatchFromUpload(fd);
			if (!res.ok) setError(res.error);
			else onDone(res.id);
		});
	}

	function pull() {
		setError(null);
		startTransition(async () => {
			const res = await createBatchFromAirtable({ source: 'media_opportunities' });
			if (!res.ok) setError(res.error);
			else onPull(res.id);
		});
	}

	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. Upload a file</h2>
			<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
				CSV or XLSX, up to 25 MB and 50,000 rows. The first row must be the header row.
			</p>
			<div className="mt-4 flex flex-wrap items-center gap-3">
				<label className="inline-flex items-center gap-2 rounded-md border border-dashed border-slate-300 dark:border-slate-600 px-4 py-3 text-sm text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors">
					<Upload className="w-4 h-4" />
					{fileName ?? 'Choose a CSV or XLSX'}
					<input
						ref={inputRef}
						type="file"
						accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						className="sr-only"
						onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
					/>
				</label>
				<Button onClick={submit} loading={pending} disabled={!fileName}>
					Upload
				</Button>
			</div>
			<div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
				<p className="text-sm text-slate-500 dark:text-slate-400">
					Or pull a table straight from Airtable with the server&apos;s key. Every row comes across with its record id, so the import is idempotent and the client link resolves by name.
				</p>
				<Button variant="outline" className="mt-3" onClick={pull} loading={pending}>
					Pull Media Opportunities from Client Media
				</Button>
			</div>
			{error && (
				<Callout tone="error" className="mt-3">
					{error}
				</Callout>
			)}
		</Card>
	);
}

// ---------------------------------------------------------------- step 1b

function PullStep({ batch, onDone, onDiscard }: { batch: BatchRow; onDone: () => void; onDiscard: () => void }) {
	const loop = useChunkLoop(() => pullAirtableChunk(batch.id));
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const pull = batch.options.pull as { source?: { tableName?: string }; state?: { pulled?: number }; done?: boolean } | undefined;
	const pulled = loop.progress?.progress ?? pull?.state?.pulled ?? 0;

	function discard() {
		startTransition(async () => {
			const res = await discardBatch(batch.id);
			if (!res.ok) setError(res.error);
			else onDiscard();
		});
	}

	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. Pull from Airtable</h2>
			<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
				Reads {pull?.source?.tableName ?? 'the table'} 100 rows a page at Airtable&apos;s rate limit and stages them in the imports bucket. A refresh resumes where it stopped. Airtable is read only here; nothing is written back.
			</p>
			<div className="mt-4 space-y-4">
				{(loop.running || pulled > 0) && (
					<p className="text-sm tabular-nums text-slate-600 dark:text-slate-300">{pulled.toLocaleString()} rows pulled{loop.running ? '…' : ''}</p>
				)}
				{loop.error && <Callout tone="error">{loop.error}</Callout>}
				{batch.error && !loop.error && <Callout tone="error">{batch.error}</Callout>}
				{error && <Callout tone="error">{error}</Callout>}
				<div className="flex flex-wrap items-center gap-2">
					{batch.status === 'draft' && (
						<Button onClick={loop.start} loading={loop.running}>
							{pulled > 0 ? 'Resume pull' : 'Start pull'}
						</Button>
					)}
					{batch.status !== 'draft' && <Button onClick={onDone}>Continue to target</Button>}
					<Button variant="ghost" onClick={discard} disabled={pending || loop.running}>
						Discard
					</Button>
				</div>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------- step 2

function TargetStep({ batch, bases, onDone, onDiscard }: { batch: BatchRow; bases: { id: string; name: string }[]; onDone: () => void; onDiscard: () => void }) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [target, setTargetKey] = useState<TargetKey>(batch.target ?? 'contacts');
	const [baseId, setBaseId] = useState<string>(batch.target_ref?.split('/')[0] ?? '');
	const [tables, setTables] = useState<{ id: string; name: string; fields: FieldSchema[] }[]>([]);
	const [tableName, setTableName] = useState<string>(batch.target_ref?.split('/').slice(1).join('/') ?? '');
	const [keyField, setKeyField] = useState<string>(typeof batch.options.keyField === 'string' ? batch.options.keyField : '');
	const [loadingTables, setLoadingTables] = useState(false);
	const sheets = Array.isArray(batch.options.sheets) ? (batch.options.sheets as string[]) : [];
	const sheet = typeof batch.options.sheet === 'string' ? batch.options.sheet : '';

	useEffect(() => {
		if (target !== 'airtable' || !baseId) return;
		let cancelled = false;
		setLoadingTables(true);
		listAirtableTables(baseId).then((res) => {
			if (cancelled) return;
			setLoadingTables(false);
			if (res.ok) setTables(res.tables);
			else setError(res.error);
		});
		return () => {
			cancelled = true;
		};
	}, [target, baseId]);

	const keyOptions = useMemo(() => {
		const t = tables.find((x) => x.name === tableName || x.id === tableName);
		return t ? airtableColumns(t.fields) : [];
	}, [tables, tableName]);

	function submit() {
		setError(null);
		startTransition(async () => {
			const res = await setTarget({
				batchId: batch.id,
				target,
				targetRef: target === 'airtable' ? `${baseId}/${tableName}` : undefined,
				keyField: target === 'airtable' ? keyField : undefined,
			});
			if (!res.ok) setError(res.error);
			else onDone();
		});
	}

	function changeSheet(next: string) {
		setError(null);
		startTransition(async () => {
			const res = await setSheet(batch.id, next);
			if (!res.ok) setError(res.error);
		});
	}

	function discard() {
		startTransition(async () => {
			const res = await discardBatch(batch.id);
			if (!res.ok) setError(res.error);
			else onDiscard();
		});
	}

	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">2. Pick a target</h2>
			<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
				{batch.headers.length} columns found: <span className="text-slate-700 dark:text-slate-300">{batch.headers.join(', ')}</span>
			</p>

			{sheets.length > 1 && (
				<div className="mt-4 max-w-xs">
					<Select label="Sheet" size="sm" value={sheet} onChange={(e) => changeSheet(e.target.value)} disabled={pending}>
						{sheets.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</Select>
				</div>
			)}

			<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{[...Object.values(TARGETS), AIRTABLE_TARGET].map((t) => {
					const active = target === t.key;
					return (
						<button
							key={t.key}
							type="button"
							onClick={() => setTargetKey(t.key)}
							className={[
								'text-left rounded-lg border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
								active
									? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50'
									: 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/45',
							].join(' ')}
						>
							<div className="text-sm font-medium text-slate-900 dark:text-slate-100">{t.label}</div>
							<div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.description}</div>
							<div className="text-2xs text-slate-400 dark:text-slate-500 mt-1">Matches on: {t.naturalKeyLabel}</div>
						</button>
					);
				})}
			</div>

			{target === 'airtable' && (
				<div className="mt-4 grid gap-3 sm:grid-cols-3">
					<Select label="Base" size="sm" value={baseId} onChange={(e) => { setBaseId(e.target.value); setTableName(''); setKeyField(''); }}>
						<option value="">Pick a base</option>
						{bases.map((b) => (
							<option key={b.id} value={b.id}>
								{b.name}
							</option>
						))}
					</Select>
					<Select label="Table" size="sm" value={tableName} onChange={(e) => { setTableName(e.target.value); setKeyField(''); }} disabled={!baseId || loadingTables}>
						<option value="">{loadingTables ? 'Loading' : 'Pick a table'}</option>
						{tables.map((t) => (
							<option key={t.id} value={t.name}>
								{t.name}
							</option>
						))}
					</Select>
					<Select label="Key field" size="sm" value={keyField} onChange={(e) => setKeyField(e.target.value)} disabled={!tableName}>
						<option value="">Pick the field that identifies a record</option>
						{keyOptions.map((c) => (
							<option key={c.key} value={c.key}>
								{c.label}
							</option>
						))}
					</Select>
				</div>
			)}

			{error && (
				<Callout tone="error" className="mt-3">
					{error}
				</Callout>
			)}

			<div className="mt-4 flex items-center gap-2">
				<Button onClick={submit} loading={pending} disabled={target === 'airtable' && (!baseId || !tableName || !keyField)}>
					Continue to mapping
				</Button>
				<Button variant="ghost" onClick={discard} disabled={pending}>
					Discard
				</Button>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------- step 3

function MapStep({ batch, columns, onDone }: { batch: BatchRow; columns: ColumnSpec[]; onDone: () => void }) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [mapping, setMapping] = useState<Mapping>(batch.mapping);
	const missing = missingRequired(mapping, columns);
	const headerIndex = new Map(batch.headers.map((h, i) => [h, i]));
	const sample = batch.sample ?? [];

	function submit() {
		setError(null);
		startTransition(async () => {
			const res = await saveMapping({ batchId: batch.id, mapping });
			if (!res.ok) setError(res.error);
			else onDone();
		});
	}

	const usedHeaders = new Set(Object.values(mapping));
	const unmapped = batch.headers.filter((h) => !usedHeaders.has(h));

	return (
		<Card padding="none">
			<div className="p-4">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">3. Map columns</h2>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
					Target: {targetInfo(batch.target!).label}. Matched by name where possible; change any row. The preview shows the first rows after type coercion.
				</p>
			</div>
			<div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
				<table className="w-full text-xs">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Target column</th>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Type</th>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">File column</th>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Preview</th>
						</tr>
					</thead>
					<tbody>
						{columns.map((c) => {
							const header = mapping[c.key];
							const i = header ? headerIndex.get(header) : undefined;
							const previews = sample.slice(0, 3).map((r) => {
								const raw = i == null ? '' : r[i] ?? '';
								const res = coerce(raw, c.type, c);
								return res.ok ? { ok: true, text: res.value == null ? '' : Array.isArray(res.value) ? res.value.join(', ') : String(res.value) } : { ok: false, text: res.error };
							});
							return (
								<tr key={c.key} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
									<td className="px-3 py-2 whitespace-nowrap">
										<span className="text-slate-900 dark:text-slate-100">{c.label}</span>
										{c.required && (
											<Badge color={header ? 'default' : 'warning'} className="ml-2">
												required
											</Badge>
										)}
										{c.naturalKey && (
											<Badge color="primary" className="ml-2">
												key
											</Badge>
										)}
										{c.help && <div className="text-2xs text-slate-400 dark:text-slate-500 mt-0.5 max-w-xs whitespace-normal">{c.help}</div>}
									</td>
									<td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
										{TYPE_LABELS[c.type]}
										{c.values && c.values.length > 0 && <span className="text-slate-400"> ({c.values.slice(0, 4).join(', ')}{c.values.length > 4 ? ', ...' : ''})</span>}
									</td>
									<td className="px-3 py-2">
										<Select
											size="sm"
											value={header ?? ''}
											onChange={(e) => {
												const next = { ...mapping };
												if (e.target.value) next[c.key] = e.target.value;
												else delete next[c.key];
												setMapping(next);
											}}
										>
											<option value="">Not imported</option>
											{batch.headers.map((h) => (
												<option key={h} value={h}>
													{h}
												</option>
											))}
										</Select>
									</td>
									<td className="px-3 py-2">
										{header && (
											<div className="space-y-0.5">
												{previews.map((p, idx) => (
													<div key={idx} className={p.ok ? 'text-slate-600 dark:text-slate-300 truncate max-w-xs' : 'text-red-600 dark:text-red-400 truncate max-w-xs'}>
														{p.text || <span className="text-slate-300 dark:text-slate-600">empty</span>}
													</div>
												))}
											</div>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
				{unmapped.length > 0 && (
					<p className="text-xs text-slate-500 dark:text-slate-400">
						Not imported: {unmapped.join(', ')}
					</p>
				)}
				{missing.length > 0 && <Callout tone="warning">Map the required columns: {missing.map((c) => c.label).join(', ')}.</Callout>}
				{error && <Callout tone="error">{error}</Callout>}
				<Button onClick={submit} loading={pending} disabled={missing.length > 0}>
					Continue to dry run
				</Button>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------- step 4

function useChunkLoop(run: () => Promise<{ ok: true; progress: number; total: number; done: boolean } | { ok: false; error: string }>) {
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState<{ progress: number; total: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();

	async function start() {
		setRunning(true);
		setError(null);
		try {
			for (;;) {
				const res = await run();
				if (!res.ok) {
					setError(res.error);
					break;
				}
				setProgress({ progress: res.progress, total: res.total });
				if (res.done) break;
			}
		} finally {
			setRunning(false);
			router.refresh();
		}
	}
	return { running, progress, error, start };
}

function ProgressBar({ value, total }: { value: number; total: number }) {
	const pct = total > 0 ? Math.round((value / total) * 100) : 0;
	return (
		<div className="flex items-center gap-3">
			<div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden">
				<div className="h-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
			</div>
			<span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
				{value} / {total}
			</span>
		</div>
	);
}

function Counts({ batch }: { batch: BatchRow }) {
	return (
		<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
			{[
				['Rows', batch.row_count],
				['Inserts', batch.insert_count],
				['Updates', batch.update_count],
				['Rejects', batch.reject_count],
			].map(([label, value]) => (
				<div key={String(label)}>
					<div className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</div>
					<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
				</div>
			))}
		</div>
	);
}

function RowsTable({ rows, columns }: { rows: RowPreview[]; columns: ColumnSpec[] }) {
	const shown = columns.slice(0, 5);
	if (rows.length === 0) return null;
	return (
		<div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
			<table className="w-full text-xs">
				<thead className="bg-slate-50/80 dark:bg-slate-900/30">
					<tr>
						<th className="text-right px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Row</th>
						<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Action</th>
						{shown.map((c) => (
							<th key={c.key} className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">
								{c.label}
							</th>
						))}
						<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Reason</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.row_number} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
							<td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{r.row_number}</td>
							<td className="px-3 py-1.5">
								<span
									className={[
										'inline-flex items-center gap-1.5 text-2xs',
										r.action === 'reject' ? 'text-red-600 dark:text-red-400' : r.action === 'skip' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300',
									].join(' ')}
								>
									<span
										className={[
											'w-1.5 h-1.5 rounded-full',
											r.action === 'insert' ? 'bg-green-500' : r.action === 'update' ? 'bg-primary-500' : r.action === 'reject' ? 'bg-red-500' : 'bg-amber-500',
										].join(' ')}
									/>
									{r.action}
								</span>
							</td>
							{shown.map((c) => {
								const v = r.after?.[c.key];
								return (
									<td key={c.key} className="px-3 py-1.5 text-slate-600 dark:text-slate-300 truncate max-w-[12rem]">
										{v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)}
									</td>
								);
							})}
							<td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{r.reason ?? ''}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function downloadText(fileName: string, text: string) {
	const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	URL.revokeObjectURL(url);
}

function DryRunStep({ batch, columns, rows, onDone }: { batch: BatchRow; columns: ColumnSpec[]; rows: RowPreview[]; onDone: () => void }) {
	const loop = useChunkLoop(() => dryRunChunk(batch.id));
	const [downloading, setDownloading] = useState(false);
	const complete = batch.status === 'dry_run' && batch.progress >= batch.row_count;

	async function downloadRejects() {
		setDownloading(true);
		const res = await rejectListCsv(batch.id);
		setDownloading(false);
		if (res.ok) downloadText(res.fileName, res.csv);
	}

	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">4. Dry run</h2>
			<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
				Every row is validated and matched against {targetInfo(batch.target!).label} in chunks of {CHUNK_SIZE}. Nothing is written.
			</p>

			<div className="mt-4 space-y-4">
				{(loop.running || loop.progress) && <ProgressBar value={loop.progress?.progress ?? 0} total={loop.progress?.total ?? batch.row_count} />}
				{loop.error && <Callout tone="error">{loop.error}</Callout>}
				{batch.error && !loop.error && <Callout tone="error">{batch.error}</Callout>}

				{complete && <Counts batch={batch} />}
				{complete && rows.length > 0 && (
					<>
						<RowsTable rows={rows} columns={columns} />
						{batch.row_count > rows.length && <p className="text-2xs text-slate-600 dark:text-slate-400">Showing the first {rows.length} rows.</p>}
					</>
				)}

				<div className="flex flex-wrap items-center gap-2">
					{!complete && (
						<Button onClick={loop.start} loading={loop.running}>
							{batch.status === 'dry_run' && batch.progress > 0 ? 'Resume dry run' : 'Run dry run'}
						</Button>
					)}
					{complete && (
						<>
							<Button onClick={onDone} disabled={batch.insert_count + batch.update_count === 0}>
								Continue to commit
							</Button>
							<Button variant="outline" onClick={loop.start} loading={loop.running}>
								Run again
							</Button>
							{batch.reject_count > 0 && (
								<Button variant="ghost" onClick={downloadRejects} loading={downloading}>
									<Download className="w-4 h-4" />
									Download rejects
								</Button>
							)}
						</>
					)}
				</div>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------- step 5

function CommitStep({ batch, columns, rows }: { batch: BatchRow; columns: ColumnSpec[]; rows: RowPreview[] }) {
	const loop = useChunkLoop(() => commitChunk(batch.id));
	const router = useRouter();
	const [rollingBack, startRollback] = useTransition();
	const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string; drifts?: { rowNumber: number; keys: string[] }[] } | null>(null);
	const committed = batch.status === 'committed';
	const rolledBack = batch.status === 'rolled_back';
	const failed = batch.status === 'failed';
	const canStart = batch.status === 'dry_run' || batch.status === 'committing';

	function rollback() {
		if (!window.confirm('Roll this batch back? Inserted rows are deleted and updated rows are restored.')) return;
		setNotice(null);
		startRollback(async () => {
			const res = await rollbackBatch(batch.id);
			if (res.ok) {
				setNotice({ tone: 'success', text: `Rolled back ${res.reverted} row${res.reverted === 1 ? '' : 's'}.` });
				router.refresh();
			} else setNotice({ tone: 'error', text: res.error, drifts: 'drifts' in res ? res.drifts : undefined });
		});
	}

	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">5. Commit</h2>
			<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
				Writes {batch.insert_count} insert{batch.insert_count === 1 ? '' : 's'} and {batch.update_count} update{batch.update_count === 1 ? '' : 's'} to {targetInfo(batch.target!).label} in chunks of {CHUNK_SIZE}. Rows are re matched right before each write.
			</p>

			<div className="mt-4 space-y-4">
				{(loop.running || loop.progress) && <ProgressBar value={loop.progress?.progress ?? 0} total={loop.progress?.total ?? batch.row_count} />}
				{loop.error && <Callout tone="error">{loop.error}</Callout>}
				{failed && !loop.error && <Callout tone="error">{batch.error ?? 'The commit failed.'} Rows written before the failure are recorded and can be rolled back.</Callout>}
				{committed && <Callout tone="success">Committed {batch.committed_at ? new Date(batch.committed_at).toLocaleString() : ''}.</Callout>}
				{rolledBack && <Callout tone="warning">Rolled back {batch.rolled_back_at ? new Date(batch.rolled_back_at).toLocaleString() : ''}.</Callout>}
				{notice && (
					<Callout tone={notice.tone}>
						{notice.text}
						{notice.drifts && notice.drifts.length > 0 && (
							<ul className="mt-1 text-xs list-disc pl-4">
								{notice.drifts.map((d) => (
									<li key={d.rowNumber}>
										Row {d.rowNumber}: {d.keys.join(', ')}
									</li>
								))}
							</ul>
						)}
					</Callout>
				)}

				{(committed || rolledBack || failed) && <Counts batch={batch} />}
				{(committed || rolledBack || failed) && rows.length > 0 && (
					<>
						<RowsTable rows={rows} columns={columns} />
						{batch.row_count > rows.length && <p className="text-2xs text-slate-600 dark:text-slate-400">Showing the first {rows.length} rows.</p>}
					</>
				)}

				<div className="flex flex-wrap items-center gap-2">
					{canStart && (
						<Button onClick={loop.start} loading={loop.running}>
							{batch.status === 'committing' ? 'Resume commit' : 'Commit'}
						</Button>
					)}
					{(committed || failed) && (
						<Button variant="outline" onClick={rollback} loading={rollingBack}>
							Roll back
						</Button>
					)}
				</div>
			</div>
		</Card>
	);
}
