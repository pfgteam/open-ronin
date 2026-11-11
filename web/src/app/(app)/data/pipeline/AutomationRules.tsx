// Native rules on /data/pipeline: the rule list with enable / run now /
// delete, the run log (each run is also a work_runs row), and a rule editor
// (trigger + steps as validated JSON blocks; the drag-and-drop block UI is a
// follow-up, the schema is the contract). Server component; the page mounts
// it under the pipeline inventory. Reads through the session client so
// can_manage_automations() (0101 RLS) decides who sees rules at all.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';
import { STATUS_DOT, STATUS_LABELS, type WorkStatus } from '@/lib/work-engine/shared';
import { STEP_LABELS, STEP_TYPES, type AutomationRuleRow, type AutomationRunRow } from '@/lib/automations/shared';
import { deleteRule, runRuleNow, saveRule, setRuleEnabled } from './actions';

const TEXTAREA =
	'w-full rounded-md border px-3 py-2 text-xs font-mono transition-colors duration-150 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400';

const EXAMPLE_TRIGGER = '{"kind":"table_event","table":"live_links","op":"insert"}';
const EXAMPLE_STEPS = JSON.stringify(
	[
		{ type: 'filter', config: { field: 'row.status', op: 'equals', value: 'live' } },
		{ type: 'map', config: { assign: { headline: 'New placement: {{row.outlet_name}}' } } },
		{ type: 'notify', config: { to: 'requester', title: '{{vars.headline}}', body: '{{row.url}}' } },
	],
	null,
	2,
);

function triggerSummary(r: AutomationRuleRow): string {
	const c = r.trigger_config as Record<string, unknown>;
	switch (r.trigger_kind) {
		case 'schedule':
			return `schedule ${String(c.cron ?? '')} (Chicago)`;
		case 'table_event':
			return `${String(c.op ?? 'any')} on ${String(c.table ?? '?')}`;
		case 'ingest_event':
			return `ingest /api/ingest/${String(c.endpoint ?? '?')}`;
		default:
			return 'manual';
	}
}

