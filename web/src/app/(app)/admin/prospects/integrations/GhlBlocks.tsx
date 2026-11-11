'use client';

// GoHighLevel, all in one place and in the order it is set up (spec
// 2026-10-19 §8): connection → inbound webhook → workflows to create in GHL
// → the two switches that change behaviour → stage map → settings →
// backfill → sync log. Every external side effect goes through
// ConfirmAction with the live numbers.

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { Check, Copy, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { addPrivateTokenConnection, disconnectGhl, replaySyncLog, runGhlBackfillNow, saveGhlSettings, saveStageMapRow, setCutover, startGhlBackfill, testGhlConnection } from '@/app/(app)/prospects/ghlActions';
import { issueIntakeToken, revokeIntakeToken } from '@/app/(app)/prospects/scoringActions';
import { CUTOVER_SWITCHES } from '@/lib/revenue/adminOptions';
import type { CutoverRow, GhlConnectionView, GhlSettingRow, StageMapRow } from '@/lib/revenue/server';
import type { BackfillRunRow } from '@/lib/revenue/ghlImport';
import ChipSelect from '../_ui/ChipSelect';
import ConfirmAction from '@/components/ui/ConfirmAction';
import { createRunGuard, runLoop } from '../_ui/runLoop';
import SettingsSection from '../_ui/SettingsSection';

type LogRow = { id: string; direction: string; kind: string; status: string; deal_id: string | null; summary: string | null; error: string | null; attempts: number; created_at: string };
type Pipe = { id: string; slug: string; name: string };
type Stage = { id: string; pipelineId: string; slug: string; name: string; position: number };

const WORKFLOWS: { trigger: string; type: string }[] = [
	{ trigger: 'Opportunity Created', type: 'OpportunityCreate' },
	{ trigger: 'Pipeline Stage Changed', type: 'OpportunityStageUpdate' },
	{ trigger: 'Opportunity Status Changed (filter: Status moved to)', type: 'OpportunityStatusUpdate' },
	{ trigger: 'Customer Replied', type: 'InboundMessage' },
	{ trigger: 'Appointment Status', type: 'AppointmentUpdate' },
];
const ICP_BANDS = ['0-7', '8-15', '16-20'];
const SETTING_LABELS: Record<string, string> = {
	heat_field_key: 'Heat → GHL contact field key',
	quality_field_key: 'Quality → GHL contact field key',
	quality_tag_prefix: 'Quality tag prefix',
	source_tag: 'Tag on every pushed contact',
	opportunity_name_suffix: 'Opportunity name suffix',
	app_base_url: 'GHL app URL (for "Open in GHL" links)',
};
const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2';

function useRefreshToast() {
	const router = useRouter();
	const { toast } = useToast();
	return { router, toast };
}

function Toggle({ on, label }: { on: boolean; label: string }) {
	return (
		<span role="img" aria-label={`${label}: ${on ? 'on' : 'off'}`} className={clsx('relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600')}>
			<span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', on ? 'left-4.5' : 'left-0.5')} />
		</span>
	);
}

// ------------------------------------------------------------ 1 · connection

function ConnectionCard({ connections, canManage }: { connections: GhlConnectionView[]; canManage: boolean }) {
	const { router, toast } = useRefreshToast();
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const add = (fd: FormData) =>
		start(async () => {
			setError(null);
			const r = await addPrivateTokenConnection(fd);
			if (!r.ok) return setError(r.error);
			toast({ message: `Connected${r.name ? ` · ${r.name}` : ''}`, variant: 'success' });
			setAdding(false);
			router.refresh();
		});
	const test = (id: string) =>
		start(async () => {
			const r = await testGhlConnection({ id });
			toast({ message: r.ok ? `Connection works${r.name ? ` · ${r.name}` : ''}` : r.error, variant: r.ok ? 'success' : 'error' });
			router.refresh();
		});
	return (
		<SettingsSection title="1 · GoHighLevel connection" description="The sub-account the app reads from and pushes to">
			{connections.length === 0 && <p className="text-sm text-slate-500">No GHL sub-account connected.</p>}
			<ul className="space-y-2">
				{connections.map((c) => (
					<li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						<span className={clsx('h-2 w-2 rounded-full', c.last_error ? 'bg-red-500' : 'bg-green-500')} aria-hidden="true" />
						<b>{c.label ?? 'GHL'}</b>
						<span className="text-xs text-slate-500">location <code>{c.ghl_location_id}</code> · {c.auth_kind === 'private_token' ? 'private token' : 'marketplace app'}{c.org ? ` · ${c.org.toUpperCase()}` : ''}{c.is_default ? ' · default' : ''}</span>
						<span className="text-xs text-slate-500">{c.last_error ? <span className="text-red-600 dark:text-red-400">{c.last_error}</span> : c.last_ok_at ? `tested ${formatRelative(c.last_ok_at)}` : ''}</span>
						{canManage && (
							<span className="ml-auto flex gap-1">
								<Button size="sm" variant="ghost" loading={pending} onClick={() => test(c.id)}>Test</Button>
								<ConfirmAction size="sm" variant="ghost" label="Disconnect…" title={`Disconnect ${c.label ?? 'this sub-account'}?`} confirmLabel="Disconnect"
									impact={<p>Pushes, backfills and stage reads for this sub-account stop until it is connected again.</p>}
									onConfirm={async () => { const r = await disconnectGhl({ id: c.id }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: 'Disconnected' } : r; }} />
							</span>
						)}
					</li>
				))}
			</ul>
			{canManage && (adding ? (
				<form action={add} className="mt-3 grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">
					<Input name="label" label="Label" placeholder="Open Ronin" required />
					<Input name="ghl_location_id" label="Location id" required />
					<Input name="token" label="Private integration token" type="password" required />
					<Select name="org" label="Brand" defaultValue="main">
						<option value="main">Open Ronin</option><option value="premium">Premium</option><option value="beacon">Beacon</option><option value="">Any</option>
					</Select>
					<label className="flex items-center gap-2 text-sm"><Checkbox name="is_default" /> Default connection</label>
					<div className="flex justify-end gap-2 sm:col-span-2">
						<Button size="sm" variant="secondary" type="button" onClick={() => setAdding(false)}>Cancel</Button>
						<Button size="sm" type="submit" loading={pending}>Connect and test</Button>
					</div>
					{error && <Callout tone="error" className="sm:col-span-2">{error}</Callout>}
				</form>
			) : (
				<p className="mt-3 text-xs text-slate-500">
					<button type="button" className="font-semibold text-primary-800 hover:underline dark:text-primary-300" onClick={() => setAdding(true)}>Add a private-token connection</button>
					{' '}· or install the marketplace app in <Link href="/admin/integrations/ghl" className="underline">Admin → Connections</Link>.
				</p>
			))}
		</SettingsSection>
	);
}

// ------------------------------------------------------------ 2 · webhook + 3 · workflows

function WebhookCards({ webhook, eventCounts, appUrl, canManage }: { webhook: { enabled: boolean; tokenIssuedAt: string | null; events: number; lastEventAt: string | null } | null; eventCounts: Record<string, number>; appUrl: string; canManage: boolean }) {
	const { router, toast } = useRefreshToast();
	const [fresh, setFresh] = useState<string | null>(null);
	const base = `${appUrl}/api/intake/ghl/webhook?token=`;
	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast({ message: 'Copied', variant: 'success' });
		} catch {
			toast({ message: 'Copy failed — select the text and copy it by hand.', variant: 'error' });
		}
	};
	return (
		<>
			<SettingsSection title="2 · Inbound webhook" description={webhook ? `GHL → Open Ronin · ${webhook.events.toLocaleString()} events${webhook.lastEventAt ? ` · last ${formatRelative(webhook.lastEventAt)}` : ''}` : 'Not set up'}>
				<div className="flex flex-wrap items-center gap-2">
					<code className="max-w-full truncate rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">{base}{webhook?.tokenIssuedAt ? '••••••••' : '(no token yet)'}</code>
					{webhook && !webhook.enabled && <span className="text-xs font-semibold text-red-600 dark:text-red-400">Disabled — GHL calls are rejected</span>}
					{canManage && (
						<span className="ml-auto flex gap-1">
							<ConfirmAction size="sm" variant="secondary" label={webhook?.tokenIssuedAt ? 'Rotate token…' : 'Create token…'} title={webhook?.tokenIssuedAt ? 'Rotate the GHL webhook token?' : 'Create the GHL webhook token?'} confirmLabel={webhook?.tokenIssuedAt ? 'Rotate token' : 'Create token'}
								impact={webhook?.tokenIssuedAt ? <p>The current URL stops working immediately: every GHL workflow below is rejected until you paste the new URL into each of the 5 workflows.</p> : <p>Creates the URL GHL workflows post to and enables the webhook.</p>}
								onConfirm={async () => { const r = await issueIntakeToken({ key: 'ghl' }); if (!r.ok) return r; setFresh(r.url); router.refresh(); return { ok: true }; }} />
							{webhook?.enabled && (
								<ConfirmAction size="sm" variant="ghost" label="Disable…" title="Disable the GHL webhook?" confirmLabel="Disable"
									impact={<p>GHL calls are rejected (stage changes, replies and new opportunities stop arriving) until a new token is created.</p>}
									onConfirm={async () => { const r = await revokeIntakeToken({ key: 'ghl' }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: 'Webhook disabled' } : r; }} />
							)}
						</span>
					)}
				</div>
				{fresh && (
					<Callout tone="success" className="mt-3">
						<p className="font-semibold">New URL — shown once. Paste it into each GHL workflow now.</p>
						<div className="mt-1 flex items-center gap-2"><code className="break-all text-xs">{fresh}</code><Button size="sm" variant="secondary" onClick={() => void copy(fresh)}><Copy className="h-3.5 w-3.5" />Copy</Button></div>
					</Callout>
				)}
			</SettingsSection>
			<SettingsSection title="3 · Workflows to create in GHL" description="Each one: trigger → Webhook action → POST to the URL above">
				<ul className="space-y-1.5 text-sm">
					{WORKFLOWS.map((w) => {
						const n = eventCounts[w.type] ?? 0;
						return (
							<li key={w.type} className="flex items-center gap-2">
								{n > 0 ? <Check className="h-4 w-4 text-green-600" aria-hidden="true" /> : <X className="h-4 w-4 text-red-500" aria-hidden="true" />}
								<span>{w.trigger}</span>
								<span className={clsx('ml-auto text-xs', n > 0 ? 'text-slate-500' : 'font-semibold text-red-600 dark:text-red-400')}>{n > 0 ? `${n.toLocaleString()} events in 30 days` : 'no events received in 30 days'}</span>
							</li>
						);
					})}
				</ul>
			</SettingsSection>
		</>
	);
}

