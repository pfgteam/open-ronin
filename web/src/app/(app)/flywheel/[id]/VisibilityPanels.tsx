'use client';

// Visibility tab (F3): the locked prompts, run controls with cost estimate,
// the latest run's scores (per prompt + per competitor), the trend across
// runs, and the answer drill-down for one run.

import { useState, useTransition } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type { AuditAnswerRow, AuditBundle, AuditRunRow, PromptRow } from '@/lib/flywheel/server';
import type { ClusterRow, ProgramRow } from '@/lib/flywheel/shared';
import ActionForm from '../ActionForm';
import { cancelAudit, estimateAudit, lockPrompts, queueAudit, savePrompt, suggestPrompts } from '../auditActions';

const STAGES = ['awareness', 'consideration', 'decision', 'comparison', 'other'] as const;
const RUN_COLOR: Record<AuditRunRow['status'], 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'accent'> = { queued: 'default', running: 'primary', done: 'success', failed: 'danger', capped: 'warning', cancelled: 'default' };

export function PromptsPanel({ program, prompts, locked, canSuggest }: { program: ProgramRow; prompts: PromptRow[]; locked: number; canSuggest: boolean }) {
	const live = prompts.filter((p) => !p.retired_at);
	const unlocked = live.filter((p) => !p.is_locked);
	return (
		<Card>
			<div className="flex items-center justify-between mb-1">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Buyer prompts</h2>
				<Badge color={live.filter((p) => p.is_locked).length >= locked ? 'success' : 'warning'}>
					{live.filter((p) => p.is_locked).length} locked / {locked}
				</Badge>
			</div>
			<p className="text-xs text-slate-500 mb-2">Locked at kickoff and re-run unchanged every month so the comparison stays valid. A locked prompt cannot be edited: retire it and add a new one.</p>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
				{live.map((p) => (
					<li key={p.id} className="py-1.5 text-xs flex items-start justify-between gap-2">
						<div className="min-w-0">
							<span className="text-slate-500 mr-1">{p.position}.</span>
							<span className="text-slate-800 dark:text-slate-200">{p.prompt}</span>
							<span className="ml-2 text-2xs text-slate-500">
								{p.stage ?? ''}
								{p.keyword ? ` · ${p.keyword}` : ''}
								{p.is_locked ? ` · locked ${p.locked_at?.slice(0, 10)}` : ' · draft'}
							</span>
						</div>
						<ActionForm action={savePrompt} success={null} className="shrink-0">
							<input type="hidden" name="program_id" value={program.id} />
							<input type="hidden" name="id" value={p.id} />
							<Button type="submit" name="retire" value="on" size="sm" variant="ghost">
								Retire
							</Button>
						</ActionForm>
					</li>
				))}
				{live.length === 0 && <li className="py-2 text-xs text-slate-500">No prompts yet.</li>}
			</ul>
			<ActionForm action={savePrompt} success="Prompt added." className="grid gap-1.5 md:grid-cols-[1fr_140px_140px_auto]" resetOnSuccess>
				<input type="hidden" name="program_id" value={program.id} />
				<Input name="prompt" placeholder="What a buyer would ask an AI (never mention the brand)" required />
				<Select name="stage" size="sm" defaultValue="consideration">
					{STAGES.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</Select>
				<Input name="keyword" placeholder="keyword" />
				<Button type="submit" size="sm" variant="outline">
					Add
				</Button>
			</ActionForm>
			<div className="mt-2 flex flex-wrap gap-2">
				{canSuggest && (
					<ActionForm action={suggestPrompts} success="10 prompts drafted — edit, then lock.">
						<input type="hidden" name="program_id" value={program.id} />
						<Button type="submit" size="sm" variant="outline">
							AI: suggest 10 from the intake
						</Button>
					</ActionForm>
				)}
				{unlocked.length > 0 && (
					<ActionForm action={lockPrompts} success="Locked.">
						<input type="hidden" name="program_id" value={program.id} />
						<Button type="submit" size="sm">
							Lock {unlocked.length} prompt{unlocked.length === 1 ? '' : 's'} (kickoff)
						</Button>
					</ActionForm>
				)}
			</div>
		</Card>
	);
}

export function RunControls({ program, bundle, clusters }: { program: ProgramRow; bundle: AuditBundle; clusters: ClusterRow[] }) {
	const [est, setEst] = useState<{ models: number; prompts: number; usd: number; cap: number; used: number; enabled: boolean } | null>(null);
	const [pending, start] = useTransition();
	const [coreOnly, setCoreOnly] = useState(false);
	const conn = bundle.connection;
	const off = conn ? !(conn.enabled && conn.has_key) : bundle.panel.total === 0;
	const refreshEstimate = (core: boolean) =>
		start(async () => {
			const fd = new FormData();
			fd.set('program_id', program.id);
			if (core) fd.set('core_only', 'on');
			const r = await estimateAudit(fd);
			if (r.ok) setEst(r);
		});
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Run an audit</h2>
			{off && (
				<Callout tone="warning" className="mb-2">
					The AI visibility panel is off until the Nous key is entered and enabled in Admin → Flywheel → AI panel (Integrations shows the status). Prompts can be prepared and locked now.
				</Callout>
			)}
			<p className="text-xs text-slate-500 mb-2">
				Panel: {bundle.panel.in_panel} of {bundle.panel.total} models ({bundle.panel.core} core). {conn ? `Spend this month $${conn.used.toFixed(2)} of $${conn.cap.toFixed(0)} cap.` : ''}
			</p>
			<ActionForm action={queueAudit} success="Queued — the cron answers in batches; results land here as they finish." className="grid gap-2 md:grid-cols-[150px_1fr_auto_auto] items-end">
				<input type="hidden" name="program_id" value={program.id} />
				<Select label="Kind" name="kind" size="sm" defaultValue={bundle.runs.some((r) => r.kind === 'baseline' && r.status === 'done') ? 'monthly' : 'baseline'}>
					<option value="baseline">Baseline</option>
					<option value="monthly">Monthly re-scan</option>
					<option value="reaudit">90-day re-audit</option>
					<option value="adhoc">Ad hoc</option>
				</Select>
				<Select label="Cluster (baseline / re-audit stamps it)" name="cluster_id" size="sm" defaultValue={clusters.find((c) => c.status !== 'closed')?.id ?? ''}>
					<option value="">—</option>
					{clusters.map((c) => (
						<option key={c.id} value={c.id}>
							Cluster {c.number}
						</option>
					))}
				</Select>
				<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 pb-2">
					<Checkbox name="core_only" checked={coreOnly} onChange={(e) => { setCoreOnly(e.target.checked); refreshEstimate(e.target.checked); }} /> core 5 only
				</label>
				<Button type="submit" size="sm" disabled={off}>
					Queue run
				</Button>
			</ActionForm>
			<div className="mt-2 flex items-center gap-3 text-xs">
				<Button type="button" size="sm" variant="ghost" loading={pending} onClick={() => refreshEstimate(coreOnly)}>
					Estimate cost
				</Button>
				{est && (
					<span className="text-slate-600 dark:text-slate-400">
						{est.models} models × {est.prompts} prompts ≈ <span className="font-medium text-slate-900 dark:text-slate-100">${est.usd.toFixed(2)}</span> · ${est.used.toFixed(2)} of ${est.cap.toFixed(0)} used this month
						{est.used + est.usd > est.cap && <Badge color="danger" className="ml-2">over cap</Badge>}
					</span>
				)}
			</div>
		</Card>
	);
}

