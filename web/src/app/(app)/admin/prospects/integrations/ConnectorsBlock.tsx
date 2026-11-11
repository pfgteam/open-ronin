'use client';

// Other lead sources (spec 2026-10-19 §8): connectors table with an amber
// warning when a connector points at a pipeline that does not exist (seven
// did: 'lead_gen' instead of 'lead-gen'), a Manage dialog with Selects and a
// row-based field map, the Lead Scraper link, and the Workflows pointer.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { Copy } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { issueIntakeToken, revokeIntakeToken, saveIntakeSource, setIntakeSourceEnabled } from '@/app/(app)/prospects/scoringActions';
import { sendScraperBacklog, setScraperConnector } from '@/app/(app)/prospects/scraperLinkActions';
import { INTAKE_KEY_GROUPS, isKnownPipeline, serializeRows } from '@/lib/revenue/adminOptions';
import type { IntakeSourceView } from '@/lib/revenue/server';
import { CHANNELS, MOTIONS, MOTION_LABELS, SOURCES, SOURCE_LABELS } from '@/lib/revenue/shared';
import ConfirmAction from '@/components/ui/ConfirmAction';
import { createRunGuard, runLoop } from '../_ui/runLoop';
import Dialog from '@/components/ui/Dialog';
import KeyValueRows, { rowsFromMap, type KvRow } from '../_ui/KeyValueRows';
import SettingsSection from '../_ui/SettingsSection';

type Pipe = { slug: string; name: string };
const CHANNEL_OPTIONS = [...CHANNELS, 'ads'];
const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2';

