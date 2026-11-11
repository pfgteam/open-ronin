'use client';

// Team & targets (spec 2026-10-19 §9). Lanes edit inline (a lane or brand
// change replaces the row server-side); targets pick their metric from the
// tracked list (anything else never shows progress); removals offer Undo.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { deleteTarget, removeLanePerson, saveLanePerson, saveQueueRules, saveTarget, updateLanePerson } from '@/app/(app)/prospects/teamActions';
import { TRACKED_METRICS } from '@/lib/revenue/adminOptions';
import type { LanePersonRow, QueueRuleRow, TargetRow } from '@/lib/revenue/server';
import { LANE_LABELS, type Lane } from '@/lib/revenue/shared';
import SettingsSection from '../_ui/SettingsSection';

type Staff = { id: string; name: string };
const LANES: Lane[] = ['marketing', 'lead_gen', 'setter', 'closer', 'full_cycle'];
const ORGS = [
	{ value: 'all', label: 'All brands' },
	{ value: 'main', label: 'Main' },
	{ value: 'premium', label: 'Premium' },
	{ value: 'beacon', label: 'Beacon' },
];
const LEVELS = [
	{ value: 'individual', label: 'Individual' },
	{ value: 'team_lead', label: 'Team lead' },
	{ value: 'exec', label: 'Exec' },
];
const PERIODS = [
	{ value: 'day', label: 'Day' },
	{ value: 'week', label: 'Week' },
	{ value: 'month', label: 'Month' },
];
const METRIC_LABEL = Object.fromEntries(TRACKED_METRICS.map((m) => [m.value, m.label]));
const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2';

function laneFd(r: { user_id: string; lane: string; org: string; level: string }) {
	const fd = new FormData();
	fd.set('user_id', r.user_id);
	fd.set('lane', r.lane);
	fd.set('org', r.org);
	fd.set('level', r.level);
	return fd;
}
function targetFd(t: { user_id: string | null; lane: string; metric: string; period: string; target: number | string }) {
	const fd = new FormData();
	fd.set('user_id', t.user_id ?? '');
	fd.set('lane', t.lane);
	fd.set('metric', t.metric);
	fd.set('period', t.period);
	fd.set('target', String(t.target));
	return fd;
}

