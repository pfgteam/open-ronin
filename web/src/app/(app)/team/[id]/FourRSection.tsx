'use client';

// The 4R tab on /team/[id]: Role, Responsibilities, Results, Requirements as
// an editable form with a change log (migration 0093).
//
// Two modes on one card. READ renders the four sections as markdown. EDIT
// swaps each section for a textarea and keeps the person's text in state, so
// a failed save never loses it. The Edit / Save bubble is `fixed` top-right
// (the New Task button's treatment) so it stays put while a long 4R scrolls.
//
// A person with no 4R yet sees the best-matching position template as a
// draft, clearly labelled, and saving it is what creates their row.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clsx } from 'clsx';
import {
	Check, ChevronDown, ChevronUp, ExternalLink, History, Pencil, Sparkles, X,
} from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { inputClass } from '../_form';
import { FOUR_R_SECTIONS, sectionDelta, type FourRDraft, type FourRRevision } from '@/lib/people/fourR';
import { saveFourR } from './four-r-actions';

interface Props {
	subjectId: string;
	subjectName: string;
	/** The saved 4R, or null when this person has none yet. */
	saved: (FourRDraft & { revision: number; updated_at: string; updated_by_name: string | null; source: string; template_slug: string | null; source_url: string | null }) | null;
	/** Prefill for someone with no 4R: a template match or an empty draft. */
	draft: FourRDraft;
	/** Which template the draft came from, for the banner; null = nothing matched. */
	draftTemplate: { slug: string; position_label: string; source_url: string | null } | null;
	revisions: FourRRevision[];
	canEdit: boolean;
	isSelf: boolean;
}

const SECTION_LABELS: Record<string, string> = Object.fromEntries(
	FOUR_R_SECTIONS.map((s) => [s.key, s.label]),
);
SECTION_LABELS.position_label = 'Position';
SECTION_LABELS.department = 'Department';
SECTION_LABELS.reports_to = 'Reports to';

function fmtWhen(iso: string): string {
	return new Date(iso).toLocaleString('en-US', {
		month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
	});
}