export default async function AutomationRules({ error, editId, runId }: { error?: string | null; editId?: string | null; runId?: string | null }) {
	const supabase = await createClient();
	const [rulesRes, runsRes, groupsRes] = await Promise.all([
		supabase.from('automation_rules').select('*').order('name'),
		supabase.from('automation_runs').select('*').order('created_at', { ascending: false }).limit(30),
		supabase.from('reviewer_groups').select('key, name').order('key'),
	]);
	const unavailable = rulesRes.error?.message ?? null;
	const rules = (rulesRes.data ?? []) as AutomationRuleRow[];
	const runs = (runsRes.data ?? []) as AutomationRunRow[];
	const ruleName = new Map(rules.map((r) => [r.id, r.name]));
	const editing = editId ? rules.find((r) => r.id === editId) ?? null : null;
	const focusRun = runId ? runs.find((r) => r.id === runId) ?? null : null;

	return (
		<div className="space-y-4">
			{error && <Callout tone="error">{error}</Callout>}
			{unavailable && (
				<Callout tone="warning">
					Migration 0101 (automation_rules v2, automation_runs) is not applied yet. The builder below saves nothing until it is; the inventory above and Imports keep working.
				</Callout>
			)}

			<Card padding="none" className="overflow-hidden">
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
					<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Native rules</span>
					<span className="text-xs tabular-nums text-slate-400">{rules.length}</span>
					<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
					<Link href="/admin/work-engine?domain=automation" className="text-2xs text-primary-600 dark:text-primary-400 hover:underline">
						Runs in the Work Engine →
					</Link>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Rule</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Trigger</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Steps</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Approval</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Last run</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{rules.length === 0 && (
								<tr>
									<td colSpan={6} className="px-4 py-6 text-center text-slate-500">
										No rules yet. Write one below; it stays disabled until you enable it.
									</td>
								</tr>
							)}
							{rules.map((r) => (
								<tr key={r.id} className="border-t border-slate-200 dark:border-slate-700 align-top">
									<td className="px-4 py-2">
										<div className="text-slate-800 dark:text-slate-200 font-medium">{r.name}</div>
										<div className="font-mono text-2xs text-slate-500">{r.slug}</div>
									</td>
									<td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">{triggerSummary(r)}</td>
									<td className="px-3 py-2 text-slate-600 dark:text-slate-400">
										{(r.steps ?? []).map((s, i) => (
											<span key={i} className="inline-block mr-1 mb-0.5">
												<Badge>{STEP_LABELS[s.type] ?? s.type}</Badge>
											</span>
										))}
									</td>
									<td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">{r.requires_approval ? r.approver_group ?? 'yes' : '—'}</td>
									<td className="px-3 py-2 whitespace-nowrap">
										{r.last_run_at ? (
											<span className="inline-flex items-center gap-1.5">
												<Badge color={r.last_run_status === 'done' ? 'success' : r.last_run_status === 'failed' ? 'danger' : 'default'}>{r.last_run_status ?? ''}</Badge>
												<span className="text-slate-500">{formatRelative(r.last_run_at)}</span>
											</span>
										) : (
											<span className="text-slate-400">never</span>
										)}
										{r.trigger_kind === 'schedule' && r.enabled && r.next_run_at && <div className="text-2xs text-slate-500">next {formatRelative(r.next_run_at)}</div>}
									</td>
									<td className="px-3 py-2 text-right whitespace-nowrap">
										<div className="inline-flex items-center gap-1">
											<form action={setRuleEnabled}>
												<input type="hidden" name="id" value={r.id} />
												<input type="hidden" name="enabled" value={r.enabled ? 'false' : 'true'} />
												<Button size="sm" variant={r.enabled ? 'outline' : 'primary'} type="submit">
													{r.enabled ? 'Disable' : 'Enable'}
												</Button>
											</form>
											<form action={runRuleNow}>
												<input type="hidden" name="id" value={r.id} />
												<Button size="sm" variant="secondary" type="submit">
													Run now
												</Button>
											</form>
											<Link href={`/data/pipeline?edit=${r.id}#rule-editor`} className="text-2xs text-primary-600 dark:text-primary-400 hover:underline px-1">
												Edit
											</Link>
											<form action={deleteRule}>
												<input type="hidden" name="id" value={r.id} />
												<Button size="sm" variant="ghost" type="submit">
													Delete
												</Button>
											</form>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card id="rule-editor" className="space-y-3">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{editing ? `Edit: ${editing.name}` : 'New rule'}</h2>
					<p className="text-2xs text-slate-500">
						Trigger and steps are JSON blocks validated here and again by the database (closed step list, write allowlist, 20-step cap). Step types: {STEP_TYPES.join(', ')}. Templates use <code>{'{{row.field}}'}</code> and <code>{'{{vars.name}}'}</code>.
					</p>
					<form action={saveRule} className="space-y-3">
						{editing && <input type="hidden" name="id" value={editing.id} />}
						<div className="grid gap-3 sm:grid-cols-2">
							<Input name="name" label="Name" required defaultValue={editing?.name ?? ''} maxLength={120} />
							<Input name="slug" label="Slug" required defaultValue={editing?.slug ?? ''} pattern="[a-z0-9][a-z0-9-]{1,79}" placeholder="new-placement-alert" />
						</div>
						<Input name="description_md" label="Description" defaultValue={editing?.description_md ?? ''} maxLength={4000} />
						<div className="flex flex-col gap-1">
							<label htmlFor="trigger" className="text-sm font-medium text-slate-700 dark:text-slate-300">
								Trigger
							</label>
							<textarea id="trigger" name="trigger" rows={2} className={TEXTAREA} defaultValue={editing ? JSON.stringify({ kind: editing.trigger_kind, ...editing.trigger_config }) : EXAMPLE_TRIGGER} />
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor="steps" className="text-sm font-medium text-slate-700 dark:text-slate-300">
								Steps
							</label>
							<textarea id="steps" name="steps" rows={10} className={TEXTAREA} defaultValue={editing ? JSON.stringify(editing.steps, null, 2) : EXAMPLE_STEPS} />
						</div>
						<div className="grid gap-3 sm:grid-cols-3 items-end">
							<label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
								<input type="checkbox" name="requires_approval" defaultChecked={editing?.requires_approval ?? false} className="rounded-sm border-slate-300 dark:border-slate-600" />
								Needs approval before it runs
							</label>
							<div className="flex flex-col gap-1">
								<label htmlFor="approver_group" className="text-sm font-medium text-slate-700 dark:text-slate-300">
									Approver group
								</label>
								<select id="approver_group" name="approver_group" defaultValue={editing?.approver_group ?? ''} className={TEXTAREA}>
									<option value="">—</option>
									{(groupsRes.data ?? []).map((g) => (
										<option key={g.key} value={g.key}>
											{g.name}
										</option>
									))}
								</select>
							</div>
							<Input name="daily_run_cap" label="Daily run cap" type="number" min={1} max={10000} defaultValue={editing?.daily_run_cap ?? 100} />
						</div>
						<div className="flex items-center gap-2">
							<Button type="submit" size="sm">
								{editing ? 'Save changes' : 'Create rule (disabled)'}
							</Button>
							{editing && (
								<Link href="/data/pipeline" className="text-xs text-slate-500 hover:underline">
									Cancel
								</Link>
							)}
						</div>
					</form>
				</Card>

				<Card padding="none" className="overflow-hidden">
					<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
						<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent runs</span>
						<span className="text-xs tabular-nums text-slate-400">{runs.length}</span>
						<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
					</div>
					<div className="overflow-x-auto max-h-[32rem]">
						<table className="w-full text-xs">
							<tbody>
								{runs.length === 0 && (
									<tr>
										<td className="px-4 py-6 text-center text-slate-500">No runs yet.</td>
									</tr>
								)}
								{runs.map((run) => (
									<tr key={run.id} className={`border-t border-slate-200 dark:border-slate-700 align-top ${focusRun?.id === run.id ? 'bg-primary-50/50 dark:bg-primary-950/20' : ''}`}>
										<td className="px-4 py-2 whitespace-nowrap">
											<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
												<span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[run.status as WorkStatus] ?? 'bg-slate-400'}`} />
												{STATUS_LABELS[run.status as WorkStatus] ?? run.status}
											</span>
										</td>
										<td className="px-3 py-2 text-slate-700 dark:text-slate-300">
											<div>{ruleName.get(run.rule_id) ?? run.rule_id}</div>
											<div className="text-2xs text-slate-500">
												{formatRelative(run.created_at)} · step {run.current_step} · {run.requested_via}
											</div>
											{run.error && <div className="text-2xs text-red-600 dark:text-red-400 truncate max-w-xs" title={run.error}>{run.error}</div>}
											{focusRun?.id === run.id && (
												<pre className="mt-1 text-2xs whitespace-pre-wrap text-slate-600 dark:text-slate-400 max-h-40 overflow-auto">{JSON.stringify(run.step_results, null, 1)}</pre>
											)}
										</td>
										<td className="px-3 py-2 text-right whitespace-nowrap">
											<Link href={`/data/pipeline?run=${run.id}`} className="text-2xs text-primary-600 dark:text-primary-400 hover:underline">
												{focusRun?.id === run.id ? 'shown' : 'details'}
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			</div>
		</div>
	);
}
