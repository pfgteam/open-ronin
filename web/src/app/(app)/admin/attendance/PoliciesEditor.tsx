'use client';

// Policy forms (one card per policy + "new"). Holidays: one per line,
// "YYYY-MM-DD Label".

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { AttendancePolicyRow } from '@/lib/hiring/server';
import { ACCRUAL_METHODS, POLICY_REGIONS } from '@/lib/hiring/onboarding';
import { saveAttendancePolicy } from '@/app/(app)/team/onboarding/actions';

export default function PoliciesEditor({ policies, canManage }: { policies: AttendancePolicyRow[]; canManage: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [adding, setAdding] = useState(false);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await saveAttendancePolicy(fd);
			setMsg(r.ok ? { ok: true, text: 'Policy saved.' } : { ok: false, text: r.error });
			if (r.ok) {
				setAdding(false);
				router.refresh();
			}
		});
	const Form = ({ p }: { p: AttendancePolicyRow | null }) => (
		<form action={submit} className="grid gap-2 sm:grid-cols-4">
			{p && <input type="hidden" name="id" value={p.id} />}
			<Input name="key" label="Key" defaultValue={p?.key ?? ''} pattern="[a-z][a-z0-9_]{1,40}" required readOnly={!!p} disabled={!canManage} />
			<Input name="label" label="Label" defaultValue={p?.label ?? ''} required disabled={!canManage} className="sm:col-span-2" />
			<Select name="region" label="Region" defaultValue={p?.region ?? 'any'} disabled={!canManage}>
				{POLICY_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
			</Select>
			<Input name="employment" label="Employment types (comma)" defaultValue={p?.employment.join(',') ?? 'full_time,part_time'} disabled={!canManage} />
			<Input name="accrual_days_per_year" label="PTO days / year" type="number" step="0.5" defaultValue={p?.accrual_days_per_year ?? 21} disabled={!canManage} />
			<Select name="accrual_method" label="Accrual" defaultValue={p?.accrual_method ?? 'daily'} disabled={!canManage}>
				{ACCRUAL_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
			</Select>
			<Input name="waiting_period_days" label="Usable after (days)" type="number" defaultValue={p?.waiting_period_days ?? 90} disabled={!canManage} />
			<Input name="carryover_max_days" label="Carryover max" type="number" step="0.5" defaultValue={p?.carryover_max_days ?? 5} disabled={!canManage} />
			<Input name="sick_days_per_year" label="Separate sick days / year (0 = sick uses PTO)" type="number" step="0.5" defaultValue={p?.sick_days_per_year ?? 0} disabled={!canManage} />
			<Textarea name="holidays" label="Holidays (one per line: YYYY-MM-DD Label)" rows={5} defaultValue={(p?.holidays ?? []).map((h) => `${h.date} ${h.label ?? ''}`.trim()).join('\n')} disabled={!canManage} className="sm:col-span-2" />
			<Textarea name="notes_md" label="Notes" rows={3} defaultValue={p?.notes_md ?? ''} disabled={!canManage} className="sm:col-span-2" />
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><Checkbox name="is_default" defaultChecked={p?.is_default ?? false} disabled={!canManage} /> Default policy (holiday shading on the tracker)</label>
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><Checkbox name="is_active" value="on" defaultChecked={p?.is_active ?? true} disabled={!canManage} /> Active</label>
			{canManage && (
				<div className="sm:col-span-4 flex gap-2">
					<Button size="sm" type="submit" loading={pending}>Save</Button>
					{!p && <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button>}
				</div>
			)}
		</form>
	);
	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{policies.map((p) => (
				<Card key={p.id} className="space-y-2">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.label}</h2>
						{p.is_default && <Badge color="primary">default</Badge>}
						{!p.is_active && <Badge>inactive</Badge>}
						<span className="text-2xs text-slate-500 ml-auto">{p.accrual_days_per_year} d/yr · {p.accrual_method} · after {p.waiting_period_days} d · {p.holidays.length} holidays</span>
					</div>
					<Form p={p} />
				</Card>
			))}
			{canManage && (adding ? <Card><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">New policy</h2><Form p={null} /></Card> : <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ New policy</Button>)}
		</div>
	);
}