// ------------------------------------------------------------ 4 · switches

function SwitchesCard({ cutover, eligible, canManage }: { cutover: CutoverRow[]; eligible: number; canManage: boolean }) {
	const { router, toast } = useRefreshToast();
	const get = (k: string) => cutover.find((c) => c.key === k);
	const push = get('push_prospects');
	const accept = get('accept_ghl_stage_changes');
	const pushOn = push?.owner === 'main';
	const acceptOn = accept?.owner === 'main';
	const info = cutover.filter((c) => !(CUTOVER_SWITCHES as readonly string[]).includes(c.key));
	const set = async (key: string, on: boolean) => {
		const r = await setCutover({ key, owner: on ? 'main' : 'off' });
		if (r.ok) router.refresh();
		return r;
	};
	return (
		<SettingsSection title="4 · Sync switches" description="The two settings that change what the app does">
			<div className="divide-y divide-slate-200 dark:divide-slate-700">
				<div className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold">Push prospects to GHL</p>
						<p className="text-xs text-slate-500">Contact, tags, scores and an opportunity once a deal has a positive reply or a booked call. <b>{eligible.toLocaleString()} deals</b> are eligible now.</p>
					</div>
					<Toggle on={pushOn} label="Push prospects to GHL" />
					{canManage && (pushOn ? (
						<Button size="sm" variant="secondary" onClick={async () => {
							const r = await set('push_prospects', false);
							toast(r.ok ? { message: 'Push to GHL is off', undo: async () => { await set('push_prospects', true); } } : { message: r.error, variant: 'error' });
						}}>Turn off</Button>
					) : (
						<ConfirmAction size="sm" variant="primary" tone="primary" label="Turn on…" title="Turn on push to GHL?" confirmLabel={`Turn on and send ${eligible.toLocaleString()}`}
							impact={<><p><b>{eligible.toLocaleString()} deals</b> are eligible and will be sent as contacts and opportunities, about 25 per minute (≈ {Math.max(1, Math.ceil(eligible / 25)).toLocaleString()} min to empty the queue).</p><p>Each contact gets the source tag and the Lead Score / MQL Score fields; GHL workflows that react to new opportunities will fire. Turning it off later stops new pushes; what was sent stays in GHL.</p></>}
							onConfirm={async () => { const r = await set('push_prospects', true); return r.ok ? { ok: true, message: 'Push to GHL is on' } : r; }} />
					))}
				</div>
				<div className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold">Accept stage changes from GHL</p>
						<p className="text-xs text-slate-500">A stage move in GHL moves the deal here too.{accept?.updated_at ? ` Changed ${formatRelative(accept.updated_at)}.` : ''}</p>
					</div>
					<Toggle on={acceptOn} label="Accept stage changes from GHL" />
					{canManage && (
						<ConfirmAction size="sm" variant="secondary" tone={acceptOn ? 'danger' : 'primary'} label={acceptOn ? 'Turn off…' : 'Turn on…'} title={acceptOn ? 'Stop accepting GHL stage changes?' : 'Accept stage changes from GHL?'} confirmLabel={acceptOn ? 'Turn off' : 'Turn on'}
							impact={acceptOn ? <p>GHL stage moves are only logged; deals here stay where they are until someone moves them in the app.</p> : <p>Every stage move made in GHL will move the matching deal here as well, overriding the app.</p>}
							onConfirm={async () => { const r = await set('accept_ghl_stage_changes', !acceptOn); return r.ok ? { ok: true, message: acceptOn ? 'Stage changes from GHL are off' : 'Stage changes from GHL are on' } : r; }} />
					)}
				</div>
			</div>
			{info.length > 0 && (
				<details className="mt-3 text-xs text-slate-600 dark:text-slate-400">
					<summary className="cursor-pointer">Who owns what (informational)</summary>
					<ul className="mt-2 space-y-1">
						{info.map((c) => <li key={c.key}>{c.label}: <b>{c.owner === 'ghl' ? 'GHL' : c.owner === 'main' ? 'Open Ronin' : 'Off'}</b>{c.note ? ` — ${c.note}` : ''}</li>)}
					</ul>
				</details>
			)}
		</SettingsSection>
	);
}

