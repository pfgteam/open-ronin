'use client';

// Edit the deal's own fields: title, motion, value, the three lane owners,
// source / campaign / channel, budget band, timing, next action, lost
// reason, products. Stage lives in DealStageSelect.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { BUDGET_BANDS, BUDGET_BAND_LABELS, MOTIONS, MOTION_LABELS, SOURCES, SOURCE_LABELS, TIMINGS, TIMING_LABELS, productPriceLabel, type DealCard, type ProductRow, type StaffOption } from '@/lib/revenue/shared';
import { updateDeal } from '../../actions';

function toLocalInput(iso: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DealEditForm({ deal, staff, products }: { deal: DealCard; staff: StaffOption[]; products: ProductRow[] }) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const owner = (name: 'owner_lg_id' | 'owner_setter_id' | 'owner_closer_id', label: string) => (
		<Select name={name} label={label} defaultValue={deal[name] ?? ''}>
			<option value="">Unassigned</option>
			{staff.map((s) => (
				<option key={s.id} value={s.id}>
					{s.name}
				</option>
			))}
		</Select>
	);

	return (
		<Card>
			<form
				className="space-y-4"
				action={(fd) => {
					setError(null);
					start(async () => {
						const r = await updateDeal(fd);
						if (!r.ok) setError(r.error);
						else router.push(`/prospects/deals/${deal.id}`);
					});
				}}
			>
				<input type="hidden" name="id" value={deal.id} />
				<div className="grid sm:grid-cols-2 gap-3">
					<Input name="title" label="Title" defaultValue={deal.title} required className="sm:col-span-2" />
					<Select name="motion" label="Motion" defaultValue={deal.motion}>
						{MOTIONS.map((m) => (
							<option key={m} value={m}>
								{MOTION_LABELS[m]}
							</option>
						))}
					</Select>
					<Select name="source" label="Source" defaultValue={deal.source ?? ''}>
						<option value="">—</option>
						{SOURCES.map((s) => (
							<option key={s} value={s}>
								{SOURCE_LABELS[s]}
							</option>
						))}
						{deal.source && !(SOURCES as readonly string[]).includes(deal.source) && <option value={deal.source}>{deal.source}</option>}
					</Select>
					<Input name="campaign" label="Campaign" defaultValue={deal.campaign ?? ''} autoComplete="off" />
					<Input name="channel" label="Channel" defaultValue={deal.channel ?? ''} autoComplete="off" />
					<Input name="est_mrr" label="Est. monthly value" defaultValue={deal.est_mrr_cents != null ? String(deal.est_mrr_cents / 100) : ''} inputMode="decimal" />
					<Input name="est_one_time" label="Est. one-time" defaultValue={deal.est_one_time_cents != null ? String(deal.est_one_time_cents / 100) : ''} inputMode="decimal" />
					{owner('owner_lg_id', 'Lead gen owner')}
					{owner('owner_setter_id', 'Setter')}
					{owner('owner_closer_id', 'Closer')}
					<Select name="budget_band" label="Budget band" defaultValue={deal.budget_band ?? ''}>
						<option value="">—</option>
						{BUDGET_BANDS.map((b) => (
							<option key={b} value={b}>
								{BUDGET_BAND_LABELS[b]}
							</option>
						))}
					</Select>
					<Select name="timing" label="Timing" defaultValue={deal.timing ?? ''}>
						<option value="">—</option>
						{TIMINGS.map((t) => (
							<option key={t} value={t}>
								{TIMING_LABELS[t]}
							</option>
						))}
					</Select>
					<Input name="next_action" label="Next action" defaultValue={deal.next_action ?? ''} autoComplete="off" />
					<Input name="next_action_at" label="Next action due" type="datetime-local" defaultValue={toLocalInput(deal.next_action_at)} />
					<Textarea name="lost_reason" label="Lost reason" defaultValue={deal.lost_reason ?? ''} rows={2} className="sm:col-span-2" />
				</div>
				<div>
					<div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Products of interest</div>
					<div className="grid sm:grid-cols-2 gap-1 max-h-56 overflow-y-auto pr-1">
						{products
							.filter((p) => p.is_active || deal.product_ids.includes(p.id))
							.map((p) => (
								<label key={p.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
									<Checkbox name="product_ids" value={p.id} defaultChecked={deal.product_ids.includes(p.id)} />
									<span className="truncate">{p.name}</span>
									<span className="ml-auto text-slate-500 tabular-nums shrink-0">{productPriceLabel(p)}</span>
								</label>
							))}
					</div>
				</div>
				{error && <Callout tone="error">{error}</Callout>}
				<div className="flex gap-2">
					<Button type="submit" loading={pending}>
						Save
					</Button>
					<Button type="button" variant="ghost" onClick={() => router.push(`/prospects/deals/${deal.id}`)}>
						Cancel
					</Button>
				</div>
			</form>
		</Card>
	);
}
