'use client';

// MQL forms (spec 2026-10-19 §7): which forms feed the engine, their
// defaults (Selects over real pipelines / sources / channels / motions), the
// answer map as rows (engine field ← form question) and one small form per
// routing outcome instead of raw JSON. "Public" asks before going live.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { saveFormLink } from '@/app/(app)/prospects/scoringActions';
import { INTAKE_KEY_GROUPS, isKnownPipeline, serializeRows } from '@/lib/revenue/adminOptions';
import type { FormLinkRow } from '@/lib/revenue/server';
import { CHANNELS, MOTIONS, MOTION_LABELS, SOURCES, SOURCE_LABELS } from '@/lib/revenue/shared';
import ConfirmAction from '@/components/ui/ConfirmAction';
import KeyValueRows, { rowsFromMap, type KvRow } from '../_ui/KeyValueRows';
import SettingsSection from '../_ui/SettingsSection';

export type FormDef = { id: string; slug: string; title: string; questions: { value: string; label: string }[] };
type Copy = { title: string; body: string; cta_label: string; cta_url: string };
const OUTCOMES: { key: string; label: string }[] = [
	{ key: 'book_call', label: 'Book a call (qualified)' },
	{ key: 'setter_outreach', label: 'A setter reaches out' },
	{ key: 'nurture', label: 'Nurture (not a fit yet)' },
	{ key: 'beacon_offer', label: 'Beacon offer' },
];
const CHANNEL_OPTIONS = [...CHANNELS, 'ads'];

function copyFrom(v: unknown): Copy {
	const o = (v ?? {}) as Partial<Record<keyof Copy, unknown>>;
	return { title: String(o.title ?? ''), body: String(o.body ?? ''), cta_label: String(o.cta_label ?? ''), cta_url: String(o.cta_url ?? '') };
}

