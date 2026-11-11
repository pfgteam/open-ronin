'use client';

// Slots + placements editor with the performance numbers inline.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { INDUSTRY_LABELS, ITEM_KINDS, ITEM_KIND_LABELS, PROOF_INDUSTRIES, SLOT_MEDIA_TYPES, SLOT_STRATEGIES, ctr, type ItemKind, type SlotWithPlacements } from '@/lib/proof/shared';
import { addPlacement, removePlacement, saveSlot, updatePlacement } from '../actions';

type PickerItem = { kind: ItemKind; id: string; label: string; media_type: string };

export default function SlotsPanel({ slots, picker, canManage }: { slots: SlotWithPlacements[]; picker: PickerItem[]; canManage: boolean }) {
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [showNew, setShowNew] = useState(false);
	const [page, setPage] = useState<string>('all');
	const router = useRouter();
	const { toast } = useToast();

	const pages = useMemo(() => Array.from(new Set(slots.map((s) => s.page))), [slots]);
	const visible = page === 'all' ? slots : slots.filter((s) => s.page === page);

	function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
		setError(null);
		start(async () => {
			const res = await fn();
			if (!res.ok) {
				setError(res.error ?? 'Failed.');
				return;
			}
			if (done) toast({ message: done, variant: 'success' });
			router.refresh();
		});
	}

	return (
		<div className="space-y-4">
			<Callout tone="info">
				Each slot rotates ONE media type. Written quotes go in a <code>text</code> slot, video testimonials in a <code>video</code> slot, logos and stats in an <code>image</code> slot. The site asks{' '}
				<code>GET /api/proof/slot/&lt;key&gt;</code> and posts what happened to <code>/api/proof/events</code>.
			</Callout>
			{error && <Callout tone="error">{error}</Callout>}
			<div className="flex flex-wrap items-center gap-2">
				<Select size="sm" aria-label="Page" value={page} onChange={(e) => setPage(e.target.value)}>
					<option value="all">All pages</option>
					{pages.map((p) => (
						<option key={p} value={p}>
							{p}
						</option>
					))}
				</Select>
				{canManage && (
					<Button size="sm" variant="outline" onClick={() => setShowNew((v) => !v)}>
						{showNew ? 'Cancel' : 'New slot'}
					</Button>
				)}
			</div>

			{showNew && canManage && (
				<Card>
					<form
						className="grid gap-3 sm:grid-cols-4 items-end"
						onSubmit={(e) => {
							e.preventDefault();
							const fd = new FormData(e.currentTarget);
							run(() => saveSlot(null, fd), 'Slot created.');
							setShowNew(false);
						}}
					>
						<Input label="Key (page.slot)" name="key" required placeholder="legal.press_logos" pattern="^[a-z0-9_]+(\.[a-z0-9_]+)+$" />
						<Input label="Label" name="label" required />
						<Input label="Page" name="page" required placeholder="legal" />
						<Select label="Item kind" name="item_kind" defaultValue="testimonial">
							{ITEM_KINDS.map((k) => (
								<option key={k} value={k}>
									{ITEM_KIND_LABELS[k]}
								</option>
							))}
						</Select>
						<Select label="Media type" name="media_type" defaultValue="text">
							{SLOT_MEDIA_TYPES.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</Select>
						<Input label="Max items" name="max_items" type="number" min={1} max={24} defaultValue={3} />
						<Select label="Strategy" name="strategy" defaultValue="weighted">
							{SLOT_STRATEGIES.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</Select>
						<Select label="Industry (optional)" name="industry" defaultValue="">
							<option value="">—</option>
							{PROOF_INDUSTRIES.map((i) => (
								<option key={i} value={i}>
									{INDUSTRY_LABELS[i]}
								</option>
							))}
						</Select>
						<input type="hidden" name="active" value="on" />
						<Button type="submit" loading={pending}>
							Create slot
						</Button>
					</form>
				</Card>
			)}

			{visible.map((slot) => (
				<SlotCard key={slot.key} slot={slot} picker={picker} canManage={canManage} pending={pending} run={run} />
			))}
			{visible.length === 0 && <p className="text-sm text-slate-500">No slots on this page.</p>}
		</div>
	);
}

function SlotCard({ slot, picker, canManage, pending, run }: { slot: SlotWithPlacements; picker: PickerItem[]; canManage: boolean; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => void }) {
	const [pick, setPick] = useState('');
	const [weight, setWeight] = useState('100');
	const [variant, setVariant] = useState('a');
	const [edit, setEdit] = useState(false);
	const placed = new Set(slot.placements.map((p) => p.item_id));
	const options = picker.filter((i) => i.kind === slot.item_kind && i.media_type === slot.media_type && !placed.has(i.id));

	return (
		<Card className="space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="flex items-center gap-2">
						<code className="text-sm font-semibold text-slate-900 dark:text-slate-100">{slot.key}</code>
						<Badge color={slot.media_type === 'video' ? 'accent' : 'default'}>{slot.media_type}</Badge>
						<Badge color="primary">{ITEM_KIND_LABELS[slot.item_kind]}</Badge>
						<Badge>{slot.strategy}</Badge>
						{!slot.active && <Badge color="warning">inactive</Badge>}
					</div>
					<div className="text-xs text-slate-500 dark:text-slate-400">
						{slot.label} · page {slot.page} · up to {slot.max_items}
						{slot.notes ? ` · ${slot.notes}` : ''}
					</div>
				</div>
				{canManage && (
					<Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>
						{edit ? 'Close' : 'Edit slot'}
					</Button>
				)}
			</div>

			{edit && canManage && (
				<form
					className="grid gap-3 sm:grid-cols-4 items-end border-t border-slate-200 dark:border-slate-700 pt-3"
					onSubmit={(e) => {
						e.preventDefault();
						const fd = new FormData(e.currentTarget);
						run(() => saveSlot(slot.key, fd), 'Slot saved.');
						setEdit(false);
					}}
				>
					<input type="hidden" name="key" value={slot.key} />
					<Input label="Label" name="label" required defaultValue={slot.label} />
					<Input label="Page" name="page" required defaultValue={slot.page} />
					<Select label="Item kind" name="item_kind" defaultValue={slot.item_kind}>
						{ITEM_KINDS.map((k) => (
							<option key={k} value={k}>
								{ITEM_KIND_LABELS[k]}
							</option>
						))}
					</Select>
					<Select label="Media type" name="media_type" defaultValue={slot.media_type}>
						{SLOT_MEDIA_TYPES.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
					</Select>
					<Input label="Max items" name="max_items" type="number" min={1} max={24} defaultValue={slot.max_items} />
					<Select label="Strategy" name="strategy" defaultValue={slot.strategy}>
						{SLOT_STRATEGIES.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</Select>
					<Select label="Industry" name="industry" defaultValue={slot.industry ?? ''}>
						<option value="">—</option>
						{PROOF_INDUSTRIES.map((i) => (
							<option key={i} value={i}>
								{INDUSTRY_LABELS[i]}
							</option>
						))}
					</Select>
					<Select label="Active" name="active" defaultValue={slot.active ? 'on' : 'off'}>
						<option value="on">active</option>
						<option value="off">inactive</option>
					</Select>
					<Input label="Notes" name="notes" defaultValue={slot.notes ?? ''} />
					<Button type="submit" loading={pending}>
						Save slot
					</Button>
				</form>
			)}

			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-slate-500 dark:text-slate-400">
						<th className="py-1 pr-2">Item</th>
						<th className="py-1 pr-2">Variant</th>
						<th className="py-1 pr-2 text-right">Weight</th>
						<th className="py-1 pr-2 text-right">Impr.</th>
						<th className="py-1 pr-2 text-right">Clicks</th>
						<th className="py-1 pr-2 text-right">CTR</th>
						<th className="py-1 pr-2 text-right">Conv.</th>
						<th className="py-1" />
					</tr>
				</thead>
				<tbody>
					{slot.placements.length === 0 && (
						<tr>
							<td colSpan={8} className="py-2 text-xs text-slate-400">
								Nothing placed. {canManage ? 'Pick a ready item below.' : ''}
							</td>
						</tr>
					)}
					{slot.placements.map((p) => (
						<tr key={p.id} className={`border-t border-slate-100 dark:border-slate-700 ${p.active ? '' : 'opacity-50'}`}>
							<td className="py-1.5 pr-2 max-w-xs truncate">{p.label}</td>
							<td className="py-1.5 pr-2 font-mono text-xs">{p.variant}</td>
							<td className="py-1.5 pr-2 text-right">
								{canManage ? (
									<input
										type="number"
										min={0}
										max={1000}
										defaultValue={p.weight}
										className="w-16 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-right text-xs dark:border-slate-600 dark:bg-slate-800"
										onBlur={(e) => {
											const w = Number(e.target.value);
											if (w !== p.weight) run(() => updatePlacement({ id: p.id, weight: w }));
										}}
									/>
								) : (
									p.weight
								)}
							</td>
							<td className="py-1.5 pr-2 text-right font-mono tabular-nums">{Number(p.impressions).toLocaleString()}</td>
							<td className="py-1.5 pr-2 text-right font-mono tabular-nums">{Number(p.clicks).toLocaleString()}</td>
							<td className="py-1.5 pr-2 text-right font-mono tabular-nums">{ctr(Number(p.impressions), Number(p.clicks))}</td>
							<td className="py-1.5 pr-2 text-right font-mono tabular-nums">{Number(p.conversions).toLocaleString()}</td>
							<td className="py-1.5 text-right whitespace-nowrap">
								{canManage && (
									<>
										<Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updatePlacement({ id: p.id, active: !p.active }))}>
											{p.active ? 'Pause' : 'Resume'}
										</Button>
										<Button size="sm" variant="ghost" className="text-red-600" disabled={pending} onClick={() => run(() => removePlacement(p.id), 'Removed.')}>
											Remove
										</Button>
									</>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{canManage && (
				<div className="flex flex-wrap items-end gap-2 border-t border-slate-200 dark:border-slate-700 pt-3">
					<div className="min-w-64 flex-1">
						<Select size="sm" aria-label="Add item" value={pick} onChange={(e) => setPick(e.target.value)}>
							<option value="">{options.length ? `Add a ready ${slot.media_type} ${ITEM_KIND_LABELS[slot.item_kind].toLowerCase()}…` : `No unplaced ready ${slot.media_type} ${ITEM_KIND_LABELS[slot.item_kind].toLowerCase()}s`}</option>
							{options.map((o) => (
								<option key={o.id} value={o.id}>
									{o.label}
								</option>
							))}
						</Select>
					</div>
					<div className="w-20">
						<Input aria-label="Variant" value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="a" />
					</div>
					<div className="w-24">
						<Input aria-label="Weight" type="number" min={0} max={1000} value={weight} onChange={(e) => setWeight(e.target.value)} />
					</div>
					<Button
						size="md"
						disabled={!pick || pending}
						onClick={() => {
							run(() => addPlacement({ slot_key: slot.key, item_kind: slot.item_kind, item_id: pick, variant, weight: Number(weight) }), 'Placed.');
							setPick('');
						}}
					>
						Place
					</Button>
				</div>
			)}
		</Card>
	);
}