// ------------------------------------------------------------ 5 · stage map

function StageMapRowEditor({ row, pipelines, stages, canManage }: { row: StageMapRow; pipelines: Pipe[]; stages: Stage[]; canManage: boolean }) {
	const { router, toast } = useRefreshToast();
	const [pipe, setPipe] = useState(row.pipeline_slug);
	const [stage, setStage] = useState(row.stage_slug);
	const [icp, setIcp] = useState(row.icp_band ?? '');
	const [pending, start] = useTransition();
	const pipeId = pipelines.find((p) => p.slug === pipe)?.id;
	const options = stages.filter((s) => s.pipelineId === pipeId).sort((a, b) => a.position - b.position);
	const valid = !!pipeId && options.some((s) => s.slug === stage);
	const dirty = pipe !== row.pipeline_slug || stage !== row.stage_slug || icp !== (row.icp_band ?? '');
	const save = () =>
		start(async () => {
			const r = await saveStageMapRow({ ghl_stage_id: row.ghl_stage_id, pipeline_slug: pipe, stage_slug: stage, icp_band: icp || null });
			toast(r.ok ? { message: `${row.ghl_stage_name} mapped`, variant: 'success' } : { message: r.error, variant: 'error' });
			if (r.ok) router.refresh();
		});
	return (
		<tr className={clsx('border-b border-slate-200 last:border-b-0 dark:border-slate-700', !valid && 'bg-amber-50 dark:bg-amber-950/30')}>
			<td className={clsx(td, 'text-sm')}>{row.ghl_stage_name}</td>
			<td className={td}>
				<div className="flex flex-wrap gap-2">
					<Select size="sm" aria-label={`Pipeline for ${row.ghl_stage_name}`} value={pipe} disabled={!canManage} onChange={(e) => { setPipe(e.target.value); setStage(''); }} className="w-36">
						{!pipelines.some((p) => p.slug === pipe) && <option value={pipe}>{pipe} (unknown)</option>}
						{pipelines.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
					</Select>
					<Select size="sm" aria-label={`Stage for ${row.ghl_stage_name}`} value={stage} disabled={!canManage} onChange={(e) => setStage(e.target.value)} className="w-44">
						{!valid && <option value={stage}>{stage ? `${stage} (not in pipeline)` : 'Pick a stage'}</option>}
						{options.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
					</Select>
				</div>
			</td>
			<td className={td}>
				<Select size="sm" aria-label={`ICP band for ${row.ghl_stage_name}`} value={icp} disabled={!canManage} onChange={(e) => setIcp(e.target.value)} className="w-24">
					<option value="">—</option>
					{ICP_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
				</Select>
			</td>
			<td className={clsx(td, 'text-right')}>{canManage && dirty && <Button size="sm" loading={pending} disabled={!valid} onClick={save}>Save</Button>}</td>
		</tr>
	);
}

function StageMapCard({ stageMap, pipelines, stages, canManage }: { stageMap: StageMapRow[]; pipelines: Pipe[]; stages: Stage[]; canManage: boolean }) {
	const groups = useMemo(() => {
		const m = new Map<string, StageMapRow[]>();
		for (const r of stageMap) m.set(r.ghl_pipeline_name, [...(m.get(r.ghl_pipeline_name) ?? []), r]);
		return [...m.entries()];
	}, [stageMap]);
	return (
		<SettingsSection title="5 · Stage map (GHL → app)" description={`${stageMap.length} GHL stages — where an imported or moved opportunity lands`} padded={false}>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className={th}>GHL stage</th><th className={th}>Goes to</th><th className={th}>ICP band</th><th className={th} /></tr></thead>
					{groups.map(([name, rows]) => (
						<tbody key={name}>
							<tr className="bg-slate-50 dark:bg-slate-900/30"><td colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">{name}</td></tr>
							{rows.map((r) => <StageMapRowEditor key={r.ghl_stage_id} row={r} pipelines={pipelines} stages={stages} canManage={canManage} />)}
						</tbody>
					))}
				</table>
			</div>
		</SettingsSection>
	);
}

// ------------------------------------------------------------ 6 · settings

function SettingsCard({ settings, stages, pipelines, canManage }: { settings: GhlSettingRow[]; stages: Stage[]; pipelines: Pipe[]; canManage: boolean }) {
	const { router, toast } = useRefreshToast();
	const text = settings.filter((s) => s.key in SETTING_LABELS);
	const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(text.map((s) => [s.key, typeof s.value === 'string' ? s.value : JSON.stringify(s.value ?? '')])));
	const minStages = settings.find((s) => s.key === 'push_min_stage_slugs');
	const [slugs, setSlugs] = useState<string[]>(Array.isArray(minStages?.value) ? (minStages?.value as string[]) : []);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const slugOptions = useMemo(() => {
		const by = new Map<string, string[]>();
		for (const s of stages) {
			const p = pipelines.find((x) => x.id === s.pipelineId);
			if (!p) continue;
			by.set(s.slug, [...(by.get(s.slug) ?? []), `${p.name} · ${s.name}`]);
		}
		return [...by.entries()].map(([slug, names]) => ({ value: slug, label: names.join(' / ') }));
	}, [stages, pipelines]);
	const save = () =>
		start(async () => {
			setError(null);
			const fd = new FormData();
			for (const [k, v] of Object.entries(vals)) fd.set(`set:${k}`, v);
			if (minStages) fd.set('set:push_min_stage_slugs', JSON.stringify(slugs));
			const r = await saveGhlSettings(fd);
			if (!r.ok) return setError(r.error);
			toast({ message: 'GHL settings saved', variant: 'success' });
			router.refresh();
		});
	return (
		<SettingsSection title="6 · GHL settings" description="How pushed contacts and opportunities look in GHL" actions={canManage && <Button size="sm" loading={pending} onClick={save}>Save</Button>}>
			<div className="grid gap-3 sm:grid-cols-2">
				{text.map((s) => (
					<div key={s.key}>
						<Input label={SETTING_LABELS[s.key]} type={s.key === 'app_base_url' ? 'url' : 'text'} value={vals[s.key] ?? ''} disabled={!canManage} onChange={(e) => setVals((v) => ({ ...v, [s.key]: e.target.value }))} />
						{s.key === 'opportunity_name_suffix' && <p className="mt-1 text-2xs text-slate-500">Appended as typed (· marks a space): <span className="font-mono">&ldquo;Acme{(vals[s.key] ?? '').replace(/ /g, '·')}&rdquo;</span></p>}
					</div>
				))}
			</div>
			{minStages && (
				<div className="mt-4">
					<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Push deals that reach these stages (even without a positive reply)</p>
					<ChipSelect ariaLabel="Push from stages" options={slugOptions} value={slugs} onChange={setSlugs} disabled={!canManage} />
				</div>
			)}
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</SettingsSection>
	);
}

// ------------------------------------------------------------ 7 · backfill

function BackfillCard({ runs, ghlNames, canManage }: { runs: BackfillRunRow[]; ghlNames: Record<string, string>; canManage: boolean }) {
	const { router, toast } = useRefreshToast();
	const [progress, setProgress] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [guard] = useState(createRunGuard);
	const totals = runs.reduce((t, r) => ({ fetched: t.fetched + r.fetched, imported: t.imported + r.imported, existed: t.existed + r.existed, skipped: t.skipped + r.skipped, failed: t.failed + r.failed }), { fetched: 0, imported: 0, existed: 0, skipped: 0, failed: 0 });
	const done = runs.filter((r) => r.state === 'done').length;
	const run = async () => {
		if (!guard.tryStart()) return { ok: false as const, error: 'A backfill is already running on this page.' };
		setRunning(true);
		const s = await startGhlBackfill();
		if (!s.ok) {
			guard.finish();
			setRunning(false);
			return s;
		}
		void (async () => {
			let imported = 0;
			const out = await runLoop(async () => {
				const r = await runGhlBackfillNow();
				if (!r.ok) return { ok: false, error: r.error };
				if (!r.chunk) return { ok: true, done: true };
				imported += r.chunk.imported;
				setProgress(`${imported.toLocaleString()} imported so far · ${r.chunk.ghl_status} in ${ghlNames[r.chunk.ghl_pipeline_id] ?? 'a GHL pipeline'}`);
				return r.chunk.error ? { ok: false, error: `Backfill stopped: ${r.chunk.error}` } : { ok: true, done: false };
			}, 400);
			setProgress(null);
			setRunning(false);
			guard.finish();
			toast(out.error ? { message: `${out.error} (${imported.toLocaleString()} imported before it stopped)`, variant: 'error' } : { message: `Backfill pass finished: ${imported.toLocaleString()} imported`, variant: 'success' });
			router.refresh();
		})();
		return { ok: true as const };
	};
	return (
		<SettingsSection title="7 · Backfill from GHL" description={runs.length === 0 ? 'Not run yet' : `${done} / ${runs.length} runs done · safe to run again (existing records are skipped)`}>
			<div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
				{(['fetched', 'imported', 'existed', 'skipped', 'failed'] as const).map((k) => (
					<div key={k} className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-900">
						<div className="capitalize text-slate-500">{k}</div>
						<div className="text-sm tabular-nums text-slate-900 dark:text-slate-100">{totals[k].toLocaleString()}</div>
					</div>
				))}
			</div>
			{progress && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{progress} — keep this page open</p>}
			{canManage && (
				<div className="mt-3">
					<ConfirmAction label={runs.length === 0 ? 'Start backfill…' : 'Resume backfill…'} title="Import from GHL?" confirmLabel="Start importing" tone="primary" disabled={running}
						impact={<><p>Imports open opportunities plus 12 months of won, lost and abandoned for every mapped GHL pipeline. New people, brands and deals are created; records already imported are counted as existing.</p><p>Runs in 45-second chunks — keep this page open.</p></>}
						onConfirm={run} />
				</div>
			)}
		</SettingsSection>
	);
}

// ------------------------------------------------------------ 8 · sync log

function SyncLogCard({ logs, total, page, size, pushOn, canManage }: { logs: LogRow[]; total: number; page: number; size: number; pushOn: boolean; canManage: boolean }) {
	const { router } = useRefreshToast();
	return (
		<SettingsSection title="8 · Sync log" description="Every push and webhook, newest first" padded={false}>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className={th}>When</th><th className={th}>Direction</th><th className={th}>What</th><th className={th}>Status</th><th className={th}>Detail</th>{canManage && <th className={th} />}</tr></thead>
					<tbody>
						{logs.map((l) => (
							<tr key={l.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
								<td className={clsx(td, 'whitespace-nowrap text-xs text-slate-500')}>{formatRelative(l.created_at)}</td>
								<td className={clsx(td, 'text-xs')}>{l.direction === 'outbound' ? 'App → GHL' : 'GHL → App'}</td>
								<td className={clsx(td, 'text-xs')}>{l.kind.replace(/_/g, ' ').replace('webhook:', 'webhook · ')}</td>
								<td className={td}><span className={clsx('text-xs font-semibold', l.status === 'ok' ? 'text-green-700 dark:text-green-400' : l.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-slate-500')}>{l.status === 'ok' ? 'OK' : l.status === 'skipped' ? 'Skipped' : l.status === 'retry' ? 'Retrying' : 'Failed'}</span></td>
								<td className={clsx(td, 'max-w-md truncate text-xs text-slate-600 dark:text-slate-400')}>{l.error ?? l.summary ?? '—'}</td>
								{canManage && (
									<td className={clsx(td, 'text-right')}>
										{l.deal_id && l.direction === 'outbound' && (
											<ConfirmAction size="sm" variant="ghost" label="Replay…" title="Send this deal to GHL again?" confirmLabel="Send to GHL"
												impact={<><p>Pushes the deal&apos;s contact and opportunity to GHL now.</p>{!pushOn && <p className="font-semibold text-amber-700 dark:text-amber-300">Push to GHL is off — this sends the deal anyway.</p>}</>}
												onConfirm={async () => { const r = await replaySyncLog({ id: l.id }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: 'Sent to GHL' } : r; }} />
										)}
									</td>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{total > size && <Pagination page={page} size={size} total={total} hrefFor={(p) => `/admin/prospects/integrations?log=${p}`} />}
		</SettingsSection>
	);
}

// ------------------------------------------------------------ all

export default function GhlBlocks(p: {
	connections: GhlConnectionView[];
	cutover: CutoverRow[];
	settings: GhlSettingRow[];
	stageMap: StageMapRow[];
	backfillRuns: BackfillRunRow[];
	logs: LogRow[];
	logTotal: number;
	logPage: number;
	logPageSize: number;
	eligible: number;
	webhook: { enabled: boolean; tokenIssuedAt: string | null; events: number; lastEventAt: string | null } | null;
	eventCounts: Record<string, number>;
	pipelines: Pipe[];
	stages: Stage[];
	appUrl: string;
	canManage: boolean;
}) {
	const ghlNames = Object.fromEntries(p.stageMap.map((r) => [r.ghl_pipeline_id, r.ghl_pipeline_name]));
	const pushOn = p.cutover.find((c) => c.key === 'push_prospects')?.owner === 'main';
	return (
		<>
			<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">GoHighLevel</h2>
			<ConnectionCard connections={p.connections} canManage={p.canManage} />
			<WebhookCards webhook={p.webhook} eventCounts={p.eventCounts} appUrl={p.appUrl} canManage={p.canManage} />
			<SwitchesCard cutover={p.cutover} eligible={p.eligible} canManage={p.canManage} />
			<StageMapCard stageMap={p.stageMap} pipelines={p.pipelines} stages={p.stages} canManage={p.canManage} />
			<SettingsCard settings={p.settings} stages={p.stages} pipelines={p.pipelines} canManage={p.canManage} />
			<BackfillCard runs={p.backfillRuns} ghlNames={ghlNames} canManage={p.canManage} />
			<SyncLogCard logs={p.logs} total={p.logTotal} page={p.logPage} size={p.logPageSize} pushOn={pushOn} canManage={p.canManage} />
		</>
	);
}
