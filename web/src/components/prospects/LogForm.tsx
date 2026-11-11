'use client';

// The one log form (spec 2026-10-20 §4.3): Self → Sales shows it in a popover
// (LogPanel), the deal page keeps it open next to the timeline. Pick a kind,
// an outcome (required for calls), a note and the next step, then Save. The
// deal page passes `extended` for a subject and an inbound flag. The next
// action is only written when the rep changed it, and "No next step" clears it.

import { useRef, useState, useTransition } from 'react';
import { clsx } from 'clsx';
import Button from '@/components/ui/Button';
import FilterChip from '@/components/ui/FilterChip';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { logActivity } from '@/app/(app)/prospects/actions';
import { SNOOZE_PRESETS, presetAt, type SnoozePreset } from '@/lib/home/sales';
import { buildLogFields, patchAfterLog, type LogKind, type LogState } from '@/lib/revenue/logPayload';
import type { DispositionRow } from '@/lib/revenue/shared';

const KIND_LABELS: Record<LogKind, string> = { call: 'Call', sms: 'SMS', email: 'Email', dm: 'DM', meeting: 'Meeting', note: 'Note' };

export type LogPatch = { answered: true; next_action?: string | null; next_action_at?: string | null };

export function WhenPicker({ value, onChange, disabled }: { value: Date | null; onChange: (d: Date | null) => void; disabled?: boolean }) {
	const [preset, setPreset] = useState<SnoozePreset | 'pick' | null>(null);
	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap gap-1.5">
				{SNOOZE_PRESETS.map((p) => (
					<FilterChip key={p.key} type="button" disabled={disabled} active={preset === p.key} aria-pressed={preset === p.key} onClick={() => { setPreset(p.key); onChange(presetAt(p.key, new Date())); }}>
						{p.label}
					</FilterChip>
				))}
				<FilterChip type="button" disabled={disabled} active={preset === 'pick'} aria-pressed={preset === 'pick'} onClick={() => setPreset('pick')}>Pick…</FilterChip>
			</div>
			{preset === 'pick' && !disabled && (
				<Input type="datetime-local" aria-label="Next action time" onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)} />
			)}
			{value && !disabled && <p className="text-2xs text-slate-500">{value.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
		</div>
	);
}

export default function LogForm({ dealId, personId, originalNext, originalNextAt = null, dispositions, kinds, extended, onDone, onCancel }: {
	dealId: string;
	personId: string | null;
	originalNext: string | null;
	originalNextAt?: string | null;
	dispositions: DispositionRow[];
	kinds: readonly LogKind[];
	extended: boolean;
	onDone: (patch: LogPatch) => void;
	onCancel?: () => void;
}) {
	const fresh = (): LogState => ({ kind: kinds[0] ?? 'call', outcome: null, note: '', subject: '', inbound: false, positive: false, next: originalNext ?? '', when: null, clearNext: false });
	const [s, setS] = useState<LogState>(fresh);
	// Remounting the picker clears its preset after a save.
	const [round, setRound] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const noteRef = useRef<HTMLTextAreaElement>(null);
	const set = (patch: Partial<LogState>) => setS((cur) => ({ ...cur, ...patch }));
	// Dispositions are typed call / dm / email / meeting; an SMS reads the DM list.
	const outcomes = s.kind === 'note' ? [] : dispositions.filter((d) => d.is_active !== false && d.kind === (s.kind === 'sms' ? 'dm' : s.kind));

	const save = () =>
		start(async () => {
			setError(null);
			if (s.kind === 'call' && !s.outcome) {
				setError('Pick an outcome for the call.');
				return;
			}
			const fd = new FormData();
			for (const [k, v] of Object.entries(buildLogFields(s, { dealId, personId, originalNext, extended }))) fd.set(k, v);
			const r = await logActivity(fd);
			if (!r.ok) {
				setError(r.error);
				return;
			}
			const patch = patchAfterLog(s, { next_action: originalNext, next_action_at: originalNextAt });
			setS({ ...fresh(), kind: s.kind, next: patch.next_action !== undefined ? patch.next_action ?? '' : originalNext ?? '' });
			setRound((n) => n + 1);
			onDone({ answered: true, ...patch });
			noteRef.current?.focus();
		});

	return (
		<div className="space-y-3">
			<div role="radiogroup" aria-label="Kind" className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
				{kinds.map((k) => (
					<button key={k} type="button" role="radio" aria-checked={s.kind === k} onClick={() => set({ kind: k, outcome: null })}
						className={clsx('flex-1 border-r border-slate-300 py-1 text-xs last:border-r-0 dark:border-slate-600', s.kind === k ? 'bg-primary-50 font-semibold text-primary-900 dark:bg-primary-950 dark:text-primary-300' : 'hover:bg-hover')}>
						{KIND_LABELS[k]}
					</button>
				))}
			</div>
			{outcomes.length > 0 && (
				<div>
					<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Outcome{s.kind === 'call' ? '' : ' (optional)'}</p>
					<div className="flex flex-wrap gap-1.5">
						{outcomes.map((d) => (
							<FilterChip key={d.id} type="button" active={s.outcome === d.id} aria-pressed={s.outcome === d.id} onClick={() => set({ outcome: s.outcome === d.id ? null : d.id })}>{d.name}</FilterChip>
						))}
					</div>
				</div>
			)}
			{extended && outcomes.length === 0 && <Input label="Subject" value={s.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Optional" />}
			<Textarea ref={noteRef} label="Note" rows={2} value={s.note} onChange={(e) => set({ note: e.target.value })} />
			<div className="space-y-1.5">
				<Input label="Next action" value={s.next} disabled={s.clearNext} onChange={(e) => set({ next: e.target.value })} placeholder="Follow up" />
				<WhenPicker key={round} value={s.when} onChange={(when) => set({ when })} disabled={s.clearNext} />
				<FilterChip type="button" active={s.clearNext} aria-pressed={s.clearNext} onClick={() => set({ clearNext: !s.clearNext })}>No next step</FilterChip>
			</div>
			{error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-3">
					<label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
						<input type="checkbox" checked={s.positive} onChange={(e) => set({ positive: e.target.checked })} /> Positive reply
					</label>
					{extended && s.kind !== 'note' && s.kind !== 'meeting' && (
						<label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
							<input type="checkbox" checked={s.inbound} onChange={(e) => set({ inbound: e.target.checked })} /> Inbound
						</label>
					)}
				</div>
				<div className="flex gap-2">
					{onCancel && <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>}
					<Button size="sm" loading={pending} onClick={save}>Save</Button>
				</div>
			</div>
		</div>
	);
}
