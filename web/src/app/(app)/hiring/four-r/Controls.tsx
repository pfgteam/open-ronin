'use client';

// 4R backfill controls (0128): paste a Drive doc's text onto a queue row,
// review the parsed sections, import (template upsert or a person's 4R);
// AI-draft a 4R for someone without one; approve / edit / reject drafts.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import type { FourRDraftRow, FourRImportRow } from '@/lib/hiring/server';
import { templateSlugFromDocName, type FourRText } from '@/lib/hiring/shared';
import { applyImport, decideFourRDraft, fetchImportFromText, generateFourRDraft, skipImport } from '../actions';

const FIELDS: { key: keyof FourRText; label: string; rows: number }[] = [
	{ key: 'role_md', label: 'Role', rows: 3 },
	{ key: 'responsibilities_md', label: 'Responsibilities', rows: 6 },
	{ key: 'results_md', label: 'Results', rows: 4 },
	{ key: 'requirements_md', label: 'Requirements', rows: 5 },
];

export function ImportRow({ row, canAct, personName }: { row: FourRImportRow; canAct: boolean; personName: string | null }) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const parsed = (row.parsed as unknown as FourRText | null) ?? null;
	const docUrl = `https://docs.google.com/document/d/${row.drive_file_id}`;
	const onPaste = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await fetchImportFromText(fd);
			setMsg(r.ok ? { ok: true, text: r.complete ? 'Parsed: all four sections found. Review and import.' : 'Parsed, but a section is empty; fill it in before importing.' } : { ok: false, text: r.error });
			router.refresh();
		});
	const onImport = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await applyImport(fd);
			setMsg(r.ok ? { ok: true, text: `Imported → ${r.target}` } : { ok: false, text: r.error });
			router.refresh();
		});
	const onSkip = () =>
		start(async () => {
			await skipImport({ import_id: row.id, note: 'Skipped (duplicate / outdated)' });
			router.refresh();
		});
	return (
		<li className="px-4 py-2.5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-sm text-slate-900 dark:text-slate-100 truncate">
						<a href={docUrl} target="_blank" rel="noreferrer" className="hover:underline">
							{row.drive_name}
						</a>
					</div>
					<div className="text-2xs text-slate-500">
						{row.target_kind === 'person' ? `→ ${personName ?? 'person not found'}` : `→ template ${row.target_slug ?? templateSlugFromDocName(row.drive_name)}`}
						{row.note ? ` · ${row.note}` : ''}
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Badge color={row.status === 'imported' ? 'success' : row.status === 'fetched' ? 'primary' : row.status === 'skipped' ? 'default' : 'warning'}>{row.status}</Badge>
					{canAct && row.status !== 'imported' && (
						<Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
							{open ? 'Close' : row.status === 'fetched' ? 'Review' : 'Paste text'}
						</Button>
					)}
				</div>
			</div>
			{open && (
				<div className="mt-2 space-y-3">
					{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
					<form action={onPaste} className="space-y-2">
						<input type="hidden" name="import_id" value={row.id} />
						<Textarea name="raw_text" label="Document text (open the Doc → File → Download → Plain text, then paste)" rows={6} defaultValue={row.raw_text ?? ''} required minLength={20} className="font-mono text-xs" />
						<div className="flex gap-2">
							<Button type="submit" size="sm" variant="outline" loading={pending}>
								Parse
							</Button>
							<Button type="button" size="sm" variant="ghost" onClick={onSkip} loading={pending}>
								Skip this doc
							</Button>
						</div>
					</form>
					{parsed && (
						<form action={onImport} className="grid sm:grid-cols-3 gap-3">
							<input type="hidden" name="import_id" value={row.id} />
							<Input name="position_label" label="Position label" defaultValue={parsed.position_label || row.target_slug?.replace(/-/g, ' ') || ''} required maxLength={160} />
							<Input name="department" label="Department" defaultValue={parsed.department ?? ''} maxLength={80} />
							<Input name="reports_to" label="Reports to (position, not a name)" defaultValue={parsed.reports_to ?? ''} maxLength={120} />
							{row.target_kind === 'template' && (
								<>
									<Input name="target_slug" label="Template slug" defaultValue={row.target_slug ?? templateSlugFromDocName(row.drive_name)} pattern="[a-z0-9][a-z0-9-]*" required />
									<Input name="match_keywords" label="Match keywords (comma separated)" placeholder="media specialist, media" className="sm:col-span-2" />
								</>
							)}
							{FIELDS.map((f) => (
								<Textarea key={f.key} name={f.key} label={f.label} rows={f.rows} defaultValue={(parsed[f.key] as string) ?? ''} required className="sm:col-span-3 text-xs" />
							))}
							<div className="sm:col-span-3 flex items-center gap-2">
								<Button type="submit" size="sm" loading={pending}>
									Import {row.target_kind === 'template' ? 'as template' : `as ${personName ?? 'person'}'s 4R`}
								</Button>
								{row.target_kind === 'person' && <span className="text-2xs text-slate-500">Only when the person has no saved 4R; a saved edit always wins.</span>}
							</div>
						</form>
					)}
				</div>
			)}
		</li>
	);
}