export default function TeamSection({ people, targets, rules, staff, canManage }: { people: LanePersonRow[]; targets: TargetRow[]; rules: QueueRuleRow[]; staff: Staff[]; canManage: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const [pending, start] = useTransition();
	const name = (id: string | null) => (id ? (staff.find((s) => s.id === id)?.name ?? 'Unknown') : 'Lane baseline');
	const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string, undo?: () => Promise<unknown>) =>
		start(async () => {
			const r = await fn();
			if (!r.ok) return toast({ message: r.error, variant: 'error' });
			toast(undo ? { message, undo: async () => { await undo(); router.refresh(); } } : { message, variant: 'success' });
			router.refresh();
		});

	// --- new lane person / target drafts
	const [np, setNp] = useState({ user_id: '', lane: 'setter', org: 'main', level: 'individual' });
	const [nt, setNt] = useState({ user_id: '', lane: 'setter', metric: 'dials', period: 'day', target: '' });
	const [rulesDraft, setRulesDraft] = useState<Record<string, string>>(() => Object.fromEntries(rules.map((r) => [r.key, String(r.value)])));
	const [ruleError, setRuleError] = useState<string | null>(null);

	const active = people.filter((p) => p.is_active);
	return (
		<>
			<SettingsSection title="Lanes" description={`Who works which part of the funnel · ${active.length} people`} padded={false}>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className={th}>Person</th><th className={th}>Lane</th><th className={th}>Brand</th><th className={th}>Level</th>{canManage && <th className={th} />}</tr></thead>
						<tbody>
							{active.map((p) => (
								<tr key={p.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
									<td className={clsx(td, 'font-semibold text-slate-900 dark:text-slate-100')}>{name(p.user_id)}</td>
									{(['lane', 'org', 'level'] as const).map((field) => (
										<td key={field} className={td}>
											<Select size="sm" aria-label={`${field} for ${name(p.user_id)}`} value={p[field]} disabled={!canManage || pending} className="w-36"
												onChange={(e) => act(() => updateLanePerson({ id: p.id, lane: p.lane, org: p.org, level: p.level, [field]: e.target.value }), `${name(p.user_id)} updated`)}>
												{(field === 'lane' ? LANES.map((l) => ({ value: l, label: LANE_LABELS[l] })) : field === 'org' ? ORGS : LEVELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
											</Select>
										</td>
									))}
									{canManage && (
										<td className={clsx(td, 'text-right')}>
											<Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => removeLanePerson({ id: p.id }), `${name(p.user_id)} removed from ${LANE_LABELS[p.lane as Lane] ?? p.lane}`, () => saveLanePerson(laneFd(p)))}>Remove</Button>
										</td>
									)}
								</tr>
							))}
							{canManage && (
								<tr className="bg-slate-50 dark:bg-slate-900/30">
									<td className={td}>
										<Select size="sm" aria-label="New person" value={np.user_id} onChange={(e) => setNp({ ...np, user_id: e.target.value })} className="w-44">
											<option value="">Add a person…</option>
											{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
										</Select>
									</td>
									<td className={td}><Select size="sm" aria-label="New lane" value={np.lane} onChange={(e) => setNp({ ...np, lane: e.target.value })} className="w-36">{LANES.map((l) => <option key={l} value={l}>{LANE_LABELS[l]}</option>)}</Select></td>
									<td className={td}><Select size="sm" aria-label="New brand" value={np.org} onChange={(e) => setNp({ ...np, org: e.target.value })} className="w-36">{ORGS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
									<td className={td}><Select size="sm" aria-label="New level" value={np.level} onChange={(e) => setNp({ ...np, level: e.target.value })} className="w-36">{LEVELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
									<td className={clsx(td, 'text-right')}><Button size="sm" disabled={!np.user_id || pending} onClick={() => act(() => saveLanePerson(laneFd(np)), `${name(np.user_id)} added`)}>Add</Button></td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</SettingsSection>

			<SettingsSection title="Targets" description="Lane baseline; a personal target overrides it" padded={false}>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className={th}>Lane</th><th className={th}>Who</th><th className={th}>Metric</th><th className={th}>Period</th><th className={clsx(th, 'text-right')}>Target</th>{canManage && <th className={th} />}</tr></thead>
						<tbody>
							{targets.map((t) => {
								const tracked = !!METRIC_LABEL[t.metric];
								return (
									<tr key={t.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
										<td className={td}>{LANE_LABELS[t.lane as Lane] ?? t.lane}</td>
										<td className={td}>{name(t.user_id)}</td>
										<td className={td}>{tracked ? METRIC_LABEL[t.metric] : <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">untracked: {t.metric}</span>}</td>
										<td className={td}>{PERIODS.find((p) => p.value === t.period)?.label ?? t.period}</td>
										<td className={clsx(td, 'text-right')}>
											<input type="number" min={0} step="any" defaultValue={t.target} disabled={!canManage || !tracked} aria-label={`Target for ${METRIC_LABEL[t.metric] ?? t.metric}`}
												className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm tabular-nums disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
												onBlur={(e) => { if (Number(e.target.value) !== t.target && e.target.value !== '') act(() => saveTarget(targetFd({ ...t, target: e.target.value })), `${METRIC_LABEL[t.metric]} target saved`); }} />
										</td>
										{canManage && (
											<td className={clsx(td, 'text-right')}>
												<Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => deleteTarget({ id: t.id }), 'Target removed', tracked ? () => saveTarget(targetFd(t)) : undefined)}>Remove</Button>
											</td>
										)}
									</tr>
								);
							})}
							{canManage && (
								<tr className="bg-slate-50 dark:bg-slate-900/30">
									<td className={td}><Select size="sm" aria-label="Target lane" value={nt.lane} onChange={(e) => setNt({ ...nt, lane: e.target.value })} className="w-32">{LANES.map((l) => <option key={l} value={l}>{LANE_LABELS[l]}</option>)}</Select></td>
									<td className={td}>
										<Select size="sm" aria-label="Target person" value={nt.user_id} onChange={(e) => setNt({ ...nt, user_id: e.target.value })} className="w-40">
											<option value="">Lane baseline</option>
											{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
										</Select>
									</td>
									<td className={td}><Select size="sm" aria-label="Target metric" value={nt.metric} onChange={(e) => setNt({ ...nt, metric: e.target.value })} className="w-44">{TRACKED_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></td>
									<td className={td}><Select size="sm" aria-label="Target period" value={nt.period} onChange={(e) => setNt({ ...nt, period: e.target.value })} className="w-24">{PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></td>
									<td className={clsx(td, 'text-right')}><input type="number" min={0} step="any" aria-label="Target value" value={nt.target} onChange={(e) => setNt({ ...nt, target: e.target.value })} className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800" /></td>
									<td className={clsx(td, 'text-right')}><Button size="sm" disabled={nt.target === '' || pending} onClick={() => act(() => saveTarget(targetFd({ ...nt, user_id: nt.user_id || null })), 'Target added')}>Add</Button></td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</SettingsSection>

			<SettingsSection title="Queue priorities" description="How the Self → My work → Sales tab orders a rep's deals"
				actions={canManage && (
					<Button size="sm" loading={pending} onClick={() => {
						setRuleError(null);
						const fd = new FormData();
						for (const [k, v] of Object.entries(rulesDraft)) {
							if (v.trim() === '' || !Number.isFinite(Number(v))) return setRuleError(`${rules.find((r) => r.key === k)?.label ?? k}: enter a number.`);
							fd.set(`rule:${k}`, v);
						}
						act(() => saveQueueRules(fd), 'Queue priorities saved');
					}}>Save</Button>
				)}>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{rules.map((r) => (
						<div key={r.key}>
							<Input label={r.label} type="number" step="any" value={rulesDraft[r.key] ?? ''} disabled={!canManage} onChange={(e) => setRulesDraft((d) => ({ ...d, [r.key]: e.target.value }))} />
							{r.note && <p className="mt-1 text-2xs text-slate-500">{r.note}</p>}
						</div>
					))}
				</div>
				{ruleError && <Callout tone="error" className="mt-3">{ruleError}</Callout>}
			</SettingsSection>
		</>
	);
}
