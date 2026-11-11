'use client';

// "Request a position" form (0128). People managers only; Alex decides in
// the Innovation Desk pipeline. The pay figure shows live from the ladder so
// the request carries the annual cost the approval covers (round 3).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { HiringConfig, PositionRow, StaffOption } from '@/lib/hiring/server';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, HIRE_BRANDS, HIRE_BRAND_LABELS, payTarget, usd } from '@/lib/hiring/shared';
import { filePositionRequest } from '../actions';

export default function RequestForm({ config, people, departments, draft, canFile }: { config: HiringConfig; people: StaffOption[]; departments: { id: string; label: string }[]; draft: PositionRow | null; canFile: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [level, setLevel] = useState(draft?.pay_level ?? 'specialist');
	const [mult, setMult] = useState('7');
	const [budget, setBudget] = useState(draft?.posting_budget_cents != null ? String(draft.posting_budget_cents / 100) : '');
	const figures = useMemo(() => payTarget(Number(mult), level, 1, config.levels, config.progression), [mult, level, config]);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await filePositionRequest(fd);
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setMsg({ ok: true, text: 'Filed. Alex sees it in the Innovation Desk pipeline; approval covers the annual cost and the posting spend.' });
			router.push('/hiring/requests');
			router.refresh();
		});
	return (
		<Card className="space-y-3">
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{draft ? `Request approval for “${draft.title}”` : 'Request a position'}</h2>
			{!canFile && <Callout tone="warning">Only people managers file a position request. Ask an admin to add you to the people-managers group.</Callout>}
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			<form action={submit} className="grid sm:grid-cols-3 gap-3">
				{draft && <input type="hidden" name="position_id" value={draft.id} />}
				<Input name="role_title" label="Role title" required minLength={2} maxLength={160} defaultValue={draft?.title ?? ''} readOnly={!!draft} className="sm:col-span-2" disabled={!canFile} />
				<Select name="brand" label="Brand" defaultValue={draft?.brand ?? 'main'} disabled={!canFile}>
					{HIRE_BRANDS.map((b) => (
						<option key={b} value={b}>
							{HIRE_BRAND_LABELS[b]}
						</option>
					))}
				</Select>
				<Select name="department" label="Department" defaultValue={draft?.department_label ?? ''} disabled={!canFile}>
					<option value="">—</option>
					{departments.map((d) => (
						<option key={d.id} value={d.label}>
							{d.label}
						</option>
					))}
				</Select>
				<Select name="employment_type" label="Employment" defaultValue={draft?.employment_type ?? 'full_time'} disabled={!canFile}>
					{EMPLOYMENT_TYPES.map((t) => (
						<option key={t} value={t}>
							{EMPLOYMENT_TYPE_LABELS[t]}
						</option>
					))}
				</Select>
				<Input name="headcount" label="How many" type="number" min={1} max={50} defaultValue={draft?.headcount ?? 1} disabled={!canFile} />
				<Select name="hiring_manager_id" label="Hiring manager (chosen before posting)" defaultValue={draft?.hiring_manager_id ?? ''} disabled={!canFile}>
					<option value="">— me —</option>
					{people.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</Select>
				<Input name="target_start_on" label="Target start" type="date" defaultValue={draft?.target_start_on ?? ''} disabled={!canFile} />
				<Input name="posting_budget_usd" label="Posting / ad spend (USD)" type="number" min={0} step={10} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 for free boards only" disabled={!canFile} />
				<Select name="pay_level" label="Position level" value={level} onChange={(e) => setLevel(e.target.value)} disabled={!canFile}>
					{config.levels.filter((l) => l.is_active).map((l) => (
						<option key={l.slug} value={l.slug}>
							{l.label}
						</option>
					))}
				</Select>
				<Input name="pay_multiplier" label={`Multiplier (${config.progression.multiplier_min}–${config.progression.multiplier_max})`} type="number" step="0.5" min={1} max={100} value={mult} onChange={(e) => setMult(e.target.value)} disabled={!canFile} />
				<div className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
					<div className="text-2xs uppercase tracking-wide text-slate-500">First step, annual</div>
					<div className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{usd(figures?.annual_target_cents)}</div>
					<div className="text-2xs text-slate-500">{usd(figures?.monthly_target_cents)}/mo · base {usd(figures?.monthly_base_cents)}</div>
				</div>
				<Textarea name="body_md" label="Why this role" rows={4} placeholder="What it owns, what breaks without it, what the time study / capacity data says." maxLength={8000} className="sm:col-span-3" disabled={!canFile} />
				<div className="sm:col-span-3">
					<Button type="submit" size="sm" loading={pending} disabled={!canFile}>
						File request
					</Button>
				</div>
			</form>
		</Card>
	);
}