function FormLinkCard({ link, form, pipelines, canManage, appUrl }: { link: FormLinkRow; form: FormDef | undefined; pipelines: { slug: string; name: string }[]; canManage: boolean; appUrl: string }) {
	const router = useRouter();
	const { toast } = useToast();
	const [enabled, setEnabled] = useState(link.enabled);
	const [pipeline, setPipeline] = useState(link.default_pipeline);
	const [source, setSource] = useState(link.default_source);
	const [channel, setChannel] = useState(link.default_channel ?? '');
	const [motion, setMotion] = useState(link.default_motion);
	const [rows, setRows] = useState<KvRow[]>(rowsFromMap(link.field_map));
	const [copy, setCopy] = useState<Record<string, Copy>>(() => Object.fromEntries(OUTCOMES.map((o) => [o.key, copyFrom(link.routing_copy?.[o.key])])));
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const slug = link.form?.slug ?? form?.slug ?? '';
	const pipelineOk = isKnownPipeline(pipeline, pipelines.map((p) => p.slug));

	const payload = (isPublic: boolean): FormData | string => {
		const map = serializeRows(rows);
		if (!map.ok) return map.error;
		const routing = Object.fromEntries(
			Object.entries(copy)
				.filter(([, c]) => c.title || c.body || c.cta_label || c.cta_url)
				.map(([k, c]) => [k, Object.fromEntries(Object.entries(c).filter(([, v]) => v))]),
		);
		const fd = new FormData();
		fd.set('form_id', link.form_id);
		if (enabled) fd.set('enabled', 'on');
		if (isPublic) fd.set('public', 'on');
		fd.set('default_pipeline', pipeline);
		fd.set('default_source', source);
		fd.set('default_channel', channel);
		fd.set('default_motion', motion);
		fd.set('field_map', JSON.stringify(map.map));
		fd.set('routing_copy', JSON.stringify(routing));
		return fd;
	};
	const save = (isPublic: boolean, message: string) =>
		new Promise<{ ok: true } | { ok: false; error: string }>((resolve) =>
			start(async () => {
				setError(null);
				if (!pipelineOk) {
					setError('Pick a pipeline that exists.');
					return resolve({ ok: false, error: 'Pick a pipeline that exists.' });
				}
				const fd = payload(isPublic);
				if (typeof fd === 'string') {
					setError(fd);
					return resolve({ ok: false, error: fd });
				}
				const r = await saveFormLink(fd);
				if (!r.ok) setError(r.error);
				else {
					toast({ message, variant: 'success' });
					router.refresh();
				}
				resolve(r.ok ? { ok: true } : r);
			}),
		);

	return (
		<SettingsSection
			title={link.form?.title ?? slug}
			description={link.public ? `Public at ${appUrl}/intake/${slug}` : 'Signed-in only'}
			actions={
				<>
					<Link href={`/data/forms/${slug}`} className="text-xs font-semibold text-primary-800 hover:underline dark:text-primary-300">Edit questions</Link>
					{canManage && <Button size="sm" loading={pending} onClick={() => void save(link.public, 'Form settings saved')}>Save</Button>}
				</>
			}
		>
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-4">
					<label className="flex items-center gap-2 text-sm"><Checkbox checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} /> Feeds the engine</label>
					{canManage && (link.public ? (
						<Button size="sm" variant="ghost" onClick={() => void save(false, 'Form is signed-in only now')}>Make signed-in only</Button>
					) : (
						<ConfirmAction label="Make public…" title="Make this form public?" confirmLabel="Make public"
							impact={<p>Anyone with the link can submit <code>{appUrl}/intake/{slug}</code> without signing in. Each submission creates a person and a deal.</p>}
							onConfirm={async () => { const r = await save(true, 'Form is public'); return r.ok ? { ok: true } : r; }} />
					))}
				</div>
				<div className="grid gap-3 sm:grid-cols-4">
					<Select label="Lands in pipeline" value={pipeline} disabled={!canManage} onChange={(e) => setPipeline(e.target.value)}>
						{!pipelineOk && <option value={pipeline}>{pipeline} (unknown)</option>}
						{pipelines.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
					</Select>
					<Select label="Source" value={source} disabled={!canManage} onChange={(e) => setSource(e.target.value)}>
						{!(SOURCES as readonly string[]).includes(source) && <option value={source}>{source}</option>}
						{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
					</Select>
					<Select label="Channel" value={channel} disabled={!canManage} onChange={(e) => setChannel(e.target.value)}>
						<option value="">—</option>
						{CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
					</Select>
					<Select label="Motion" value={motion} disabled={!canManage} onChange={(e) => setMotion(e.target.value)}>
						{MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
					</Select>
				</div>
				{!pipelineOk && <Callout tone="warning">This form points at a pipeline that does not exist (&ldquo;{pipeline}&rdquo;); submissions would be rejected. Pick one and save.</Callout>}
				<div>
					<p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Answer map — which form question fills each engine field</p>
					<KeyValueRows rows={rows} onChange={setRows} keyGroups={INTAKE_KEY_GROUPS} valueOptions={form?.questions ?? []} keyLabel="Engine field" valueLabel="Form question" disabled={!canManage} />
				</div>
				<div>
					<p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">What the lead sees after submitting</p>
					<div className="grid gap-3 lg:grid-cols-2">
						{OUTCOMES.map((o) => (
							<div key={o.key} className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
								<p className="text-xs font-semibold">{o.label}</p>
								<Input label="Title" value={copy[o.key].title} disabled={!canManage} onChange={(e) => setCopy((c) => ({ ...c, [o.key]: { ...c[o.key], title: e.target.value } }))} />
								<Textarea label="Message" rows={2} value={copy[o.key].body} disabled={!canManage} onChange={(e) => setCopy((c) => ({ ...c, [o.key]: { ...c[o.key], body: e.target.value } }))} />
								<div className="grid gap-2 sm:grid-cols-2">
									<Input label="Button label" value={copy[o.key].cta_label} disabled={!canManage} onChange={(e) => setCopy((c) => ({ ...c, [o.key]: { ...c[o.key], cta_label: e.target.value } }))} />
									<Input label="Button link" type="url" value={copy[o.key].cta_url} disabled={!canManage} onChange={(e) => setCopy((c) => ({ ...c, [o.key]: { ...c[o.key], cta_url: e.target.value } }))} />
								</div>
							</div>
						))}
					</div>
				</div>
				{error && <Callout tone="error">{error}</Callout>}
			</div>
		</SettingsSection>
	);
}

export default function FormsSection({ links, forms, pipelines, canManage, appUrl }: { links: FormLinkRow[]; forms: FormDef[]; pipelines: { slug: string; name: string }[]; canManage: boolean; appUrl: string }) {
	const router = useRouter();
	const { toast } = useToast();
	const [pick, setPick] = useState('');
	const [pending, start] = useTransition();
	const linked = new Set(links.map((l) => l.form_id));
	const unlinked = forms.filter((f) => !linked.has(f.id));
	const link = () =>
		start(async () => {
			const fd = new FormData();
			fd.set('form_id', pick);
			fd.set('enabled', 'on');
			fd.set('default_pipeline', pipelines.find((p) => p.slug === 'marketing')?.slug ?? pipelines[0]?.slug ?? 'marketing');
			fd.set('default_source', 'organic');
			fd.set('default_channel', 'web');
			fd.set('default_motion', 'pr');
			fd.set('field_map', '{}');
			fd.set('routing_copy', '{}');
			const r = await saveFormLink(fd);
			if (!r.ok) toast({ message: r.error, variant: 'error' });
			else {
				toast({ message: 'Form linked', variant: 'success' });
				setPick('');
				router.refresh();
			}
		});
	return (
		<>
			<h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">MQL forms</h2>
			{links.length === 0 && <p className="text-sm text-slate-500">No form feeds the engine yet.</p>}
			{links.map((l) => (
				<FormLinkCard key={l.form_id} link={l} form={forms.find((f) => f.id === l.form_id)} pipelines={pipelines} canManage={canManage} appUrl={appUrl} />
			))}
			{canManage && unlinked.length > 0 && (
				<div className="flex flex-wrap items-end gap-2">
					<Select label="Link another form" value={pick} onChange={(e) => setPick(e.target.value)} className="w-64">
						<option value="">Pick a form…</option>
						{unlinked.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
					</Select>
					<Button size="sm" variant="secondary" disabled={!pick} loading={pending} onClick={link}>Link form</Button>
				</div>
			)}
		</>
	);
}
