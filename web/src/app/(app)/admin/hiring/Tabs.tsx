'use client';

// Admin → Hiring editors (0128): pay ladder + progression constants, brand
// About Us / Remuneration blocks, the application consent text.

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
import type { HiringConfig } from '@/lib/hiring/server';
import { HIRE_BRAND_LABELS, payTarget, usd, type PayLevelRow } from '@/lib/hiring/shared';
import { saveBrandProfile, saveConsent, savePayLevel, saveProgression } from '@/app/(app)/hiring/actions';

function useSubmit<T extends { ok: boolean; error?: string }>(fn: (fd: FormData) => Promise<T>, okText: string) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await fn(fd);
			setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error: string }).error });
			router.refresh();
		});
	return { submit, pending, msg };
}

export function PayLadderTab({ config, canManage, tracks }: { config: HiringConfig; canManage: boolean; tracks: { slug: string; label: string }[] }) {
	const level = useSubmit(savePayLevel, 'Level saved.');
	const prog = useSubmit(saveProgression, 'Progression saved.');
	const [showNew, setShowNew] = useState(false);
	const [mult, setMult] = useState('7');
	const Form = ({ l }: { l: PayLevelRow | null }) => (
		<form action={level.submit} className="grid sm:grid-cols-6 gap-2 items-end">
			<Input name="slug" label="Slug" defaultValue={l?.slug ?? ''} pattern="[a-z0-9-]+" required readOnly={!!l} disabled={!canManage} />
			<Input name="label" label="Label" defaultValue={l?.label ?? ''} required disabled={!canManage} />
			<Input name="sort" label="Sort" type="number" defaultValue={l?.sort ?? 100} disabled={!canManage} />
			<Input name="steps" label="Steps" type="number" min={1} max={6} defaultValue={l?.steps ?? 3} disabled={!canManage} />
			<Input name="base_pct" label="Base %" type="number" step="0.5" min={0} max={100} defaultValue={l?.base_pct ?? 85} disabled={!canManage} />
			<Input name="review_weeks" label="Review (weeks)" type="number" min={1} max={104} defaultValue={l?.review_weeks ?? 13} disabled={!canManage} />
			<Select name="position_track" label="Position track" defaultValue={l?.position_track ?? ''} disabled={!canManage}>
				<option value="">—</option>
				{tracks.map((t) => (
					<option key={t.slug} value={t.slug}>
						{t.label}
					</option>
				))}
			</Select>
			<Input name="notes" label="Notes" defaultValue={l?.notes ?? ''} className="sm:col-span-3" disabled={!canManage} />
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
				<Checkbox name="is_active" defaultChecked={l?.is_active ?? true} disabled={!canManage} /> Active
			</label>
			{canManage && (
				<Button type="submit" size="sm" loading={level.pending}>
					Save
				</Button>
			)}
		</form>
	);
	return (
		<div className="space-y-4">
			<Callout tone="info">
				V2 Pay System, decision 4: pay = multiplier × position level, first step for a new hire, country ignored. Start = multiplier × {config.progression.start_per_multiplier}; step 1 = start × {config.progression.first_step_factor}; each further step × {config.progression.step_factor} across the whole ladder. Base share per level (Tier 3 columns: 536 of 630 = 85%).
			</Callout>
			{(level.msg || prog.msg) && <Callout tone={(level.msg ?? prog.msg)!.ok ? 'success' : 'error'}>{(level.msg ?? prog.msg)!.text}</Callout>}
			<Card className="space-y-3">
				<div className="flex items-center gap-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ladder preview</h2>
					<Input label="Multiplier" type="number" step="0.5" value={mult} onChange={(e) => setMult(e.target.value)} className="w-28" />
				</div>
				<table className="w-full text-sm">
					<thead className="text-left text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
						<tr>
							<th className="py-1 pr-3">Level</th>
							<th className="py-1 pr-3">Step 1 (Jr)</th>
							<th className="py-1 pr-3">Step 2 (Mid)</th>
							<th className="py-1 pr-3">Step 3 (Sr)</th>
							<th className="py-1 pr-3">Annual @ step 1</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
						{config.levels.filter((l) => l.is_active).map((l) => {
							const f = [1, 2, 3].map((s) => payTarget(Number(mult), l.slug, s, config.levels, config.progression));
							return (
								<tr key={l.slug}>
									<td className="py-1 pr-3 text-slate-900 dark:text-slate-100">{l.label}</td>
									{f.map((x, i) => (
										<td key={i} className="py-1 pr-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
											{x ? `${usd(x.monthly_target_cents)} (${usd(x.monthly_base_cents)} + ${usd(x.monthly_performance_cents)})` : '—'}
										</td>
									))}
									<td className="py-1 pr-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{usd(f[0]?.annual_target_cents)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</Card>
			<Card className="space-y-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Progression constants</h2>
				<form action={prog.submit} className="grid sm:grid-cols-7 gap-2 items-end">
					<Input name="start_per_multiplier" label="Start per ×1" type="number" step="1" defaultValue={config.progression.start_per_multiplier} disabled={!canManage} />
					<Input name="first_step_factor" label="First step ×" type="number" step="0.001" defaultValue={config.progression.first_step_factor} disabled={!canManage} />
					<Input name="step_factor" label="Each step ×" type="number" step="0.001" defaultValue={config.progression.step_factor} disabled={!canManage} />
					<Input name="target_over_base" label="Target / base" type="number" step="0.01" defaultValue={config.progression.target_over_base} disabled={!canManage} />
					<Input name="multiplier_min" label="Multiplier min" type="number" defaultValue={config.progression.multiplier_min} disabled={!canManage} />
					<Input name="multiplier_max" label="Multiplier max" type="number" defaultValue={config.progression.multiplier_max} disabled={!canManage} />
					{canManage && (
						<Button type="submit" size="sm" loading={prog.pending}>
							Save
						</Button>
					)}
				</form>
			</Card>
			{config.levels.map((l) => (
				<Card key={l.slug} className="space-y-2">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{l.label}</h3>
						<Badge color={l.is_active ? 'success' : 'warning'}>{l.is_active ? 'active' : 'inactive'}</Badge>
					</div>
					<Form l={l} />
				</Card>
			))}
			{canManage && (
				<Card>
					<Button size="sm" variant={showNew ? 'ghost' : 'outline'} onClick={() => setShowNew(!showNew)}>
						{showNew ? 'Close' : '+ New level'}
					</Button>
					{showNew && (
						<div className="mt-3">
							<Form l={null} />
						</div>
					)}
				</Card>
			)}
		</div>
	);
}

export function BrandsTab({ config, canManage }: { config: HiringConfig; canManage: boolean }) {
	const s = useSubmit(saveBrandProfile, 'Brand profile saved.');
	return (
		<div className="space-y-4">
			<Callout tone="info">Posting format (round 3): Compensation line → About Us → Role → Responsibilities → Results → Requirements → Remuneration & Rewards. About Us and Remuneration come from here per brand; a position can override About Us.</Callout>
			{s.msg && <Callout tone={s.msg.ok ? 'success' : 'error'}>{s.msg.text}</Callout>}
			{config.brands.map((b) => (
				<Card key={b.brand} className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{HIRE_BRAND_LABELS[b.brand]}</h2>
					<form action={s.submit} className="grid sm:grid-cols-2 gap-3">
						<input type="hidden" name="brand" value={b.brand} />
						<Input name="label" label="Label" defaultValue={b.label} required disabled={!canManage} />
						<Input name="website" label="Website" defaultValue={b.website ?? ''} disabled={!canManage} />
						<Textarea name="about_us_md" label="About Us (markdown)" rows={7} defaultValue={b.about_us_md} className="sm:col-span-2" disabled={!canManage} />
						<Textarea name="remuneration_md" label="Remuneration & Rewards (markdown)" rows={5} defaultValue={b.remuneration_md} disabled={!canManage} />
						<Textarea name="careers_intro_md" label="Careers page intro (H2)" rows={5} defaultValue={b.careers_intro_md} disabled={!canManage} />
						{canManage && (
							<div className="sm:col-span-2">
								<Button type="submit" size="sm" loading={s.pending}>
									Save
								</Button>
							</div>
						)}
					</form>
				</Card>
			))}
		</div>
	);
}

export function ConsentTab({ config, canManage }: { config: HiringConfig; canManage: boolean }) {
	const s = useSubmit(saveConsent, 'Consent text saved as a new version; new applications record it.');
	const consent = (config.settings.consent ?? {}) as { version?: number; title?: string; body_md?: string };
	const retention = (config.settings.retention ?? {}) as { years?: number; auto_delete?: boolean };
	const senders = (config.settings.senders ?? {}) as { email?: string; sms_number?: string; sms_label?: string };
	return (
		<div className="space-y-4">
			<Callout tone="info">
				Every applicant accepts this before the first question (spec: consent first). Retention {retention.years ?? 10} years, auto-delete {retention.auto_delete ? 'on' : 'off'}. Senders: {senders.email ?? '—'} (email), {senders.sms_number ?? '—'} ({senders.sms_label ?? 'SMS'}).
			</Callout>
			{s.msg && <Callout tone={s.msg.ok ? 'success' : 'error'}>{s.msg.text}</Callout>}
			<Card className="space-y-3">
				<div className="flex items-center gap-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Application consent</h2>
					<Badge>v{consent.version ?? 1}</Badge>
				</div>
				<form action={s.submit} className="space-y-3">
					<Input name="title" label="Title" defaultValue={consent.title ?? 'Before you apply'} required disabled={!canManage} />
					<Textarea name="body_md" label="Body (markdown)" rows={12} defaultValue={consent.body_md ?? ''} required disabled={!canManage} />
					{canManage && (
						<Button type="submit" size="sm" loading={s.pending}>
							Save as new version
						</Button>
					)}
				</form>
			</Card>
		</div>
	);
}
