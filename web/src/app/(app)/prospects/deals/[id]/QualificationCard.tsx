'use client';

// Qualification (spec 2026-10-20 §4.1): the answers a rep collects on a call
// (budget band, timing, the fit questions), moved out of the Scoring card's
// fold-out so they sit next to the prep. Saving rescores the deal.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { qualificationProgress } from '@/lib/revenue/dealPage';
import { BUDGET_BANDS, BUDGET_BAND_LABELS, FIT_SIGNAL_FIELDS, TIMINGS, TIMING_LABELS, type DealCard } from '@/lib/revenue/shared';
import { saveFitSignals } from '../../scoringActions';

function Bool({ name, label, value }: { name: string; label: string; value: unknown }) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
			<Select name={name} size="sm" defaultValue={value === true ? 'yes' : value === false ? 'no' : ''}>
				<option value="">—</option>
				<option value="yes">Yes</option>
				<option value="no">No</option>
			</Select>
		</label>
	);
}

export default function QualificationCard({ deal }: { deal: DealCard }) {
	const router = useRouter();
	const { toast } = useToast();
	const [pending, start] = useTransition();
	const f = (deal.fit_signals ?? {}) as Record<string, unknown>;
	const p = qualificationProgress(deal);
	const ask = new Set(p.missing);
	// Unanswered questions read "(to ask)" so the rep knows what to cover on the call.
	const label = (text: string) => (ask.has(text) ? `${text} (to ask)` : text);
	return (
		<Card className="space-y-3">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Qualification</h2>
				<span className="text-2xs tabular-nums text-slate-500">{p.answered} of {p.total} answered</span>
			</div>
			{/* onSubmit, not a form action: React 19 resets a form after its action and the Selects would snap back to their page-load values (review 2026-10-20). */}
			<form
				className="grid gap-3 sm:grid-cols-2"
				onSubmit={(e) => {
					e.preventDefault();
					const fd = new FormData(e.currentTarget);
					start(async () => {
						const r = await saveFitSignals(fd);
						if (!r.ok) {
							toast({ message: r.error, variant: 'error' });
							return;
						}
						toast({ message: 'Saved — score updated', variant: 'success' });
						router.refresh();
					});
				}}
			>
				<input type="hidden" name="deal_id" value={deal.id} />
				<Select id="q-budget_band" name="budget_band" label={label('Budget band')} defaultValue={deal.budget_band ?? ''}>
					<option value="">—</option>
					{BUDGET_BANDS.map((b) => <option key={b} value={b}>{BUDGET_BAND_LABELS[b]}</option>)}
				</Select>
				<Select id="q-timing" name="timing" label={label('Timing')} defaultValue={deal.timing ?? ''}>
					<option value="">—</option>
					{TIMINGS.map((t) => <option key={t} value={t}>{TIMING_LABELS[t]}</option>)}
				</Select>
				{FIT_SIGNAL_FIELDS.map((fld) => {
					const v = f[fld.key];
					const l = label(fld.label);
					if (fld.kind === 'bool') return <Bool key={fld.key} name={fld.key} label={l} value={v} />;
					if (fld.kind === 'website')
						return (
							<Select key={fld.key} id={`q-${fld.key}`} name={fld.key} label={l} defaultValue={v == null ? '' : String(v)}>
								<option value="">—</option>
								<option value="0">0 · does not load</option>
								<option value="1">1 · basic</option>
								<option value="2">2 · established</option>
								<option value="3">3 · nice (testimonials, booking, clients, media…)</option>
							</Select>
						);
					if (fld.kind === 'text') return <Textarea key={fld.key} id={`q-${fld.key}`} name={fld.key} label={l} defaultValue={v == null ? '' : String(v)} rows={2} className="sm:col-span-2" />;
					return <Input key={fld.key} id={`q-${fld.key}`} name={fld.key} label={l} defaultValue={v == null ? '' : String(v)} />;
				})}
				<div className="sm:col-span-2">
					<Button type="submit" size="sm" loading={pending}>Save answers</Button>
				</div>
			</form>
		</Card>
	);
}