export function RunsList({ program, runs, onPick, picked }: { program: ProgramRow; runs: AuditRunRow[]; onPick: (id: string | null) => void; picked: string | null }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Runs</h2>
			{runs.length === 0 ? (
				<p className="text-xs text-slate-500">No runs yet.</p>
			) : (
				<table className="w-full text-xs">
					<thead>
						<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
							<th className="py-1 pr-2">When</th>
							<th className="py-1 pr-2">Kind</th>
							<th className="py-1 pr-2">Status</th>
							<th className="py-1 pr-2">Answers</th>
							<th className="py-1 pr-2">Presence</th>
							<th className="py-1 pr-2">Core</th>
							<th className="py-1 pr-2">SOV</th>
							<th className="py-1 pr-2">Misinfo</th>
							<th className="py-1 pr-2">Cost</th>
							<th className="py-1"></th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
						{runs.map((r) => (
							<tr key={r.id}>
								<td className="py-1 pr-2 text-slate-600 dark:text-slate-400">{(r.finished_at ?? r.created_at).slice(0, 10)}</td>
								<td className="py-1 pr-2 text-slate-700 dark:text-slate-300">{r.kind}</td>
								<td className="py-1 pr-2"><Badge color={RUN_COLOR[r.status]}>{r.status}</Badge></td>
								<td className="py-1 pr-2 text-slate-600 dark:text-slate-400">{r.answers_done}/{r.answers_total}{r.answers_failed ? ` (${r.answers_failed} failed)` : ''}</td>
								<td className="py-1 pr-2 text-slate-900 dark:text-slate-100 font-medium">{r.presence_rate != null ? `${r.presence_rate}%` : '—'}</td>
								<td className="py-1 pr-2 text-slate-700 dark:text-slate-300">{r.core_presence_rate != null ? `${r.core_presence_rate}%` : '—'}</td>
								<td className="py-1 pr-2 text-slate-700 dark:text-slate-300">{r.sov != null ? `${r.sov}%` : '—'}</td>
								<td className="py-1 pr-2">{r.misinfo_count > 0 ? <Badge color="danger">{r.misinfo_count}</Badge> : '0'}</td>
								<td className="py-1 pr-2 text-slate-600 dark:text-slate-400">${r.actual_usd.toFixed(2)}{r.estimate_usd != null ? ` / est ${r.estimate_usd.toFixed(2)}` : ''}</td>
								<td className="py-1 flex gap-1">
									<Button type="button" size="sm" variant="ghost" onClick={() => onPick(picked === r.id ? null : r.id)}>
										{picked === r.id ? 'Close' : 'Answers'}
									</Button>
									{['queued', 'running', 'capped'].includes(r.status) && (
										<ActionForm action={cancelAudit} success="Cancelled.">
											<input type="hidden" name="run_id" value={r.id} />
											<input type="hidden" name="program_id" value={program.id} />
											<Button type="submit" size="sm" variant="ghost">
												Cancel
											</Button>
										</ActionForm>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{runs.some((r) => r.status === 'capped') && <Callout tone="warning" className="mt-2">A run hit the monthly cap; raise it in Admin → Flywheel → AI panel or wait for next month.</Callout>}
		</Card>
	);
}

export function LatestScores({ bundle }: { bundle: AuditBundle }) {
	const r = bundle.latest;
	if (!r) return null;
	const byPrompt = new Map(bundle.prompts.map((p) => [p.id, p]));
	const comp = Object.entries(r.per_competitor).sort((a, b) => b[1] - a[1]);
	const brandMentions = Math.round(((r.presence_rate ?? 0) / 100) * r.answers_done);
	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Latest: {r.kind} · {r.period_month.slice(0, 7)}</h2>
				<span className="text-2xs text-slate-500">{r.model_ids.length} models × {r.prompt_ids.length} prompts</span>
			</div>
			<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 text-sm mb-3">
				<Stat label="Presence" v={pct(r.presence_rate)} />
				<Stat label="Core 5 presence" v={pct(r.core_presence_rate)} />
				<Stat label="Avg position" v={r.avg_position != null ? `#${r.avg_position}` : '—'} />
				<Stat label="Sentiment" v={r.sentiment_score != null ? `${r.sentiment_score}/100` : '—'} />
				<Stat label="Accuracy" v={pct(r.accuracy_rate)} />
				<Stat label="Share of voice" v={pct(r.sov)} />
			</div>
			{r.misinfo_count > 0 && <Callout tone="error" className="mb-3">{r.misinfo_count} misinformation flag{r.misinfo_count === 1 ? '' : 's'} — see the answers; these need active correction separately from normal production (SOP Step 2).</Callout>}
			<div className="grid gap-4 lg:grid-cols-2">
				<div>
					<h3 className="text-2xs uppercase tracking-wide text-slate-500 mb-1">Per prompt</h3>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
						{bundle.latestScores
							.slice()
							.sort((a, b) => (byPrompt.get(a.prompt_id)?.position ?? 0) - (byPrompt.get(b.prompt_id)?.position ?? 0))
							.map((s) => (
								<li key={s.prompt_id} className="py-1 flex items-center justify-between gap-2">
									<span className="text-slate-700 dark:text-slate-300 truncate">{byPrompt.get(s.prompt_id)?.prompt ?? s.prompt_id}</span>
									<span className="shrink-0 text-slate-600 dark:text-slate-400">
										{s.present}/{s.models} · core {s.core_present}/{s.core_models}
										{s.misinfo_count ? <Badge color="danger" className="ml-1">{s.misinfo_count}</Badge> : null}
									</span>
								</li>
							))}
					</ul>
				</div>
				<div>
					<h3 className="text-2xs uppercase tracking-wide text-slate-500 mb-1">Share of voice vs competitors (mentions)</h3>
					<ul className="text-xs space-y-1">
						<Bar label={`Brand`} n={brandMentions} max={Math.max(brandMentions, ...comp.map((c) => c[1]), 1)} strong />
						{comp.map(([name, n]) => (
							<Bar key={name} label={name} n={n} max={Math.max(brandMentions, ...comp.map((c) => c[1]), 1)} />
						))}
					</ul>
				</div>
			</div>
		</Card>
	);
}

export function TrendChart({ runs }: { runs: AuditRunRow[] }) {
	const done = runs.filter((r) => r.status === 'done' && r.presence_rate != null).slice().reverse();
	if (done.length < 2) return null;
	const w = 560;
	const h = 140;
	const pad = 24;
	const xs = done.map((_, i) => pad + (i * (w - pad * 2)) / Math.max(1, done.length - 1));
	const line = (key: 'presence_rate' | 'core_presence_rate' | 'sov') => done.map((r, i) => `${xs[i]},${h - pad - ((r[key] ?? 0) / 100) * (h - pad * 2)}`).join(' ');
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Trend</h2>
			<svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36">
				{[0, 50, 100].map((v) => (
					<g key={v}>
						<line x1={pad} x2={w - pad} y1={h - pad - (v / 100) * (h - pad * 2)} y2={h - pad - (v / 100) * (h - pad * 2)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />
						<text x={4} y={h - pad - (v / 100) * (h - pad * 2) + 3} fontSize={9} className="fill-slate-400">{v}</text>
					</g>
				))}
				<polyline points={line('presence_rate')} fill="none" className="stroke-primary-600" strokeWidth={2} />
				<polyline points={line('core_presence_rate')} fill="none" className="stroke-green-600" strokeWidth={2} strokeDasharray="4 3" />
				<polyline points={line('sov')} fill="none" className="stroke-amber-500" strokeWidth={2} strokeDasharray="2 2" />
				{done.map((r, i) => (
					<text key={r.id} x={xs[i]} y={h - 6} textAnchor="middle" fontSize={9} className="fill-slate-500">
						{r.period_month.slice(2, 7)}
					</text>
				))}
			</svg>
			<p className="text-2xs text-slate-500">
				<span className="text-primary-600">— presence</span> · <span className="text-green-600">- - core 5 presence</span> · <span className="text-amber-500">· · share of voice</span>. Same prompts, same panel, month over month against the baseline.
			</p>
		</Card>
	);
}

export function AnswersTable({ answers, prompts, coreIds }: { answers: AuditAnswerRow[]; prompts: PromptRow[]; coreIds: string[] }) {
	const [filter, setFilter] = useState<'all' | 'present' | 'absent' | 'misinfo' | 'core'>('all');
	const [open, setOpen] = useState<string | null>(null);
	const byPrompt = new Map(prompts.map((p) => [p.id, p]));
	const rows = answers.filter((a) => (filter === 'all' ? true : filter === 'present' ? a.presence : filter === 'absent' ? a.presence === false : filter === 'misinfo' ? a.misinformation.length > 0 : coreIds.includes(a.model_id)));
	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Answers ({rows.length})</h2>
				<div className="flex gap-1">
					{(['all', 'present', 'absent', 'misinfo', 'core'] as const).map((f) => (
						<Button key={f} type="button" size="sm" variant={filter === f ? 'secondary' : 'ghost'} onClick={() => setFilter(f)}>
							{f}
						</Button>
					))}
				</div>
			</div>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700 text-xs">
				{rows.slice(0, 400).map((a) => (
					<li key={a.id} className="py-1.5">
						<button type="button" className="w-full text-left flex items-center justify-between gap-2" onClick={() => setOpen(open === a.id ? null : a.id)}>
							<span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
								<span className="font-mono text-slate-500 mr-2">{a.model_id}</span>
								{byPrompt.get(a.prompt_id)?.prompt ?? ''}
							</span>
							<span className="shrink-0 flex items-center gap-1">
								{a.status === 'failed' && <Badge color="danger">failed</Badge>}
								{a.presence === true && <Badge color="success">#{a.position ?? '?'} {a.sentiment}</Badge>}
								{a.presence === false && <Badge>absent</Badge>}
								{a.misinformation.length > 0 && <Badge color="danger">misinfo</Badge>}
							</span>
						</button>
						{open === a.id && (
							<div className="mt-1 rounded-md bg-slate-50 dark:bg-slate-800/60 p-2 text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
								{a.error ? <span className="text-red-600">{a.error}</span> : a.answer_md}
								{a.misinformation.length > 0 && <p className="mt-1 text-red-600 dark:text-red-400">Misinformation: {a.misinformation.join(' · ')}</p>}
								{a.judge_notes && <p className="mt-1 text-slate-500">{a.judge_notes}</p>}
								<p className="mt-1 text-2xs text-slate-500">competitors named: {a.competitors_named.join(', ') || '—'} · accuracy {a.accuracy ?? '—'} · ${a.cost_usd.toFixed(4)}</p>
							</div>
						)}
					</li>
				))}
			</ul>
		</Card>
	);
}

function Stat({ label, v }: { label: string; v: string }) {
	return (
		<div>
			<p className="text-2xs uppercase tracking-wide text-slate-500">{label}</p>
			<p className="text-base font-semibold text-slate-900 dark:text-slate-100">{v}</p>
		</div>
	);
}
function Bar({ label, n, max, strong }: { label: string; n: number; max: number; strong?: boolean }) {
	return (
		<li className="flex items-center gap-2">
			<span className={`w-28 truncate ${strong ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>{label}</span>
			<span className="flex-1 h-2 rounded-md bg-slate-100 dark:bg-slate-700 overflow-hidden">
				<span className={`block h-2 ${strong ? 'bg-primary-600' : 'bg-slate-400'}`} style={{ width: `${Math.round((n / max) * 100)}%` }} />
			</span>
			<span className="w-8 text-right text-slate-600 dark:text-slate-400">{n}</span>
		</li>
	);
}
function pct(v: number | null): string {
	return v == null ? '—' : `${v}%`;
}