export function DraftButton({ userId, canAct }: { userId: string; canAct: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [err, setErr] = useState<string | null>(null);
	if (!canAct) return null;
	return (
		<span className="inline-flex items-center gap-2">
			<Button
				size="sm"
				variant="outline"
				loading={pending}
				onClick={() =>
					start(async () => {
						setErr(null);
						const r = await generateFourRDraft({ user_id: userId });
						if (!r.ok) setErr(r.error);
						router.refresh();
					})
				}
			>
				AI draft
			</Button>
			{err && <span className="text-2xs text-red-600">{err}</span>}
		</span>
	);
}

export function DraftCard({ draft, personName, canAct }: { draft: FourRDraftRow; personName: string; canAct: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const d = draft.draft as unknown as FourRText;
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await decideFourRDraft(fd);
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setMsg({ ok: true, text: fd.get('decision') === 'approve' ? (r.written ? `Approved: ${personName}'s 4R is now on their profile.` : 'Approved; the person already had a saved 4R, nothing overwritten.') : fd.get('decision') === 'reject' ? 'Rejected.' : 'Saved.' });
			router.refresh();
		});
	return (
		<li className="px-4 py-3 space-y-2">
			<div className="flex items-center justify-between gap-3">
				<div>
					<span className="text-sm font-medium text-slate-900 dark:text-slate-100">{personName}</span>
					<span className="text-2xs text-slate-500">
						{' '}
						· {draft.source} draft{draft.template_slug ? ` from ${draft.template_slug}` : ''}
					</span>
				</div>
				<Badge color={draft.status === 'approved' ? 'success' : draft.status === 'rejected' ? 'danger' : 'warning'}>{draft.status}</Badge>
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{draft.status === 'pending' && canAct ? (
				<form action={submit} className="grid sm:grid-cols-3 gap-3">
					<input type="hidden" name="draft_id" value={draft.id} />
					<Input name="position_label" label="Position label" defaultValue={d.position_label ?? ''} required maxLength={160} />
					<Input name="department" label="Department" defaultValue={d.department ?? ''} maxLength={80} />
					<Input name="reports_to" label="Reports to" defaultValue={d.reports_to ?? ''} maxLength={120} />
					{FIELDS.map((f) => (
						<Textarea key={f.key} name={f.key} label={f.label} rows={f.rows} defaultValue={(d[f.key] as string) ?? ''} className="sm:col-span-3 text-xs" />
					))}
					<Input name="note" label="Note" maxLength={400} className="sm:col-span-3" />
					<div className="sm:col-span-3 flex gap-2">
						<Button type="submit" name="decision" value="approve" size="sm" loading={pending}>
							Approve → profile 4R
						</Button>
						<Button type="submit" name="decision" value="save" size="sm" variant="outline" loading={pending}>
							Save edits
						</Button>
						<Button type="submit" name="decision" value="reject" size="sm" variant="ghost" loading={pending}>
							Reject
						</Button>
					</div>
				</form>
			) : (
				<p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 whitespace-pre-wrap">{d.role_md}</p>
			)}
		</li>
	);
}