function ManageDialog({ source, pipelines, appUrl, canManage, onClose }: { source: IntakeSourceView; pipelines: Pipe[]; appUrl: string; canManage: boolean; onClose: () => void }) {
	const router = useRouter();
	const { toast } = useToast();
	const [label, setLabel] = useState(source.label);
	const [pipeline, setPipeline] = useState(source.default_pipeline);
	const [src, setSrc] = useState(source.default_source ?? '');
	const [channel, setChannel] = useState(source.default_channel ?? '');
	const [motion, setMotion] = useState(source.default_motion);
	const [rows, setRows] = useState<KvRow[]>(rowsFromMap(source.field_map));
	const [note, setNote] = useState(source.note ?? '');
	const [fresh, setFresh] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const pipelineOk = isKnownPipeline(pipeline, pipelines.map((p) => p.slug));
	const save = () =>
		start(async () => {
			setError(null);
			const map = serializeRows(rows);
			if (!map.ok) return setError(map.error);
			const fd = new FormData();
			fd.set('key', source.key);
			fd.set('label', label);
			fd.set('default_pipeline', pipeline);
			fd.set('default_source', src);
			fd.set('default_channel', channel);
			fd.set('default_motion', motion);
			fd.set('field_map', JSON.stringify(map.map));
			fd.set('note', note);
			if (source.enabled) fd.set('enabled', 'on');
			const r = await saveIntakeSource(fd);
			if (!r.ok) return setError(r.error);
			toast({ message: `${label} saved`, variant: 'success' });
			router.refresh();
			onClose();
		});
	return (
		<Dialog open onClose={onClose} title={`Connector · ${source.label}`} subtitle={`${source.kind} · ${source.event_count.toLocaleString()} events${source.last_event_at ? ` · last ${formatRelative(source.last_event_at)}` : ''}`}
			footer={canManage ? <><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" loading={pending} onClick={save}>Save connector</Button></> : undefined}>
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-2">
					<Input label="Label" value={label} disabled={!canManage} onChange={(e) => setLabel(e.target.value)} />
					<Select label="Lands in pipeline" value={pipeline} disabled={!canManage} onChange={(e) => setPipeline(e.target.value)}>
						{!pipelineOk && <option value={pipeline}>{pipeline} (does not exist)</option>}
						{pipelines.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
					</Select>
					<Select label="Source" value={src} disabled={!canManage} onChange={(e) => setSrc(e.target.value)}>
						<option value="">—</option>
						{src && !(SOURCES as readonly string[]).includes(src) && <option value={src}>{src}</option>}
						{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
					</Select>
					<Select label="Channel" value={channel} disabled={!canManage} onChange={(e) => setChannel(e.target.value)}>
						<option value="">—</option>
						{channel && !CHANNEL_OPTIONS.includes(channel) && <option value={channel}>{channel}</option>}
						{CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
					</Select>
					<Select label="Motion" value={motion} disabled={!canManage} onChange={(e) => setMotion(e.target.value)}>
						{MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
					</Select>
				</div>
				{!pipelineOk && <Callout tone="warning">&ldquo;{pipeline}&rdquo; is not a pipeline, so every lead from this connector would be rejected. Pick one and save before enabling it.</Callout>}
				{source.kind === 'webhook' && (
					<div>
						<p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Field map — which payload path fills each engine field</p>
						<KeyValueRows rows={rows} onChange={setRows} keyGroups={INTAKE_KEY_GROUPS} extraKeys={[{ value: 'external_id', label: 'External id (dedupe)' }]} valuePlaceholder="customData.budget" keyLabel="Engine field" valueLabel="Payload path" disabled={!canManage} />
					</div>
				)}
				<Textarea label="Note" rows={2} value={note} disabled={!canManage} onChange={(e) => setNote(e.target.value)} />
				{canManage && source.kind === 'webhook' && (
					<div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
						<span className="text-xs text-slate-500">{source.token_issued_at ? `Token issued ${formatRelative(source.token_issued_at)}` : 'No token yet'}</span>
						<span className="ml-auto flex gap-1">
							<ConfirmAction size="sm" variant="secondary" disabled={!pipelineOk} label={source.token_issued_at ? 'Rotate token…' : 'Issue token…'} title={source.token_issued_at ? `Rotate the ${source.label} token?` : `Issue a token for ${source.label}?`} confirmLabel={source.token_issued_at ? 'Rotate' : 'Issue token'}
								impact={source.token_issued_at ? <p>The current URL stops working immediately: {source.label} is rejected until it is re-pointed at the new URL.</p> : <p>Creates the URL {source.label} posts to and enables the connector.</p>}
								onConfirm={async () => { const r = await issueIntakeToken({ key: source.key }); if (!r.ok) return r; setFresh(r.url); router.refresh(); return { ok: true }; }} />
							{source.token_issued_at && (
								<ConfirmAction size="sm" variant="ghost" label="Revoke…" title={`Revoke the ${source.label} token?`} confirmLabel="Revoke and disable"
									impact={<p>{source.label} is rejected from now on and the connector is disabled.</p>}
									onConfirm={async () => { const r = await revokeIntakeToken({ key: source.key }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: `${source.label} disabled` } : r; }} />
							)}
						</span>
					</div>
				)}
				{fresh && (
					<Callout tone="success">
						<p className="font-semibold">New URL — shown once.</p>
						<div className="mt-1 flex items-center gap-2"><code className="break-all text-xs">{fresh}</code><Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(fresh).then(() => toast({ message: 'Copied', variant: 'success' }))}><Copy className="h-3.5 w-3.5" />Copy</Button></div>
					</Callout>
				)}
				{!fresh && source.kind === 'webhook' && <p className="text-2xs text-slate-500">URL format: <code>{appUrl}/api/intake/{source.key}?token=…</code></p>}
				{error && <Callout tone="error">{error}</Callout>}
			</div>
		</Dialog>
	);
}

function ScraperCard({ scraper, canManage }: { scraper: { enabled: boolean; sent: number; unsent: number }; canManage: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const [progress, setProgress] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [guard] = useState(createRunGuard);
	const send = async () => {
		if (!guard.tryStart()) return { ok: false as const, error: 'The backlog is already being sent from this page.' };
		setRunning(true);
		void (async () => {
			let total = 0;
			const out = await runLoop(async () => {
				const r = await sendScraperBacklog();
				if (!r.ok) return { ok: false, error: r.error };
				total += r.sent;
				setProgress(`${total.toLocaleString()} sent · ${r.remaining.toLocaleString()} left${r.failed ? ` · ${r.failed} failed in the last batch` : ''}`);
				return { ok: true, done: r.remaining === 0 || r.sent === 0 };
			}, 60);
			setProgress(null);
			setRunning(false);
			guard.finish();
			toast(out.error ? { message: `${out.error} (${total.toLocaleString()} sent before it stopped)`, variant: 'error' } : { message: `${total.toLocaleString()} leads sent to Lead Gen`, variant: 'success' });
			router.refresh();
		})();
		return { ok: true as const };
	};
	return (
		<SettingsSection title="Lead Scraper" description="Approving a lead in Tools → Lead Scraper creates the person, the brand and a deal in Lead Gen → Sourced">
			<p className="text-sm tabular-nums">{scraper.sent.toLocaleString()} in Prospects · <b>{scraper.unsent.toLocaleString()}</b> approved and not sent yet · link is <b>{scraper.enabled ? 'on' : 'off'}</b></p>
			{progress && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{progress} — keep this page open</p>}
			{canManage && (
				<div className="mt-3 flex flex-wrap gap-2">
					<ConfirmAction size="sm" variant="secondary" tone={scraper.enabled ? 'danger' : 'primary'} label={scraper.enabled ? 'Turn off…' : 'Turn on…'} title={scraper.enabled ? 'Turn off the Lead Scraper link?' : 'Turn on the Lead Scraper link?'} confirmLabel={scraper.enabled ? 'Turn off' : 'Turn on'}
						impact={scraper.enabled ? <p>Approving scraped leads only exports them (CSV); no deals are created.</p> : <p>Every approved scraped lead becomes a person, a brand and a Lead Gen deal.</p>}
						onConfirm={async () => { const r = await setScraperConnector({ enabled: !scraper.enabled }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: scraper.enabled ? 'Lead Scraper link off' : 'Lead Scraper link on' } : r; }} />
					{scraper.enabled && scraper.unsent > 0 && (
						<ConfirmAction size="sm" tone="primary" variant="primary" disabled={running} label={`Send ${scraper.unsent.toLocaleString()} approved leads…`} title="Send the approved backlog to Lead Gen?" confirmLabel={`Send ${scraper.unsent.toLocaleString()}`}
							impact={<p>Creates up to <b>{scraper.unsent.toLocaleString()}</b> people, brands and Lead Gen deals (existing people are reused by the dedupe), in batches of 200. Keep this page open.</p>}
							onConfirm={send} />
					)}
					<Link href="/admin/lead-scraper" className="self-center text-xs underline">Budgets and presets</Link>
				</div>
			)}
		</SettingsSection>
	);
}

export default function ConnectorsBlock({ sources, scraper, pipelines, appUrl, canManage }: { sources: IntakeSourceView[]; scraper: { enabled: boolean; sent: number; unsent: number }; pipelines: Pipe[]; appUrl: string; canManage: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const [toggling, startToggle] = useTransition();
	const [open, setOpen] = useState<IntakeSourceView | null>(null);
	const pipeName = (slug: string) => pipelines.find((p) => p.slug === slug)?.name;
	return (
		<>
			<h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other lead sources</h2>
			<SettingsSection title="Connectors" description="Webhooks and APIs that create prospects" padded={false}>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className={th}>Source</th><th className={th}>Status</th><th className={th}>Lands in</th><th className={clsx(th, 'text-right')}>Events</th><th className={th} /></tr></thead>
						<tbody>
							{sources.map((s) => {
								const ok = isKnownPipeline(s.default_pipeline, pipelines.map((p) => p.slug));
								return (
									<tr key={s.key} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
										<td className={clsx(td, 'font-semibold text-slate-900 dark:text-slate-100')}>{s.label}</td>
										<td className={td}>
											<span className="flex items-center gap-2">
												<span className={clsx('text-xs font-semibold', s.enabled ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>{s.enabled ? 'On' : 'Off'}</span>
												{canManage && (s.enabled ? (
													<ConfirmAction size="sm" variant="ghost" label="Turn off…" title={`Turn off ${s.label}?`} confirmLabel="Turn off"
														impact={<p>Incoming {s.label} leads are rejected until it is turned on again.</p>}
														onConfirm={async () => { const r = await setIntakeSourceEnabled({ key: s.key, enabled: false }); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: `${s.label} is off` } : r; }} />
												) : (
													<Button size="sm" variant="ghost" disabled={!ok || toggling} title={ok ? undefined : 'Pick an existing pipeline first'} onClick={() => startToggle(async () => {
														const r = await setIntakeSourceEnabled({ key: s.key, enabled: true });
														toast(r.ok ? { message: `${s.label} is on`, undo: async () => { await setIntakeSourceEnabled({ key: s.key, enabled: false }); router.refresh(); } } : { message: r.error, variant: 'error' });
														if (r.ok) router.refresh();
													})}>Turn on</Button>
												))}
											</span>
										</td>
										<td className={td}>
											{ok ? pipeName(s.default_pipeline) : <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Unknown pipeline &ldquo;{s.default_pipeline}&rdquo; — pick one before enabling</span>}
										</td>
										<td className={clsx(td, 'text-right tabular-nums')}>{s.event_count.toLocaleString()}</td>
										<td className={clsx(td, 'text-right')}><Button size="sm" variant="ghost" onClick={() => setOpen(s)}>{canManage ? 'Manage' : 'View'}</Button></td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</SettingsSection>
			<ScraperCard scraper={scraper} canManage={canManage} />
			<SettingsSection title="Automation rules" description="Rules that react to prospect events (hot lead bell, no-show follow-up…)">
				<p className="text-sm">They are created and edited in <Link href="/data/pipeline" className="font-semibold text-primary-800 underline dark:text-primary-300">Data → Pipeline</Link>.</p>
			</SettingsSection>
			{open && <ManageDialog source={open} pipelines={pipelines} appUrl={appUrl} canManage={canManage} onClose={() => setOpen(null)} />}
		</>
	);
}
