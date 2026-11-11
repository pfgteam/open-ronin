'use client';

// Plan-level controls for the manager / people managers: status, manager,
// start date, notes.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { OnboardingPlanRow, StaffOption } from '@/lib/hiring/server';
import { ONBOARDING_PLAN_STATUSES } from '@/lib/hiring/onboarding';
import { setOnboardingPlan } from '../actions';

export default function PlanControls({ plan, profileId, staff }: { plan: OnboardingPlanRow; profileId: string; staff: StaffOption[] }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState(plan.status);
	const [manager, setManager] = useState(plan.manager_id ?? '');
	const [startOn, setStartOn] = useState(plan.start_on);
	const [notes, setNotes] = useState(plan.notes_md ?? '');
	const [err, setErr] = useState<string | null>(null);
	if (!open) {
		return (
			<div className="flex items-center gap-3">
				<button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">Edit plan (status, manager, start, notes)</button>
				{plan.notes_md && <span className="text-2xs text-slate-500 truncate">{plan.notes_md}</span>}
			</div>
		);
	}
	return (
		<Card className="space-y-2">
			<div className="grid gap-2 sm:grid-cols-3">
				<Select label="Status" size="sm" value={status} onChange={(e) => setStatus(e.target.value as OnboardingPlanRow['status'])}>
					{ONBOARDING_PLAN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
				</Select>
				<Select label="Manager" size="sm" value={manager} onChange={(e) => setManager(e.target.value)}>
					<option value="">—</option>
					{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
				</Select>
				<Input label="Start date" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
			</div>
			<Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
			<p className="text-2xs text-slate-500">Changing the start date does not move existing item due dates. The calibration hold lifts automatically at day 60 on the daily tick.</p>
			{err && <Callout tone="error">{err}</Callout>}
			<div className="flex gap-2">
				<Button size="sm" loading={pending} onClick={() => start(async () => {
					setErr(null);
					const r = await setOnboardingPlan({ id: plan.id, profile_id: profileId, status, manager_id: manager || null, start_on: startOn, notes_md: notes });
					if (!r.ok) setErr(r.error);
					else {
						setOpen(false);
						router.refresh();
					}
				})}>Save</Button>
				<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
			</div>
		</Card>
	);
}
