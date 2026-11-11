'use client';

// Start a 60/90-day plan for someone already on the team (people managers).
// Hires converted in Hiring get their plan automatically.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type { StaffOption } from '@/lib/hiring/server';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } from '@/lib/hiring/shared';
import { startOnboardingPlan } from './actions';

export default function StartPlanForm({ staff }: { staff: StaffOption[] }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [open, setOpen] = useState(false);
	const [profileId, setProfileId] = useState('');
	const [startOn, setStartOn] = useState('');
	const [emp, setEmp] = useState('full_time');
	const [err, setErr] = useState<string | null>(null);
	if (!open) {
		return (
			<div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700">
				<button type="button" onClick={() => setOpen(true)} className="text-xs text-primary-600 hover:underline">+ Start a plan for someone already on the team</button>
			</div>
		);
	}
	return (
		<div className="px-3 py-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
			<div className="grid gap-2 sm:grid-cols-4">
				<Select label="Person" value={profileId} onChange={(e) => setProfileId(e.target.value)} size="sm">
					<option value="">Choose…</option>
					{staff.map((s) => (
						<option key={s.id} value={s.id}>{s.name}</option>
					))}
				</Select>
				<Input label="Start date (blank = profile start)" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
				<Select label="Employment" value={emp} onChange={(e) => setEmp(e.target.value)} size="sm">
					{EMPLOYMENT_TYPES.map((t) => (
						<option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>
					))}
				</Select>
				<div className="flex items-end gap-2">
					<Button size="sm" loading={pending} disabled={!profileId} onClick={() => start(async () => {
						setErr(null);
						const r = await startOnboardingPlan({ profile_id: profileId, start_on: startOn || null, employment_type: emp });
						if (!r.ok) setErr(r.error);
						else {
							setOpen(false);
							router.push(`/team/onboarding/${profileId}`);
						}
					})}>
						Start plan
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
				</div>
			</div>
			<p className="text-2xs text-slate-500">Items come from the onboarding template (Admin → Hiring → Onboarding). The calibration hold applies only when the start date is within the last 60 days.</p>
			{err && <Callout tone="error">{err}</Callout>}
		</div>
	);
}
