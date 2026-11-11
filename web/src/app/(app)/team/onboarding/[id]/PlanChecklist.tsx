'use client';

// Phase checklist with the framework's traffic lights (green done / yellow
// in window / red overdue or blocked / grey not yet). Status, note, due date,
// owner per item; the day-30 reflection prompts live on that item's note.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { OnboardingItemRow, StaffOption } from '@/lib/hiring/server';
import { ONBOARDING_ITEM_STATUSES, ONBOARDING_ITEM_STATUS_COLORS, ONBOARDING_KIND_LABELS, ONBOARDING_OWNER_LABELS, itemLight } from '@/lib/hiring/onboarding';
import { formatDate } from '@/lib/format';
import { addOnboardingItem, updateOnboardingItem } from '../actions';

const LIGHT: Record<ReturnType<typeof itemLight>, string> = { green: 'bg-green-500', yellow: 'bg-amber-400', red: 'bg-red-500', grey: 'bg-slate-300 dark:bg-slate-600' };
const REFLECTION = ['What feels clear about your role?', 'What feels unclear?', 'Where do you feel confident?', 'Where do you need more support?', 'What has surprised you?'];

export default function PlanChecklist({ items, planId, profileId, phase, canEdit, canAdd, staff, startOn }: { items: OnboardingItemRow[]; planId: string; profileId: string; phase: 1 | 2 | 3; canEdit: boolean; canAdd: boolean; staff: StaffOption[]; startOn: string }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [open, setOpen] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [newLabel, setNewLabel] = useState('');
	const [newDue, setNewDue] = useState('');
	const [newOwner, setNewOwner] = useState('manager');
	const name = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;
	const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
		start(async () => {
			setErr(null);
			const r = await fn();
			if (!r.ok) setErr(r.error ?? 'Failed.');
			else router.refresh();
		});

	return (
		<div>
			{err && <div className="px-3 pt-2"><Callout tone="error">{err}</Callout></div>}
			<ul className="divide-y divide-slate-200 dark:divide-slate-700 mt-2">
				{items.map((it) => {
					const light = itemLight(it);
					const isOpen = open === it.id;
					return (
						<li key={it.id} className="px-3 py-2">
							<div className="flex items-start gap-2">
								<span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${LIGHT[light]}`} aria-label={light} />
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<button type="button" onClick={() => setOpen(isOpen ? null : it.id)} className={`text-sm text-left font-medium hover:underline ${it.status === 'done' || it.status === 'skipped' ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-900 dark:text-slate-100'}`}>
											{it.label}
										</button>
										<Badge color={ONBOARDING_ITEM_STATUS_COLORS[it.status]}>{it.status.replace('_', ' ')}</Badge>
										{it.kind !== 'task' && <Badge>{ONBOARDING_KIND_LABELS[it.kind]}</Badge>}
										<span className="text-2xs text-slate-500 ml-auto whitespace-nowrap">
											{ONBOARDING_OWNER_LABELS[it.owner_role]}{name(it.owner_id) ? ` · ${name(it.owner_id)}` : ''} · due {formatDate(it.due_on)}{it.window_from ? ` (from ${formatDate(it.window_from)})` : ''}
										</span>
									</div>
									{it.note_md && !isOpen && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 whitespace-pre-wrap line-clamp-2">{it.note_md}</p>}
									{isOpen && (
										<div className="mt-2 space-y-2">
											{it.description && <p className="text-xs text-slate-600 dark:text-slate-400">{it.description}</p>}
											{it.template_key === 'day30_reflection' && (
												<ul className="text-2xs text-slate-500 list-disc pl-4">
													{REFLECTION.map((q) => <li key={q}>{q}</li>)}
												</ul>
											)}
											{canEdit ? (
												<ItemEditor item={it} profileId={profileId} staff={staff} pending={pending} onSave={(patch) => act(() => updateOnboardingItem({ id: it.id, profile_id: profileId, ...patch }))} />
											) : (
												it.note_md && <p className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300">{it.note_md}</p>
											)}
											{it.done_at && <p className="text-2xs text-slate-500">Done {formatDate(it.done_at)}{name(it.done_by) ? ` by ${name(it.done_by)}` : ''}</p>}
										</div>
									)}
								</div>
							</div>
						</li>
					);
				})}
				{items.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No items in this phase.</li>}
			</ul>
			{canAdd && (
				<div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
					{!adding ? (
						<button type="button" onClick={() => { setAdding(true); setNewDue(defaultDue(startOn, phase)); }} className="text-xs text-primary-600 hover:underline">+ Add an item to this phase</button>
					) : (
						<div className="grid gap-2 sm:grid-cols-4 items-end">
							<div className="sm:col-span-2"><Input label="Item" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Shadow two client calls with Tess" /></div>
							<Input label="Due" type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
							<div className="flex gap-2 items-end">
								<Select label="Owner" size="sm" value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
									{Object.entries(ONBOARDING_OWNER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
								</Select>
								<Button size="sm" loading={pending} disabled={newLabel.trim().length < 2 || !newDue} onClick={() => act(async () => { const r = await addOnboardingItem({ plan_id: planId, profile_id: profileId, label: newLabel, phase, owner_role: newOwner, due_on: newDue }); if (r.ok) { setAdding(false); setNewLabel(''); } return r; })}>Add</Button>
								<Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function defaultDue(startOn: string, phase: 1 | 2 | 3): string {
	const d = new Date(`${startOn}T00:00:00`);
	d.setDate(d.getDate() + (phase === 1 ? 20 : phase === 2 ? 50 : 80));
	return d.toISOString().slice(0, 10);
}

function ItemEditor({ item, staff, pending, onSave }: { item: OnboardingItemRow; profileId: string; staff: StaffOption[]; pending: boolean; onSave: (patch: { status?: OnboardingItemRow['status']; note_md?: string | null; due_on?: string; owner_id?: string | null }) => void }) {
	const [status, setStatus] = useState<OnboardingItemRow['status']>(item.status);
	const [note, setNote] = useState(item.note_md ?? '');
	const [due, setDue] = useState(item.due_on);
	const [owner, setOwner] = useState(item.owner_id ?? '');
	return (
		<div className="space-y-2">
			<div className="grid gap-2 sm:grid-cols-3">
				<Select label="Status" size="sm" value={status} onChange={(e) => setStatus(e.target.value as OnboardingItemRow['status'])}>
					{ONBOARDING_ITEM_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
				</Select>
				<Input label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
				<Select label="Owner" size="sm" value={owner} onChange={(e) => setOwner(e.target.value)}>
					<option value="">— unassigned —</option>
					{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
				</Select>
			</div>
			<Textarea label={item.template_key === 'day30_reflection' ? 'Reflection notes' : item.template_key === 'how_i_work_best' ? '"How I Work Best" summary' : 'Notes / deliverable'} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
			<div className="flex gap-2">
				<Button size="sm" loading={pending} onClick={() => onSave({ status, note_md: note, due_on: due, owner_id: owner || null })}>Save</Button>
				{status !== 'done' && <Button size="sm" variant="outline" loading={pending} onClick={() => onSave({ status: 'done', note_md: note })}>Mark done</Button>}
			</div>
		</div>
	);
}
