'use client';

// Pipelines section (spec 2026-10-19 §5). Tables read cleanly; every edit
// opens a Dialog with structured fields: required fields as chips over real
// deal columns, the landing stage as a Select of the target pipeline's
// stages, the outbound GHL pipeline / stage as Selects, counts-as as chips.
// Slugs are fixed once created (they are handles other systems reference).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { deleteStage, saveDisposition, savePipeline, saveStage } from '@/app/(app)/prospects/actions';
import { COUNTS_AS_OPTIONS, LEGACY_COUNTS_AS, REQUIRED_FIELD_OPTIONS } from '@/lib/revenue/adminOptions';
import { BRANDS, BRAND_LABELS, LANES, LANE_LABELS, stagesByPipeline, type DispositionRow, type PipelineRow, type StageRow } from '@/lib/revenue/shared';
import ChipSelect from '../_ui/ChipSelect';
import ConfirmAction from '@/components/ui/ConfirmAction';
import Dialog from '@/components/ui/Dialog';
import SettingsSection from '../_ui/SettingsSection';

type Pipe = PipelineRow & { ghl_pipeline_id: string | null };
type Stage = StageRow & { ghl_stage_id: string | null };
type GhlStage = { id: string; pipelineId: string | null; name: string };
type Result = { ok: true } | { ok: false; error: string };

const COUNTS_LABEL = Object.fromEntries(COUNTS_AS_OPTIONS.map((o) => [o.value, o.label]));
const OUTCOME_LABEL = { open: 'Open', won: 'Won', lost: 'Lost' } as const;
const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2';
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function useSave(onDone: () => void) {
	const router = useRouter();
	const { toast } = useToast();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const run = (fn: () => Promise<Result>, message: string) =>
		start(async () => {
			setError(null);
			const r = await fn();
			if (!r.ok) {
				setError(r.error);
				return;
			}
			toast({ message, variant: 'success' });
			onDone();
			router.refresh();
		});
	return { error, pending, run, setError };
}

function Segmented<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string }) {
	return (
		<div role="radiogroup" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
			{options.map((o) => (
				<button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
					className={clsx('border-r border-slate-300 px-3 py-1 text-xs last:border-r-0 dark:border-slate-600', value === o.value ? 'bg-primary-50 font-semibold text-primary-900 dark:bg-primary-950 dark:text-primary-300' : 'hover:bg-hover')}>
					{o.label}
				</button>
			))}
		</div>
	);
}

// ------------------------------------------------------------ pipeline dialog