export default function FourRSection({
	subjectId, subjectName, saved, draft, draftTemplate, revisions, canEdit, isSelf,
}: Props) {
	const router = useRouter();
	const initial: FourRDraft = saved ?? draft;
	const isDraftOnly = saved === null;

	const [editing, setEditing] = useState(false);
	const [form, setForm] = useState<FourRDraft>(initial);
	const [note, setNote] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);
	const [showLog, setShowLog] = useState(false);
	const [pending, startTransition] = useTransition();
	const firstFieldRef = useRef<HTMLInputElement | null>(null);

	// A save re-renders the page with fresh props; adopt them unless the
	// person is mid-edit.
	useEffect(() => {
		if (!editing) setForm(saved ?? draft);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [saved?.revision, saved?.updated_at]);

	useEffect(() => {
		if (editing) setTimeout(() => firstFieldRef.current?.focus(), 30);
	}, [editing]);

	// Esc cancels an edit, like the modal. Ctrl/Cmd+S saves.
	useEffect(() => {
		if (!editing) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') { e.preventDefault(); cancel(); }
			if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); submit(); }
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editing, form, note]);

	const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

	function set<K extends keyof FourRDraft>(key: K, value: FourRDraft[K]) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	function cancel() {
		setForm(saved ?? draft);
		setNote('');
		setError(null);
		setEditing(false);
	}

	function submit() {
		if (pending) return;
		if (!form.position_label.trim()) {
			setError('Give the position a name.');
			firstFieldRef.current?.focus();
			return;
		}
		setError(null);
		startTransition(async () => {
			const res = await saveFourR(subjectId, {
				...form,
				template_slug: isDraftOnly ? (draftTemplate?.slug ?? null) : (saved?.template_slug ?? null),
				note: note || null,
			});
			if (!res.ok) { setError(res.error); return; }
			setEditing(false);
			setNote('');
			setFlash(isDraftOnly ? 'Saved. This 4R is now on the profile.' : `Saved as revision ${res.revision}.`);
			setTimeout(() => setFlash(null), 4000);
			router.refresh();
		});
	}

	const sourceLink = saved?.source_url ?? draftTemplate?.source_url ?? null;

	return (
		<>
			{/* ── Edit / Save bubble ───────────────────────────────────────────
			    Fixed so it survives the scroll; sits under the top nav on the
			    right, mirroring where "New task" lives on Home. Only rendered
			    for people who can edit. */}
			{canEdit && (
				<div className="fixed right-4 sm:right-6 top-20 z-30 flex items-center gap-2">
					{editing ? (
						<>
							<Button variant="outline" size="sm" onClick={cancel} disabled={pending} className="shadow-panel bg-white dark:bg-slate-800 gap-1">
								<X className="w-3.5 h-3.5" /> Cancel
							</Button>
							<Button size="sm" onClick={submit} loading={pending} disabled={pending || (!dirty && !isDraftOnly)} className="shadow-panel gap-1.5 rounded-full px-4">
								{!pending && <Check className="w-3.5 h-3.5" />} Save
								<kbd className="hidden md:inline px-1 text-2xs rounded-md bg-white/20">⌘S</kbd>
							</Button>
						</>
					) : (
						<Button size="sm" onClick={() => setEditing(true)} className="shadow-panel gap-1.5 rounded-full px-4">
							<Pencil className="w-3.5 h-3.5" /> {isDraftOnly ? 'Edit draft' : 'Edit 4R'}
						</Button>
					)}
				</div>
			)}

			<Card padding="none">
				{/* Header: position line + provenance */}
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							4R · Role, Responsibilities, Results, Requirements
						</h2>
						{saved && <Badge color="default">rev {saved.revision}</Badge>}
						{isDraftOnly && <Badge color="warning">Draft, not saved</Badge>}
						{flash && (
							<span className="ml-auto text-xs text-green-700 dark:text-green-400 inline-flex items-center gap-1">
								<Check className="w-3 h-3" /> {flash}
							</span>
						)}
					</div>

					{editing ? (
						<div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
							<label className="flex flex-col gap-1">
								<span className="text-2xs font-medium uppercase tracking-wide text-slate-500">Position</span>
								<input
									ref={firstFieldRef}
									className={inputClass}
									value={form.position_label}
									onChange={(e) => set('position_label', e.target.value)}
									placeholder="e.g. Media Specialist"
								/>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-2xs font-medium uppercase tracking-wide text-slate-500">Department</span>
								<input className={inputClass} value={form.department ?? ''} onChange={(e) => set('department', e.target.value || null)} placeholder="e.g. Delivery" />
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-2xs font-medium uppercase tracking-wide text-slate-500">Reports to</span>
								<input className={inputClass} value={form.reports_to ?? ''} onChange={(e) => set('reports_to', e.target.value || null)} placeholder="e.g. PR Manager" />
							</label>
						</div>
					) : (
						<p className="mt-1 text-sm text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
							<span className="font-medium text-slate-800 dark:text-slate-200">{form.position_label || 'Position not set'}</span>
							{form.department && <><span className="text-slate-300 dark:text-slate-600">·</span><span>{form.department}</span></>}
							{form.reports_to && <><span className="text-slate-300 dark:text-slate-600">·</span><span>Reports to {form.reports_to}</span></>}
						</p>
					)}

					{/* Provenance line */}
					<p className="mt-1.5 text-2xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
						{saved ? (
							<>
								Last saved {fmtWhen(saved.updated_at)}
								{saved.updated_by_name ? ` by ${saved.updated_by_name}` : ''}
								{saved.source === 'template' && saved.template_slug && (
									<> · started from the <span className="font-medium">{saved.template_slug.replace(/-/g, ' ')}</span> template</>
								)}
							</>
						) : draftTemplate ? (
							<span className="inline-flex items-center gap-1">
								<Sparkles className="w-3 h-3 text-amber-500" />
								Suggested from the <span className="font-medium">{draftTemplate.position_label}</span> template.
								{canEdit ? ' Edit anything, then Save to make it ' + (isSelf ? 'yours.' : `${subjectName.split(' ')[0]}'s.`) : ' Not saved yet.'}
							</span>
						) : (
							<span>No 4R yet and no template matched this position{canEdit ? '. Write one below and save it.' : '.'}</span>
						)}
						{sourceLink && (
							<a href={sourceLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary-600 hover:underline">
								Drive source <ExternalLink className="w-2.5 h-2.5" />
							</a>
						)}
					</p>
				</div>

				{error && (
					<p className="mx-4 mt-3 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
						{error}
					</p>
				)}

				{/* The four sections */}
				<div className="divide-y divide-slate-200 dark:divide-slate-700">
					{FOUR_R_SECTIONS.map((s) => {
						const key = `${s.key}_md` as keyof FourRDraft;
						const value = (form[key] as string) ?? '';
						return (
							<section key={s.key} className="px-4 py-4" id={`four-r-${s.key}`}>
								<h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">{s.label}</h3>
								{editing ? (
									<>
										<textarea
											className={clsx(inputClass, 'font-mono text-xs leading-relaxed min-h-[7rem] resize-y')}
											rows={s.key === 'role' ? 5 : Math.min(18, Math.max(6, value.split('\n').length + 1))}
											value={value}
											onChange={(e) => set(key, e.target.value)}
											placeholder={s.hint}
										/>
										<p className="mt-1 text-2xs text-slate-500 dark:text-slate-400">{s.hint}</p>
									</>
								) : value.trim() ? (
									<article className="prose prose-sm prose-slate dark:prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
										<Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
									</article>
								) : (
									<p className="text-sm text-slate-400">Nothing here yet.</p>
								)}
							</section>
						);
					})}
				</div>

				{/* Change note, only while editing */}
				{editing && (
					<div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700">
						<label className="flex flex-col gap-1">
							<span className="text-2xs font-medium uppercase tracking-wide text-slate-500">What changed and why (optional, goes in the log)</span>
							<input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added Beacon reporting to Responsibilities after Q3 review" maxLength={500} />
						</label>
					</div>
				)}
			</Card>

			{/* ── Change log ─────────────────────────────────────────────────── */}
			<Card padding="none" className="mt-4">
				<button
					type="button"
					onClick={() => setShowLog((v) => !v)}
					className="w-full px-4 py-3 flex items-center gap-2 text-left"
					aria-expanded={showLog}
				>
					<History className="w-3.5 h-3.5 text-slate-400" />
					<span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Change log</span>
					<Badge color="default">{revisions.length}</Badge>
					<span className="ml-auto text-slate-400">{showLog ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
				</button>
				{showLog && (
					revisions.length === 0 ? (
						<p className="px-4 pb-4 text-sm text-slate-400">No saves yet. The first save starts the log.</p>
					) : (
						<ol className="border-t border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
							{revisions.map((r, i) => {
								const prev = revisions[i + 1];
								return (
									<li key={r.id} className="px-4 py-3 text-sm">
										<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
											<Badge color={i === 0 ? 'primary' : 'default'}>rev {r.revision}</Badge>
											<span className="text-slate-700 dark:text-slate-300">{r.changed_by_name ?? 'Unknown'}</span>
											<span className="text-2xs text-slate-500 dark:text-slate-400">{fmtWhen(r.changed_at)}</span>
											{r.changed_fields.length > 0 && r.revision > 1 && (
												<span className="text-2xs text-slate-500 dark:text-slate-400">
													· {r.changed_fields.map((f) => SECTION_LABELS[f] ?? f).join(', ')}
												</span>
											)}
											{r.revision === 1 && <span className="text-2xs text-slate-500 dark:text-slate-400">· created</span>}
										</div>
										{r.change_note && (
											<p className="mt-1 text-slate-700 dark:text-slate-300 italic">&ldquo;{r.change_note}&rdquo;</p>
										)}
										{prev && <RevisionDiff before={prev.snapshot} after={r.snapshot} fields={r.changed_fields} />}
									</li>
								);
							})}
						</ol>
					)
				)}
			</Card>
		</>
	);
}

/** Line-level added/removed per changed section, between two snapshots. */
function RevisionDiff({
	before, after, fields,
}: { before: Record<string, unknown>; after: Record<string, unknown>; fields: string[] }) {
	const rows = fields
		.map((f) => {
			const col = ['position_label', 'department', 'reports_to'].includes(f) ? f : `${f}_md`;
			const b = String(before[col] ?? '');
			const a = String(after[col] ?? '');
			if (!col.endsWith('_md')) {
				return b === a ? null : { label: SECTION_LABELS[f] ?? f, added: [a || '(blank)'], removed: [b || '(blank)'] };
			}
			const d = sectionDelta(b, a);
			return d.added.length + d.removed.length === 0 ? null : { label: SECTION_LABELS[f] ?? f, ...d };
		})
		.filter((x): x is { label: string; added: string[]; removed: string[] } => !!x);
	if (rows.length === 0) return null;
	return (
		<div className="mt-2 space-y-1.5">
			{rows.map((r) => (
				<div key={r.label} className="text-2xs">
					<p className="font-medium text-slate-600 dark:text-slate-400 mb-0.5">{r.label}</p>
					<ul className="space-y-0.5 font-mono">
						{r.removed.map((l, i) => (
							<li key={`r${i}`} className="text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded-sm">
								<span className="select-none mr-1">−</span>{l.replace(/^- /, '')}
							</li>
						))}
						{r.added.map((l, i) => (
							<li key={`a${i}`} className="text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded-sm">
								<span className="select-none mr-1">+</span>{l.replace(/^- /, '')}
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
