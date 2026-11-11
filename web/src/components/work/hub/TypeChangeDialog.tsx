'use client';

// Type change (rework 5.6, approved by Alex Nov 5): pick the new type; a
// rounded-lg Dialog lists, per item, the status it maps to (by category) and
// the fields the new type will hide; an illegal parent or attached children
// must be explicitly detached. Nothing is deleted, the change is logged in
// Activity, and the bulk bar uses the same dialog with the same checks per row.

import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Checkbox from '@/components/ui/Checkbox';
import Callout from '@/components/ui/Callout';
import { useToast } from '@/components/ui/Toast';
import { KIND_LABELS, statusesFor } from '@/lib/work/boards/groups';
import type { BoardContext, WorkRow } from '@/lib/work/boards/types';
import { TYPE_CHOICES, hiddenOnTypeChange } from '@/lib/work/fields';
import { changeItemKind, previewKindChange, type KindChangeCheck } from '@/app/(app)/the-work/b/actions';

export function TypeChangeDialog({ open, onClose, rows, ctx, onDone, initialKind }: {
	open: boolean;
	onClose: () => void;
	rows: WorkRow[];
	ctx: BoardContext;
	onDone: (changed: WorkRow[]) => void;
	initialKind?: string;
}) {
	const { toast } = useToast();
	const fromKinds = useMemo(() => [...new Set(rows.map((r) => r.kind))], [rows]);
	const [kind, setKind] = useState<string>(initialKind ?? '');
	const [checks, setChecks] = useState<KindChangeCheck[] | null>(null);
	const [statusFor, setStatusFor] = useState<Record<string, string>>({});
	const [detachParent, setDetachParent] = useState(false);
	const [detachChildren, setDetachChildren] = useState(false);
	const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => { if (open) { setKind(initialKind ?? ''); setChecks(null); setError(null); setDetachParent(false); setDetachChildren(false); } }, [open, initialKind]);
	useEffect(() => {
		if (!open || !kind || !rows.length) { setChecks(null); return; }
		let cancelled = false;
		void previewKindChange(rows.map((r) => r.id), kind).then((res) => {
			if (cancelled) return;
			if (!res.ok) { setError(res.error); setChecks([]); return; }
			setError(null);
			setChecks(res.data);
			setStatusFor(Object.fromEntries(res.data.map((c) => [c.id, c.status?.slug ?? ''])));
		});
		return () => { cancelled = true; };
	}, [open, kind, rows]);

	const parentProblems = checks?.filter((c) => c.parentProblem).length ?? 0;
	const childProblems = checks?.reduce((a, c) => a + c.children, 0) ?? 0;
	const hidden = useMemo(() => {
		if (!kind) return [] as { label: string; count: number }[];
		const counts = new Map<string, number>();
		for (const r of rows) for (const f of hiddenOnTypeChange(r, kind)) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);
		return [...counts.entries()].map(([label, count]) => ({ label, count }));
	}, [rows, kind]);
	const canConfirm = !!kind && !!checks && checks.length > 0 && (!parentProblems || detachParent) && (!childProblems || detachChildren) && !busy
		&& checks.every((c) => !!statusFor[c.id]);
	const single = rows.length === 1;
	const targetStatuses = kind ? statusesFor(ctx, kind) : [];

	const confirm = async () => {
		if (!checks) return;
		const changed: WorkRow[] = [];
		setBusy({ done: 0, total: checks.length });
		for (const [i, c] of checks.entries()) {
			const res = await changeItemKind(c.id, kind, { status: statusFor[c.id], detachParent: !!c.parentProblem && detachParent, detachChildren: c.children > 0 && detachChildren });
			if (!res.ok) { setBusy(null); setError(`${c.name}: ${res.error}`); if (changed.length) onDone(changed); return; }
			changed.push(res.data);
			setBusy({ done: i + 1, total: checks.length });
		}
		setBusy(null);
		toast({ message: `${changed.length === 1 ? changed[0].name : `${changed.length} items`} → ${KIND_LABELS[kind] ?? kind}`, variant: 'success' });
		onDone(changed);
		onClose();
	};

	return (
		<Dialog open={open} onClose={onClose} title={single ? `Change the type of “${rows[0]?.name ?? ''}”` : `Change the type of ${rows.length} items`}
			subtitle="Nothing is deleted. Fields the new type doesn't show stay saved and come back if you change the type back."
			footer={(
				<>
					<Button variant="outline" onClick={onClose} disabled={!!busy}>Cancel</Button>
					<Button onClick={() => void confirm()} disabled={!canConfirm} loading={!!busy}>
						{busy ? `Changing ${busy.done} of ${busy.total}` : `Change to ${kind ? KIND_LABELS[kind] ?? kind : '…'}`}
					</Button>
				</>
			)}>
			<div className="space-y-4">
				<div className="flex items-end gap-3">
					<div className="text-sm">
						<div className="text-2xs font-medium uppercase tracking-wide text-slate-500">From</div>
						<div className="mt-1 font-medium">{fromKinds.map((k) => KIND_LABELS[k] ?? k).join(', ')}</div>
					</div>
					<ArrowRight className="mb-1 h-4 w-4 text-slate-400" aria-hidden="true" />
					<div className="flex-1">
						<Select label="To" value={kind} onChange={(e) => setKind(e.target.value)}>
							<option value="">Pick a type…</option>
							{TYPE_CHOICES.filter((k) => !(fromKinds.length === 1 && fromKinds[0] === k)).map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
						</Select>
					</div>
				</div>

				{error && <Callout tone="error">{error}</Callout>}
				{kind && !checks && !error && <p className="text-sm text-slate-500">Checking…</p>}

				{kind && checks && checks.length > 0 && (
					<>
						<section aria-label="Status mapping">
							<h3 className="text-2xs font-semibold uppercase tracking-wide text-slate-500">Status</h3>
							<ul className="mt-1 max-h-52 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
								{checks.map((c) => (
									<li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-13">
										<span className="min-w-0 flex-1 truncate">{c.name}</span>
										<span className="shrink-0 text-slate-500">{statusesFor(ctx, c.fromKind).find((s) => s.slug === rows.find((r) => r.id === c.id)?.status)?.label ?? ''}</span>
										<ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
										<Select aria-label={`New status for ${c.name}`} size="sm" value={statusFor[c.id] ?? ''} onChange={(e) => setStatusFor((m) => ({ ...m, [c.id]: e.target.value }))} className="w-36">
											{targetStatuses.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
										</Select>
									</li>
								))}
							</ul>
						</section>

						<section aria-label="Hidden fields">
							<h3 className="text-2xs font-semibold uppercase tracking-wide text-slate-500">Fields that will be hidden</h3>
							{hidden.length ? (
								<ul className="mt-1 flex flex-wrap gap-1.5">
									{hidden.map((h) => <li key={h.label} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">{h.label}{rows.length > 1 ? ` (${h.count})` : ''}</li>)}
								</ul>
							) : <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">None: every filled-in field is shown on the new type.</p>}
						</section>

						{(parentProblems > 0 || childProblems > 0) && (
							<section aria-label="Hierarchy" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
								<p className="flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" aria-hidden="true" />The hierarchy doesn&apos;t allow this as it stands</p>
								{checks.filter((c) => c.parentProblem).slice(0, 5).map((c) => <p key={c.id} className="text-xs text-amber-900 dark:text-amber-200">{c.parentProblem}</p>)}
								{parentProblems > 0 && (
									<label className="flex items-center gap-2 text-sm"><Checkbox checked={detachParent} onChange={(e) => setDetachParent(e.target.checked)} />Detach {parentProblems === 1 ? 'it' : `${parentProblems} items`} from {parentProblems === 1 ? 'its parent' : 'their parents'}</label>
								)}
								{childProblems > 0 && (
									<label className={clsx('flex items-center gap-2 text-sm')}><Checkbox checked={detachChildren} onChange={(e) => setDetachChildren(e.target.checked)} />Detach the {childProblems} item{childProblems === 1 ? '' : 's'} that sit under {single ? 'it' : 'them'} (they stay, at the top level)</label>
								)}
							</section>
						)}
						<p className="text-2xs text-slate-500">The change shows in each item&apos;s Activity with the old and new type.</p>
					</>
				)}
			</div>
		</Dialog>
	);
}