function PipelineDialog({ pipeline, ghlPipelines, onClose }: { pipeline: Pipe | null; ghlPipelines: { id: string; name: string }[]; onClose: () => void }) {
	const [name, setName] = useState(pipeline?.name ?? '');
	const [slug, setSlug] = useState(pipeline?.slug ?? '');
	const [lane, setLane] = useState(pipeline?.lane ?? 'lead_gen');
	const [brand, setBrand] = useState<string>(pipeline?.brand ?? 'main');
	const [position, setPosition] = useState(String(pipeline?.position ?? 100));
	const [active, setActive] = useState(pipeline?.is_active ?? true);
	const [description, setDescription] = useState(pipeline?.description ?? '');
	const [ghl, setGhl] = useState(pipeline?.ghl_pipeline_id ?? '');
	const { error, pending, run } = useSave(onClose);
	const save = () => {
		const fd = new FormData();
		if (pipeline) fd.set('id', pipeline.id);
		fd.set('name', name);
		fd.set('slug', pipeline ? pipeline.slug : slug || slugify(name));
		fd.set('lane', lane);
		fd.set('brand', brand);
		fd.set('position', position);
		if (active) fd.set('is_active', 'on');
		fd.set('description', description);
		fd.set('ghl_pipeline_id', ghl);
		run(() => savePipeline(fd), pipeline ? `${name} saved` : `${name} created`);
	};
	return (
		<Dialog open onClose={onClose} title={pipeline ? `Edit pipeline · ${pipeline.name}` : 'New pipeline'}
			footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" loading={pending} onClick={save}>Save pipeline</Button></>}>
			<div className="grid gap-3 sm:grid-cols-2">
				<Input label="Name" value={name} onChange={(e) => { setName(e.target.value); if (!pipeline) setSlug(slugify(e.target.value)); }} />
				<Input label={pipeline ? 'Slug (fixed — referenced by intake, GHL and SQL)' : 'Slug'} value={pipeline ? pipeline.slug : slug} disabled={!!pipeline} onChange={(e) => setSlug(slugify(e.target.value))} />
				<Select label="Lane" value={lane} onChange={(e) => setLane(e.target.value as Pipe['lane'])}>
					{LANES.map((l) => <option key={l} value={l}>{LANE_LABELS[l]}</option>)}
				</Select>
				<Select label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
					{[...BRANDS, 'all' as const].map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}
				</Select>
				<Select label="GHL pipeline (outbound push)" value={ghl} onChange={(e) => setGhl(e.target.value)}>
					<option value="">Not linked</option>
					{ghl && !ghlPipelines.some((g) => g.id === ghl) && <option value={ghl}>{ghl} (not in the stage map)</option>}
					{ghlPipelines.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
				</Select>
				<Input label="Position" type="number" value={position} onChange={(e) => setPosition(e.target.value)} />
				<div className="sm:col-span-2"><Textarea label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
				<label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
			</div>
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</Dialog>
	);
}

// ------------------------------------------------------------ stage dialog

function StageDialog({ stage, pipelineId, pipelines, stages, ghlStages, onClose }: { stage: Stage | null; pipelineId: string; pipelines: Pipe[]; stages: Stage[]; ghlStages: GhlStage[]; onClose: () => void }) {
	const pipe = pipelines.find((p) => p.id === pipelineId);
	const [name, setName] = useState(stage?.name ?? '');
	const [slug, setSlug] = useState(stage?.slug ?? '');
	const [probability, setProbability] = useState(String(stage?.probability ?? 0));
	const [sla, setSla] = useState(stage?.sla_hours ? String(stage.sla_hours) : '');
	const [position, setPosition] = useState(String(stage?.position ?? 100));
	const [outcome, setOutcome] = useState<Stage['outcome']>(stage?.outcome ?? 'open');
	const [required, setRequired] = useState<string[]>(stage?.required_fields ?? []);
	const [handoff, setHandoff] = useState(stage?.handoff_pipeline_id ?? '');
	const [landing, setLanding] = useState(stage?.handoff_stage_slug ?? '');
	const [ghl, setGhl] = useState(stage?.ghl_stage_id ?? '');
	const { error, pending, run } = useSave(onClose);
	const targetStages = stages.filter((s) => s.pipeline_id === handoff).sort((a, b) => a.position - b.position);
	const landingUnknown = !!handoff && !!landing && !targetStages.some((s) => s.slug === landing);
	const ghlOptions = ghlStages.filter((g) => !pipe?.ghl_pipeline_id || g.pipelineId === pipe.ghl_pipeline_id);
	const save = () => {
		const fd = new FormData();
		if (stage) fd.set('id', stage.id);
		fd.set('pipeline_id', pipelineId);
		fd.set('name', name);
		fd.set('slug', stage ? stage.slug : slug || slugify(name));
		fd.set('probability', probability);
		fd.set('sla_hours', sla);
		fd.set('position', position);
		fd.set('outcome', outcome);
		for (const r of required) fd.append('required_fields', r);
		fd.set('handoff_pipeline_id', handoff);
		fd.set('handoff_stage_slug', handoff ? landing : '');
		fd.set('ghl_stage_id', ghl);
		run(() => saveStage(fd), stage ? `${name} saved` : `${name} added`);
	};
	return (
		<Dialog open onClose={onClose} title={stage ? `Edit stage · ${stage.name} (${pipe?.name ?? ''})` : `New stage · ${pipe?.name ?? ''}`}
			footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" loading={pending} onClick={save}>Save stage</Button></>}>
			<div className="grid gap-3 sm:grid-cols-2">
				<Input label="Name" value={name} onChange={(e) => { setName(e.target.value); if (!stage) setSlug(slugify(e.target.value)); }} />
				<Input label={stage ? 'Slug (fixed — used by GHL and metrics)' : 'Slug'} value={stage ? stage.slug : slug} disabled={!!stage} onChange={(e) => setSlug(slugify(e.target.value))} />
				<Input label="Probability %" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} />
				<Input label="SLA (hours, blank = none)" type="number" min={1} value={sla} onChange={(e) => setSla(e.target.value)} />
				<Input label="Position" type="number" value={position} onChange={(e) => setPosition(e.target.value)} />
				<div>
					<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Outcome</p>
					<Segmented ariaLabel="Outcome" value={outcome} onChange={setOutcome} options={(['open', 'won', 'lost'] as const).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))} />
				</div>
				<div className="sm:col-span-2">
					<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Required before a deal enters this stage</p>
					<ChipSelect ariaLabel="Required fields" options={REQUIRED_FIELD_OPTIONS} value={required} onChange={setRequired} />
				</div>
				<Select label="Hands off to" value={handoff} onChange={(e) => { setHandoff(e.target.value); setLanding(''); }}>
					<option value="">No hand-off</option>
					{pipelines.filter((p) => p.id !== pipelineId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
				</Select>
				<Select label="Landing stage" value={landing} disabled={!handoff} onChange={(e) => setLanding(e.target.value)}>
					<option value="">First stage</option>
					{landingUnknown && <option value={landing}>{landing} (not in that pipeline)</option>}
					{targetStages.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
				</Select>
				{landingUnknown && <p className="text-xs text-amber-700 sm:col-span-2 dark:text-amber-300">The saved landing stage &ldquo;{landing}&rdquo; is not in the target pipeline, so the hand-off would not happen. Pick one.</p>}
				<div className="sm:col-span-2">
					<Select label="GHL stage (outbound push)" value={ghl} onChange={(e) => setGhl(e.target.value)}>
						<option value="">Not linked</option>
						{ghl && !ghlOptions.some((g) => g.id === ghl) && <option value={ghl}>{ghl} (not in the stage map)</option>}
						{ghlOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
					</Select>
				</div>
			</div>
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</Dialog>
	);
}

// ------------------------------------------------------------ outcome dialog

function OutcomeDialog({ outcome, onClose }: { outcome: DispositionRow | null; onClose: () => void }) {
	const [name, setName] = useState(outcome?.name ?? '');
	const [slug, setSlug] = useState(outcome?.slug ?? '');
	const [kind, setKind] = useState<DispositionRow['kind']>(outcome?.kind ?? 'call');
	const [counts, setCounts] = useState<string[]>(outcome?.counts_as ?? []);
	const [position, setPosition] = useState(String(outcome?.position ?? 100));
	const [active, setActive] = useState(outcome?.is_active ?? true);
	const { error, pending, run } = useSave(onClose);
	const save = () => {
		const fd = new FormData();
		if (outcome) fd.set('id', outcome.id);
		fd.set('name', name);
		fd.set('slug', outcome ? outcome.slug : slug || slugify(name));
		fd.set('kind', kind);
		for (const c of counts) fd.append('counts_as', c);
		fd.set('position', position);
		if (active) fd.set('is_active', 'on');
		run(() => saveDisposition(fd), outcome ? `${name} saved` : `${name} added`);
	};
	return (
		<Dialog open onClose={onClose} title={outcome ? `Edit outcome · ${outcome.name}` : 'New call outcome'} maxWidth="max-w-lg"
			footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" loading={pending} onClick={save}>Save outcome</Button></>}>
			<div className="grid gap-3 sm:grid-cols-2">
				<Input label="Name" value={name} onChange={(e) => { setName(e.target.value); if (!outcome) setSlug(slugify(e.target.value)); }} />
				<Input label={outcome ? 'Slug (fixed)' : 'Slug'} value={outcome ? outcome.slug : slug} disabled={!!outcome} onChange={(e) => setSlug(slugify(e.target.value))} />
				<Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as DispositionRow['kind'])}>
					<option value="call">Call</option>
					<option value="dm">DM / SMS</option>
					<option value="email">Email</option>
					<option value="meeting">Meeting</option>
				</Select>
				<Input label="Position" type="number" value={position} onChange={(e) => setPosition(e.target.value)} />
				<div className="sm:col-span-2">
					<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Counts toward (daily metrics)</p>
					<ChipSelect ariaLabel="Counts as" options={COUNTS_AS_OPTIONS} keepUnknown={LEGACY_COUNTS_AS} value={counts} onChange={setCounts} />
				</div>
				<label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
			</div>
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</Dialog>
	);
}

