'use client';

// Self → Sales row actions (spec §4.4): the bodies of the Log / Snooze /
// Move popovers and the ⋯ menu. Each panel calls the existing Prospects
// server action and reports back only on success; SalesQueue patches the
// row and raises the toast (Undo where the spec allows it).

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { moveDeal, snoozeDeal } from '@/app/(app)/prospects/actions';
import LogForm, { WhenPicker } from '@/components/prospects/LogForm';
import type { SalesRow } from '@/lib/home/sales';
import type { SalesData } from '@/lib/home/salesData';
import type { StageRow } from '@/lib/revenue/shared';

export type RowPatch = Partial<Pick<SalesRow, 'next_action' | 'next_action_at' | 'stage_id' | 'stage_name' | 'answered'>>;

function Err({ text }: { text: string | null }) {
	return text ? <p className="text-xs text-red-600 dark:text-red-400" role="alert">{text}</p> : null;
}

const SELF_KINDS = ['call', 'sms', 'email', 'dm', 'meeting'] as const;

/** Self → Sales popover: the shared log form (spec 2026-10-20 §4.3), unchanged except that an untouched next step is kept. */
export function LogPanel({ row, sales, onDone, onCancel }: { row: SalesRow; sales: SalesData; onDone: (patch: RowPatch) => void; onCancel: () => void }) {
	return (
		<div className="space-y-3 p-3">
			<h3 className="text-sm font-semibold">Log activity · {row.title}</h3>
			<LogForm
				dealId={row.deal_id}
				personId={row.person_id}
				originalNext={row.next_action}
				originalNextAt={row.next_action_at}
				dispositions={sales.dispositions}
				kinds={SELF_KINDS}
				extended={false}
				onDone={onDone}
				onCancel={onCancel}
			/>
		</div>
	);
}

export function SnoozePanel({ row, onDone, onCancel }: { row: SalesRow; onDone: (patch: RowPatch, prev: RowPatch) => void; onCancel: () => void }) {
	const [next, setNext] = useState(row.next_action ?? 'Follow up');
	const [when, setWhen] = useState<Date | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const save = () => start(async () => {
		if (!when) { setError('Pick when.'); return; }
		const fd = new FormData();
		fd.set('deal_id', row.deal_id);
		fd.set('next_action', next.trim() || 'Follow up');
		fd.set('next_action_at', when.toISOString());
		const r = await snoozeDeal(fd);
		if (!r.ok) { setError(r.error); return; }
		onDone({ next_action: next.trim() || 'Follow up', next_action_at: when.toISOString() }, { next_action: row.next_action, next_action_at: row.next_action_at });
	});
	return (
		<div className="space-y-3 p-3">
			<h3 className="text-sm font-semibold">Snooze · {row.title}</h3>
			<Input label="Next action" value={next} onChange={(e) => setNext(e.target.value)} />
			<WhenPicker value={when} onChange={setWhen} />
			<Err text={error} />
			<div className="flex justify-end gap-2">
				<Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
				<Button size="sm" loading={pending} onClick={save}>Snooze</Button>
			</div>
		</div>
	);
}

/** Re-send a previous next action (Snooze Undo). */
export async function restoreNext(dealId: string, prev: RowPatch) {
	const fd = new FormData();
	fd.set('deal_id', dealId);
	if (prev.next_action) fd.set('next_action', prev.next_action);
	if (prev.next_action_at) fd.set('next_action_at', prev.next_action_at);
	return snoozeDeal(fd);
}

export function MovePanel({ row, sales, onMoved, onCancel }: {
	row: SalesRow;
	sales: SalesData;
	onMoved: (r: { stage: StageRow; handoff: boolean; prevStageId: string | null; prevStageName: string }) => void;
	onCancel: () => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const stages = sales.stages.filter((s) => s.pipeline_id === row.pipeline_id).sort((a, b) => a.position - b.position);
	const pipeName = (id: string | null) => sales.pipelines.find((p) => p.id === id)?.name ?? 'the next lane';
	const pick = (s: StageRow) => start(async () => {
		setError(null);
		const r = await moveDeal({ deal_id: row.deal_id, stage_id: s.id });
		if (!r.ok) { setError(r.error); return; }
		onMoved({ stage: s, handoff: !!s.handoff_pipeline_id, prevStageId: row.stage_id, prevStageName: row.stage_name });
	});
	return (
		<div className="p-2">
			<h3 className="px-2 pb-1.5 pt-1 text-sm font-semibold">Move stage · {row.title}</h3>
			{stages.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">This deal&apos;s pipeline has no stages to move to.</p>}
			<ul>
				{stages.map((s) => (
					<li key={s.id}>
						<button type="button" disabled={pending || s.id === row.stage_id} onClick={() => pick(s)}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-50">
							{s.handoff_pipeline_id ? `Hand off to ${pipeName(s.handoff_pipeline_id)}` : s.name}
							{s.id === row.stage_id && <span className="ml-auto text-2xs text-slate-500">current</span>}
						</button>
					</li>
				))}
			</ul>
			<Err text={error} />
			<div className="flex justify-end px-2 pt-1"><Button size="sm" variant="ghost" onClick={onCancel}>Close</Button></div>
		</div>
	);
}

export function RowMenu({ row, onPick }: { row: SalesRow; onPick: (mode: 'snooze' | 'move') => void }) {
	const item = 'flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover';
	return (
		<div className="p-1.5" role="menu">
			<button type="button" role="menuitem" className={item} onClick={() => onPick('snooze')}>Snooze…</button>
			<button type="button" role="menuitem" className={item} onClick={() => onPick('move')}>Move stage…</button>
			<Link role="menuitem" className={item} href={`/prospects/deals/${row.deal_id}`}>Open deal</Link>
			{row.ghl_url && <a role="menuitem" className={item} href={row.ghl_url} target="_blank" rel="noreferrer">Open in GHL</a>}
		</div>
	);
}
