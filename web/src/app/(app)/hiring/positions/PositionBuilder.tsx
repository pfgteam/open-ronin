'use client';

// Position builder (0128, H1). One form: identity + reporting line, the 4R
// (start from a template, AI-draft, or type), the posting's compensation
// statement, and the PAP pay link (multiplier × level × step) with live
// figures mirrored from hire_pay_target(). Comp saves to its own table.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { PositionCompRow, PositionRow, StaffOption } from '@/lib/hiring/server';
import type { HiringConfig } from '@/lib/hiring/server';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, HIRE_BRANDS, HIRE_BRAND_LABELS, LOCATION_TYPES, LOCATION_TYPE_LABELS, payTarget, renderPosting, slugify, usd, type FourRText } from '@/lib/hiring/shared';
import { draftPositionFourR, savePosition, savePositionComp } from '../actions';

type Template = { slug: string; position_label: string; department: string | null; reports_to: string | null; role_md: string; responsibilities_md: string; results_md: string; requirements_md: string };

export default function PositionBuilder({
	position,
	comp,
	config,
	templates,
	people,
	catalogs,
	canManage,
	canSeeComp,
}: {
	position: PositionRow | null;
	comp: PositionCompRow | null;
	config: HiringConfig;
	templates: Template[];
	people: StaffOption[];
	catalogs: { departments: { id: string; label: string }[]; pap: { slug: string; label: string }[]; tracks: { slug: string; label: string }[] };
	canManage: boolean;
	canSeeComp: boolean;
}) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [title, setTitle] = useState(position?.title ?? '');
	const [slug, setSlug] = useState(position?.slug ?? '');
	const [brand, setBrand] = useState(position?.brand ?? 'main');
	const [dept, setDept] = useState(position?.department_tag_id ?? '');
	const [fourR, setFourR] = useState<FourRText>({
		position_label: position?.title ?? '',
		department: position?.department_label ?? null,
		reports_to: position?.reports_to_label ?? null,
		role_md: position?.role_md ?? '',
		responsibilities_md: position?.responsibilities_md ?? '',
		results_md: position?.results_md ?? '',
		requirements_md: position?.requirements_md ?? '',
	});
	const [templateSlug, setTemplateSlug] = useState(position?.four_r_template_slug ?? '');
	const [brief, setBrief] = useState('');
	const [compState, setCompState] = useState({ multiplier: comp?.pay_multiplier ? String(comp.pay_multiplier) : '7', level: comp?.pay_level ?? position?.pay_level ?? 'specialist', step: String(comp?.step ?? 1) });
	const [preview, setPreview] = useState(false);
	const [compensation, setCompensation] = useState(position?.compensation_statement ?? '');
	const [aboutOverride, setAboutOverride] = useState(position?.about_us_override_md ?? '');
	const disabled = !canManage;
	const deptLabel = catalogs.departments.find((d) => d.id === dept)?.label ?? null;
	const brandProfile = config.brands.find((b) => b.brand === brand) ?? null;
	const figures = useMemo(() => payTarget(Number(compState.multiplier), compState.level, Number(compState.step), config.levels, config.progression), [compState, config]);
	const levelRow = config.levels.find((l) => l.slug === compState.level);

	const applyTemplate = (s: string) => {
		setTemplateSlug(s);
		const t = templates.find((x) => x.slug === s);
		if (!t) return;
		setFourR((cur) => ({
			...cur,
			reports_to: cur.reports_to || t.reports_to,
			role_md: t.role_md,
			responsibilities_md: t.responsibilities_md,
			results_md: t.results_md,
			requirements_md: t.requirements_md,
		}));
	};

	const aiDraft = () =>
		start(async () => {
			setMsg(null);
			if (!title.trim()) return setMsg({ ok: false, text: 'Give the position a title first.' });
			const r = await draftPositionFourR({ title, brand, department: deptLabel, brief: brief || null, template_slug: templateSlug || null });
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setFourR((cur) => ({ ...cur, ...r.draft, position_label: title }));
			setMsg({ ok: true, text: 'Drafted. Review every line before saving: the AI writes the role, you own it.' });
		});

	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await savePosition(fd);
			if (!r.ok) return setMsg({ ok: false, text: r.error });
			setMsg({ ok: true, text: 'Saved.' });
			if (!position) router.push(`/hiring/positions/${r.id}`);
			else router.refresh();
		});

	const submitComp = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await savePositionComp(fd);
			setMsg(r.ok ? { ok: true, text: 'Pay link saved; figures recomputed by the ladder.' } : { ok: false, text: r.error });
			router.refresh();
		});

	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{!canManage && <Callout tone="info">Read-only: the position builder needs the manage_hiring capability (admin/exec hold it). People managers file a position request instead.</Callout>}
			<form action={submit} className="space-y-4">
				{position && <input type="hidden" name="id" value={position.id} />}
				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Role</h2>
					<div className="grid sm:grid-cols-3 gap-3">
						<Input name="title" label="Title" required minLength={2} maxLength={160} value={title} onChange={(e) => { setTitle(e.target.value); if (!position) setSlug(slugify(e.target.value)); }} disabled={disabled} className="sm:col-span-2" />
						<Input name="slug" label="Slug (careers URL)" value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9][a-z0-9-]{1,80}" disabled={disabled} />
						<Select name="brand" label="Brand" value={brand} onChange={(e) => setBrand(e.target.value as typeof brand)} disabled={disabled}>
							{HIRE_BRANDS.map((b) => (
								<option key={b} value={b}>
									{HIRE_BRAND_LABELS[b]}
								</option>
							))}
						</Select>
						<Select name="department_tag_id" label="Department" value={dept} onChange={(e) => setDept(e.target.value)} disabled={disabled}>
							<option value="">—</option>
							{catalogs.departments.map((d) => (
								<option key={d.id} value={d.id}>
									{d.label}
								</option>
							))}
						</Select>
						<input type="hidden" name="department_label" value={deptLabel ?? ''} />
						<Input name="reports_to_label" label="Reports to (position)" value={fourR.reports_to ?? ''} onChange={(e) => setFourR({ ...fourR, reports_to: e.target.value })} maxLength={120} disabled={disabled} />
						<Select name="pap_position" label="PAP specialty" defaultValue={position?.pap_position ?? ''} disabled={disabled}>
							<option value="">—</option>
							{catalogs.pap.map((p) => (
								<option key={p.slug} value={p.slug}>
									{p.label}
								</option>
							))}
						</Select>
						<Select name="position_track" label="Position track" defaultValue={position?.position_track ?? ''} disabled={disabled}>
							<option value="">—</option>
							{catalogs.tracks.map((t) => (
								<option key={t.slug} value={t.slug}>
									{t.label}
								</option>
							))}
						</Select>
						<Select name="employment_type" label="Employment" defaultValue={position?.employment_type ?? 'full_time'} disabled={disabled}>
							{EMPLOYMENT_TYPES.map((t) => (
								<option key={t} value={t}>
									{EMPLOYMENT_TYPE_LABELS[t]}
								</option>
							))}
						</Select>
						<Select name="location_type" label="Location" defaultValue={position?.location_type ?? 'remote'} disabled={disabled}>
							{LOCATION_TYPES.map((t) => (
								<option key={t} value={t}>
									{LOCATION_TYPE_LABELS[t]}
								</option>
							))}
						</Select>
						<Input name="location_text" label="Location detail" defaultValue={position?.location_text ?? ''} placeholder="HQ, TN · or · Remote (LATAM / PH)" maxLength={120} disabled={disabled} />
						<Input name="timezone_note" label="Hours / timezone" defaultValue={position?.timezone_note ?? ''} placeholder="CST business hours" maxLength={160} disabled={disabled} />
						<Input name="headcount" label="Headcount" type="number" min={1} max={50} defaultValue={position?.headcount ?? 1} disabled={disabled} />
						<Select name="hiring_manager_id" label="Hiring manager" defaultValue={position?.hiring_manager_id ?? ''} disabled={disabled}>
							<option value="">—</option>
							{people.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</Select>
						<Select name="recruiter_id" label="Recruiter / owner" defaultValue={position?.recruiter_id ?? ''} disabled={disabled}>
							<option value="">—</option>
							{people.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</Select>
						<Input name="target_start_on" label="Target start" type="date" defaultValue={position?.target_start_on ?? ''} disabled={disabled} />
						<Input name="posting_budget_usd" label="Posting / ad budget (USD)" type="number" min={0} step={10} defaultValue={position?.posting_budget_cents != null ? position.posting_budget_cents / 100 : ''} disabled={disabled} />
					</div>
				</Card>

				<Card className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">4R</h2>
						<span className="text-2xs text-slate-500">Role · Responsibilities · Results · Requirements. The posting, the scorecards and the AI scoring all read from this.</span>
					</div>
					<div className="grid sm:grid-cols-3 gap-3 items-end">
						<Select name="four_r_template_slug" label="Start from a template" value={templateSlug} onChange={(e) => applyTemplate(e.target.value)} disabled={disabled}>
							<option value="">— none —</option>
							{templates.map((t) => (
								<option key={t.slug} value={t.slug}>
									{t.position_label}
									{t.department ? ` (${t.department})` : ''}
								</option>
							))}
						</Select>
						<Input label="Brief for the AI (optional)" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="what this role owns, who it supports, what breaks without it" maxLength={2000} disabled={disabled} className="sm:col-span-1" />
						<div>
							<Button type="button" variant="outline" size="sm" onClick={aiDraft} loading={pending} disabled={disabled}>
								AI draft the 4R
							</Button>
						</div>
					</div>
					<Textarea name="role_md" label="Role" rows={4} value={fourR.role_md} onChange={(e) => setFourR({ ...fourR, role_md: e.target.value })} disabled={disabled} />
					<Textarea name="responsibilities_md" label="Responsibilities (one per line, '- ')" rows={8} value={fourR.responsibilities_md} onChange={(e) => setFourR({ ...fourR, responsibilities_md: e.target.value })} disabled={disabled} />
					<Textarea name="results_md" label="Results" rows={5} value={fourR.results_md} onChange={(e) => setFourR({ ...fourR, results_md: e.target.value })} disabled={disabled} />
					<Textarea name="requirements_md" label="Requirements" rows={6} value={fourR.requirements_md} onChange={(e) => setFourR({ ...fourR, requirements_md: e.target.value })} disabled={disabled} />
				</Card>

				<Card className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Posting</h2>
					<Textarea name="compensation_statement" label="Compensation statement (free text; no number range by default)" rows={2} value={compensation} onChange={(e) => setCompensation(e.target.value)} placeholder="Small base with the majority in commission scaling well beyond $100k; performance-based advancement system with clear steps." maxLength={600} disabled={disabled} />
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
						<Checkbox name="show_pay_range" defaultChecked={position?.show_pay_range ?? false} disabled={disabled} /> Show the pay range on the posting (off by default)
					</label>
					<Textarea name="about_us_override_md" label={`About Us override (blank = the ${HIRE_BRAND_LABELS[brand]} blurb from Admin → Hiring → Brands)`} rows={3} value={aboutOverride} onChange={(e) => setAboutOverride(e.target.value)} maxLength={8000} disabled={disabled} />
					<Textarea name="notes_md" label="Internal notes" rows={2} defaultValue={position?.notes_md ?? ''} maxLength={8000} disabled={disabled} />
					<div className="flex items-center gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={() => setPreview(!preview)}>
							{preview ? 'Hide' : 'Preview'} posting
						</Button>
						{canManage && (
							<Button type="submit" size="sm" loading={pending}>
								{position ? 'Save position' : 'Create position'}
							</Button>
						)}
					</div>
					{preview && <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-md p-3 border border-slate-200 dark:border-slate-700">{renderPosting({ title: title || 'Untitled', compensation_statement: compensation || null, about_us_override_md: aboutOverride || null, ...fourR }, brandProfile)}</pre>}
				</Card>
			</form>

			{position && (
				<Card className="space-y-3">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pay link (PAP)</h2>
						<Badge>multiplier × level · first step for a new hire</Badge>
					</div>
					{!canSeeComp ? (
						<p className="text-sm text-slate-500">Salary is visible to execs and this role&apos;s hiring manager.</p>
					) : (
						<form action={submitComp} className="grid sm:grid-cols-4 gap-3 items-end">
							<input type="hidden" name="position_id" value={position.id} />
							<Input name="pay_multiplier" label={`Multiplier (${config.progression.multiplier_min}–${config.progression.multiplier_max})`} type="number" step="0.5" min={1} max={100} value={compState.multiplier} onChange={(e) => setCompState({ ...compState, multiplier: e.target.value })} disabled={disabled} />
							<Select name="pay_level" label="Position level" value={compState.level} onChange={(e) => setCompState({ ...compState, level: e.target.value, step: '1' })} disabled={disabled}>
								{config.levels.filter((l) => l.is_active).map((l) => (
									<option key={l.slug} value={l.slug}>
										{l.label}
									</option>
								))}
							</Select>
							<Select name="step" label="Step" value={compState.step} onChange={(e) => setCompState({ ...compState, step: e.target.value })} disabled={disabled}>
								{Array.from({ length: levelRow?.steps ?? 3 }, (_, i) => i + 1).map((s) => (
									<option key={s} value={s}>
										{s === 1 ? '1 (Jr — new hire)' : s === 2 ? '2 (Mid)' : s === 3 ? '3 (Sr)' : String(s)}
									</option>
								))}
							</Select>
							{canManage && (
								<Button type="submit" size="sm" loading={pending}>
									Save pay link
								</Button>
							)}
							<div className="sm:col-span-4 grid sm:grid-cols-4 gap-3 text-sm">
								<Fig label="Monthly target" value={usd(figures?.monthly_target_cents)} />
								<Fig label="Base" value={usd(figures?.monthly_base_cents)} hint={`${levelRow?.base_pct ?? 85}%`} />
								<Fig label="Performance" value={usd(figures?.monthly_performance_cents)} />
								<Fig label="Annual target" value={usd(figures?.annual_target_cents)} hint={comp ? `saved ${usd(comp.annual_target_cents)}` : 'not saved yet'} />
							</div>
							<Input name="pay_range_min_usd" label="Posting range min (optional)" type="number" min={0} defaultValue={comp?.pay_range_min_cents != null ? comp.pay_range_min_cents / 100 : ''} disabled={disabled} />
							<Input name="pay_range_max_usd" label="Posting range max (optional)" type="number" min={0} defaultValue={comp?.pay_range_max_cents != null ? comp.pay_range_max_cents / 100 : ''} disabled={disabled} />
							<Input name="comp_notes_md" label="Comp notes" defaultValue={comp?.comp_notes_md ?? ''} maxLength={4000} disabled={disabled} className="sm:col-span-2" />
						</form>
					)}
				</Card>
			)}
		</div>
	);
}

function Fig({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2">
			<div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div>
			<div className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
			{hint && <div className="text-2xs text-slate-500">{hint}</div>}
		</div>
	);
}