// ------------------------------------------------------------ section

export default function PipelinesSection({ pipelines, stages, dispositions, ghlPipelines, ghlStages, canManage }: {
	pipelines: Pipe[];
	stages: Stage[];
	dispositions: DispositionRow[];
	ghlPipelines: { id: string; name: string }[];
	ghlStages: GhlStage[];
	canManage: boolean;
}) {
	const router = useRouter();
	const byPipe = useMemo(() => stagesByPipeline(stages) as Map<string, Stage[]>, [stages]);
	const ghlName = useMemo(() => new Map(ghlStages.map((g) => [g.id, g.name])), [ghlStages]);
	const [pipeDialog, setPipeDialog] = useState<Pipe | 'new' | null>(null);
	const [stageDialog, setStageDialog] = useState<{ stage: Stage | null; pipelineId: string } | null>(null);
	const [outcomeDialog, setOutcomeDialog] = useState<DispositionRow | 'new' | null>(null);
	const pipeName = (id: string | null) => pipelines.find((p) => p.id === id)?.name ?? '—';

	return (
		<>
			{pipelines.map((p) => {
				const list = byPipe.get(p.id) ?? [];
				return (
					<SettingsSection
						key={p.id}
						padded={false}
						title={<span className="inline-flex items-center gap-2">{p.name}{!p.is_active && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-2xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">Inactive</span>}</span>}
						description={`${LANE_LABELS[p.lane]} lane · ${BRAND_LABELS[p.brand]} · ${list.length} stage${list.length === 1 ? '' : 's'}`}
						actions={canManage && <Button size="sm" variant="ghost" onClick={() => setPipeDialog(p)}>Edit pipeline</Button>}
					>
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-slate-200 dark:border-slate-700">
										<th className={th}>#</th><th className={th}>Stage</th><th className={th}>Outcome</th><th className={clsx(th, 'text-right')}>Prob.</th><th className={clsx(th, 'text-right')}>SLA</th><th className={th}>Required</th><th className={th}>Hand-off</th><th className={th}>GHL stage</th>{canManage && <th className={th} />}
									</tr>
								</thead>
								<tbody>
									{list.map((s) => {
										const landing = s.handoff_pipeline_id ? (stages.find((x) => x.pipeline_id === s.handoff_pipeline_id && x.slug === s.handoff_stage_slug)?.name ?? (s.handoff_stage_slug ? `${s.handoff_stage_slug}?` : 'first stage')) : null;
										return (
											<tr key={s.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
												<td className={clsx(td, 'tabular-nums text-slate-500')}>{s.position}</td>
												<td className={clsx(td, 'font-semibold text-slate-900 dark:text-slate-100')}>{s.name}</td>
												<td className={td}>{OUTCOME_LABEL[s.outcome]}</td>
												<td className={clsx(td, 'text-right tabular-nums')}>{s.probability}%</td>
												<td className={clsx(td, 'text-right tabular-nums')}>{s.sla_hours ? `${s.sla_hours}h` : '—'}</td>
												<td className={clsx(td, 'text-xs text-slate-600 dark:text-slate-400')}>{s.required_fields.map((r) => REQUIRED_FIELD_OPTIONS.find((o) => o.value === r)?.label ?? r).join(', ') || '—'}</td>
												<td className={clsx(td, 'whitespace-nowrap')}>{landing ? `→ ${pipeName(s.handoff_pipeline_id)} · ${landing}` : '—'}</td>
												<td className={clsx(td, 'text-xs text-slate-600 dark:text-slate-400')}>{s.ghl_stage_id ? (ghlName.get(s.ghl_stage_id) ?? 'Linked') : '—'}</td>
												{canManage && (
													<td className={clsx(td, 'whitespace-nowrap text-right')}>
														<Button size="sm" variant="ghost" onClick={() => setStageDialog({ stage: s, pipelineId: p.id })}>Edit</Button>
														<ConfirmAction size="sm" variant="ghost" label="Delete" title={`Delete stage ${s.name}?`} confirmLabel="Delete stage"
															impact={<p>The stage is removed from {p.name}. This is refused while any deal sits in it.</p>}
															onConfirm={async () => { const r = await deleteStage({ id: s.id }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: `${s.name} deleted` } : r; }} />
													</td>
												)}
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						{canManage && <div className="border-t border-slate-200 px-4 py-2 dark:border-slate-700"><Button size="sm" variant="ghost" onClick={() => setStageDialog({ stage: null, pipelineId: p.id })}>+ Add stage</Button></div>}
					</SettingsSection>
				);
			})}
			{canManage && <div><Button size="sm" variant="secondary" onClick={() => setPipeDialog('new')}>+ New pipeline</Button></div>}

			<SettingsSection title="Call outcomes" description="What a rep picks after each call, DM, email or meeting — and what it counts toward in the daily metrics" padded={false}
				actions={canManage && <Button size="sm" variant="ghost" onClick={() => setOutcomeDialog('new')}>+ Add outcome</Button>}>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className={th}>Outcome</th><th className={th}>Kind</th><th className={th}>Counts toward</th><th className={th}>Active</th>{canManage && <th className={th} />}</tr></thead>
						<tbody>
							{dispositions.map((d) => (
								<tr key={d.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
									<td className={clsx(td, 'font-semibold text-slate-900 dark:text-slate-100')}>{d.name}</td>
									<td className={clsx(td, 'capitalize')}>{d.kind === 'dm' ? 'DM / SMS' : d.kind}</td>
									<td className={clsx(td, 'text-xs')}>{d.counts_as.filter((c) => COUNTS_LABEL[c]).map((c) => COUNTS_LABEL[c]).join(', ') || '—'}</td>
									<td className={td}>{d.is_active ? 'Yes' : 'No'}</td>
									{canManage && <td className={clsx(td, 'text-right')}><Button size="sm" variant="ghost" onClick={() => setOutcomeDialog(d)}>Edit</Button></td>}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</SettingsSection>

			{pipeDialog && <PipelineDialog pipeline={pipeDialog === 'new' ? null : pipeDialog} ghlPipelines={ghlPipelines} onClose={() => setPipeDialog(null)} />}
			{stageDialog && <StageDialog stage={stageDialog.stage} pipelineId={stageDialog.pipelineId} pipelines={pipelines} stages={stages} ghlStages={ghlStages} onClose={() => setStageDialog(null)} />}
			{outcomeDialog && <OutcomeDialog outcome={outcomeDialog === 'new' ? null : outcomeDialog} onClose={() => setOutcomeDialog(null)} />}
		</>
	);
}
