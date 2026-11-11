// Automation engine: schedules -> runs, events -> runs, runs -> one step per
// pass. Called by /api/cron/automations every minute and by "Run now" on the
// builder, so localhost and production advance through the same code (the
// scrapers / content-jobs discipline). Service role: runs execute on nobody's
// behalf; the database guards (0101) still apply — the daily cap raises
// AUTOMATION_RUN_CAP: and is treated as a hold, not a failure.
//
// Rule 5: no pg_cron. Rule 6: nothing here is a business calculation.

import { createServiceRoleClient } from '@/lib/supabase/server';
import { enqueueContentJob } from '@/lib/providers/enqueue';
import {
	StepsSchema,
	evalFilter,
	getPath,
	interpolate,
	nextCronRun,
	type AutomationRuleRow,
	type AutomationRunRow,
	type RunContext,
	type Step,
} from './shared';

type Db = ReturnType<typeof createServiceRoleClient>;

export const RUN_CAP_PREFIX = 'AUTOMATION_RUN_CAP:';

export interface EngineLog {
	scheduled: number;
	events: number;
	advanced: number;
	finished: number;
	held: number;
	failed: number;
	errors: string[];
}

const PER_TICK = 25;

/** One pass: fire due schedules, drain events, advance open runs. */
export async function advanceAutomations(db: Db, now = new Date()): Promise<EngineLog> {
	const log: EngineLog = { scheduled: 0, events: 0, advanced: 0, finished: 0, held: 0, failed: 0, errors: [] };
	await fireSchedules(db, now, log);
	await drainEvents(db, now, log);
	await advanceRuns(db, now, log);
	// Housekeeping: processed events older than 7 days.
	await db.from('automation_events').delete().lt('created_at', new Date(now.getTime() - 7 * 86400_000).toISOString()).not('processed_at', 'is', null);
	return log;
}

async function createRun(db: Db, rule: Pick<AutomationRuleRow, 'id' | 'slug'>, payload: Record<string, unknown>, via: 'cron' | 'system', log: EngineLog): Promise<boolean> {
	const { error } = await db.from('automation_runs').insert({ rule_id: rule.id, trigger_payload: payload, requested_via: via });
	if (!error) return true;
	if (error.message.includes(RUN_CAP_PREFIX)) {
		log.held += 1;
		return false;
	}
	log.errors.push(`${rule.slug}: ${error.message}`);
	return false;
}

async function fireSchedules(db: Db, now: Date, log: EngineLog): Promise<void> {
	const { data, error } = await db
		.from('automation_rules')
		.select('id, slug, trigger_config, next_run_at')
		.eq('enabled', true)
		.eq('trigger_kind', 'schedule')
		.lte('next_run_at', now.toISOString())
		.limit(PER_TICK);
	if (error) {
		log.errors.push(`schedules: ${error.message}`);
		return;
	}
	for (const rule of data ?? []) {
		const cron = String((rule.trigger_config as Record<string, unknown>)?.cron ?? '');
		const next = nextCronRun(cron, now);
		// Advance next_run_at FIRST so a slow step never double-fires the rule.
		const { error: upErr } = await db
			.from('automation_rules')
			.update({ next_run_at: next ? next.toISOString() : null, ...(next ? {} : { enabled: false, last_error: `Bad cron expression: ${cron}` }) })
			.eq('id', rule.id)
			.eq('next_run_at', rule.next_run_at);
		if (upErr || !next) continue;
		if (await createRun(db, rule, { scheduled_for: rule.next_run_at, cron }, 'cron', log)) log.scheduled += 1;
	}
}

async function drainEvents(db: Db, now: Date, log: EngineLog): Promise<void> {
	const { data: events, error } = await db
		.from('automation_events')
		.select('id, table_name, op, row_id, row_data')
		.is('processed_at', null)
		.order('id')
		.limit(PER_TICK * 4);
	if (error) {
		log.errors.push(`events: ${error.message}`);
		return;
	}
	if (!events?.length) return;
	const { data: rules } = await db
		.from('automation_rules')
		.select('id, slug, trigger_config')
		.eq('enabled', true)
		.eq('trigger_kind', 'table_event');
	const listeners = (rules ?? []).map((r) => ({
		id: r.id,
		slug: r.slug,
		table: String((r.trigger_config as Record<string, unknown>)?.table ?? ''),
		op: String((r.trigger_config as Record<string, unknown>)?.op ?? 'any'),
	}));
	for (const ev of events) {
		for (const l of listeners) {
			if (l.table !== ev.table_name || (l.op !== 'any' && l.op !== ev.op)) continue;
			await createRun(db, l, { event_id: ev.id, table: ev.table_name, op: ev.op, row: ev.row_data }, 'system', log);
		}
		await db.from('automation_events').update({ processed_at: now.toISOString() }).eq('id', ev.id);
		log.events += 1;
	}
}

async function advanceRuns(db: Db, now: Date, log: EngineLog): Promise<void> {
	const { data: runs, error } = await db
		.from('automation_runs')
		.select('*')
		.in('status', ['queued', 'approved', 'running'])
		.or(`wake_at.is.null,wake_at.lte.${now.toISOString()}`)
		.order('created_at')
		.limit(PER_TICK);
	if (error) {
		log.errors.push(`runs: ${error.message}`);
		return;
	}
	for (const run of (runs ?? []) as AutomationRunRow[]) {
		try {
			await advanceOne(db, run, now, log);
			log.advanced += 1;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.failed += 1;
			log.errors.push(`${run.id}: ${msg}`);
			await db.from('automation_runs').update({ status: 'failed', error: msg.slice(0, 2000) }).eq('id', run.id);
		}
	}
}

/** Execute steps from current_step until a wait, a filter stop, or the end. */
export async function advanceOne(db: Db, run: AutomationRunRow, now: Date, log: EngineLog): Promise<void> {
	const { data: rule, error } = await db.from('automation_rules').select('*').eq('id', run.rule_id).maybeSingle();
	if (error || !rule) throw new Error(error?.message ?? 'rule missing');
	const parsed = StepsSchema.safeParse(rule.steps);
	if (!parsed.success) throw new Error(`rule steps invalid: ${parsed.error.issues[0]?.message ?? 'schema'}`);
	const steps = parsed.data;

	if (run.status !== 'running') {
		await db.from('automation_runs').update({ status: 'running' }).eq('id', run.id);
	}

	const ctx: RunContext = {
		row: (run.trigger_payload.row as Record<string, unknown>) ?? {},
		vars: reconstructVars(run.step_results),
		rule: { id: rule.id, slug: rule.slug, name: rule.name },
		run: { id: run.id, requested_by: run.requested_by },
	};
	const results: unknown[] = [...(run.step_results ?? [])];
	let i = run.current_step;
	const budgetEnd = now.getTime() + 20_000;

	while (i < steps.length && Date.now() < budgetEnd) {
		const step = steps[i];
		const out = await runStep(db, step, ctx, rule as AutomationRuleRow);
		results.push({ step: i, type: step.type, ...out });
		if (out.stop) {
			await db.from('automation_runs').update({ status: 'done', current_step: i + 1, step_results: results, wake_at: null }).eq('id', run.id);
			log.finished += 1;
			return;
		}
		if (out.wake_at) {
			await db.from('automation_runs').update({ current_step: i + 1, step_results: results, wake_at: out.wake_at }).eq('id', run.id);
			return;
		}
		i += 1;
	}
	if (i >= steps.length) {
		await db.from('automation_runs').update({ status: 'done', current_step: i, step_results: results, wake_at: null }).eq('id', run.id);
		log.finished += 1;
	} else {
		await db.from('automation_runs').update({ current_step: i, step_results: results }).eq('id', run.id);
	}
}

function reconstructVars(results: unknown[] | null): Record<string, unknown> {
	const vars: Record<string, unknown> = {};
	for (const r of results ?? []) {
		const rec = r as { type?: string; vars?: Record<string, unknown> };
		if (rec?.type === 'map' && rec.vars) Object.assign(vars, rec.vars);
	}
	return vars;
}

interface StepOut {
	ok: boolean;
	detail?: string;
	stop?: boolean;
	wake_at?: string;
	vars?: Record<string, unknown>;
	ref?: string;
}

async function runStep(db: Db, step: Step, ctx: RunContext, rule: AutomationRuleRow): Promise<StepOut> {
	switch (step.type) {
		case 'filter': {
			const pass = evalFilter(step.config, ctx);
			return pass ? { ok: true, detail: 'matched' } : { ok: true, detail: 'no match', stop: true };
		}
		case 'map': {
			const vars: Record<string, unknown> = {};
			for (const [k, tpl] of Object.entries(step.config.assign)) vars[k] = interpolate(tpl, ctx);
			Object.assign(ctx.vars, vars);
			return { ok: true, vars };
		}
		case 'run_skill': {
			const context: Record<string, string> = {};
			for (const [k, tpl] of Object.entries(step.config.context)) context[k] = interpolate(tpl, ctx);
			const { data, error } = await db
				.from('skill_runs')
				.insert({ skill: step.config.skill, context: { ...context, automation_run_id: ctx.run.id }, requested_by: ctx.run.requested_by })
				.select('id')
				.single();
			if (error) throw new Error(`run_skill: ${error.message}`);
			return { ok: true, ref: `skill_runs/${data.id}` };
		}
		case 'generate_content': {
			const res = await enqueueContentJob(db, {
				provider: step.config.provider,
				input: { capability: step.config.capability, prompt: interpolate(step.config.prompt, ctx) },
				requestedBy: ctx.run.requested_by,
				requestedVia: 'skill',
				clientId: rule.client_id,
			});
			if (!res.ok) throw new Error(`generate_content: ${res.message}`);
			return { ok: true, ref: `content_jobs/${res.jobId}` };
		}
		case 'notify': {
			const to = resolveUser(step.config.to, ctx);
			if (!to) return { ok: false, detail: `notify: no recipient for ${step.config.to}` };
			const href = step.config.href ? interpolate(step.config.href, ctx) : `/data/pipeline?run=${ctx.run.id}`;
			const { error } = await db.from('notifications').upsert(
				{
					user_id: to,
					kind: 'automation',
					title: interpolate(step.config.title, ctx).slice(0, 200),
					body: interpolate(step.config.body, ctx).slice(0, 2000),
					href: href.startsWith('/') ? href : `/data/pipeline?run=${ctx.run.id}`,
					dedupe_key: `automation:${ctx.run.id}:${to}`,
				},
				{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
			);
			if (error) throw new Error(`notify: ${error.message}`);
			return { ok: true, ref: `notifications/${to}` };
		}
		case 'write_row': {
			const { data: target } = await db.from('automation_write_targets').select('columns').eq('table_name', step.config.table).maybeSingle();
			if (!target) throw new Error(`write_row: ${step.config.table} is not allowlisted`);
			const allowed = new Set(target.columns as string[]);
			const values: Record<string, unknown> = {};
			for (const [k, tpl] of Object.entries(step.config.values)) {
				if (!allowed.has(k)) throw new Error(`write_row: column ${k} is not allowlisted on ${step.config.table}`);
				const v = interpolate(tpl, ctx);
				values[k] = v === '' ? null : v;
			}
			if (step.config.mode === 'update') {
				const id = step.config.match_id ? interpolate(step.config.match_id, ctx) : String(ctx.row.id ?? '');
				if (!id) throw new Error('write_row: update needs match_id');
				const { error } = await db.from(step.config.table).update(values).eq('id', id);
				if (error) throw new Error(`write_row: ${error.message}`);
				return { ok: true, ref: `${step.config.table}/${id}` };
			}
			const { data, error } = await db.from(step.config.table).insert(values).select('id').single();
			if (error) throw new Error(`write_row: ${error.message}`);
			return { ok: true, ref: `${step.config.table}/${data.id}` };
		}
		case 'call_n8n_webhook': {
			const body = step.config.include === 'row' ? ctx.row : step.config.include === 'vars' ? ctx.vars : { row: ctx.row, vars: ctx.vars, rule: ctx.rule, run: ctx.run };
			const res = await fetch(step.config.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(15_000),
			});
			if (!res.ok) throw new Error(`call_n8n_webhook: HTTP ${res.status}`);
			return { ok: true, detail: `HTTP ${res.status}` };
		}
		case 'wait': {
			let until: Date | null = null;
			if (step.config.until_field) {
				const v = getPath(ctx, step.config.until_field);
				const d = v ? new Date(String(v)) : null;
				until = d && !Number.isNaN(d.getTime()) ? d : null;
			}
			if (!until && step.config.minutes) until = new Date(Date.now() + step.config.minutes * 60_000);
			if (!until) return { ok: true, detail: 'nothing to wait for' };
			if (until.getTime() <= Date.now()) return { ok: true, detail: 'already past' };
			return { ok: true, wake_at: until.toISOString() };
		}
		// ---------------------------------------------------- Revenue Engine (0127)
		case 'move_stage': {
			const deal = await revenueDeal(db, ctx);
			if (!deal) return { ok: true, detail: 'no prospect deal on this row', stop: true };
			if (step.config.only_if_pipeline && deal.pipeline_slug !== step.config.only_if_pipeline) return { ok: true, detail: `deal is in ${deal.pipeline_slug}, not ${step.config.only_if_pipeline}` };
			const { data: stage } = await db.from('rev_stages').select('id').eq('pipeline_id', deal.pipeline_id).eq('slug', step.config.stage).maybeSingle();
			if (!stage) return { ok: false, detail: `move_stage: no stage ${step.config.stage} in ${deal.pipeline_slug}` };
			if (stage.id === deal.stage_id) return { ok: true, detail: 'already there' };
			const { error } = await db.from('rev_deals').update({ stage_id: stage.id, meta: { ...(deal.meta ?? {}), move_reason: `automation:${rule.slug}` } }).eq('id', deal.id);
			if (error) throw new Error(`move_stage: ${error.message}`);
			return { ok: true, ref: `rev_deals/${deal.id}`, detail: `→ ${step.config.stage}` };
		}
		case 'rescore': {
			const deal = await revenueDeal(db, ctx);
			if (!deal) return { ok: true, detail: 'no prospect deal on this row', stop: true };
			const { data, error } = await db.rpc('rev_rescore', { p_deal: deal.id });
			if (error) throw new Error(`rescore: ${error.message}`);
			const r = (data ?? {}) as { quality?: string; heat?: string; routing?: string };
			return { ok: true, ref: `rev_deals/${deal.id}`, detail: `${r.quality ?? '?'}-${r.heat ?? '?'} ${r.routing ?? ''}`.trim() };
		}
		case 'push_ghl': {
			const deal = await revenueDeal(db, ctx);
			if (!deal) return { ok: true, detail: 'no prospect deal on this row', stop: true };
			const { pushDeal } = await import('@/lib/revenue/ghlSync');
			const r = await pushDeal(db, deal.id, { force: !!step.config.force });
			if (r.status === 'failed') return { ok: false, detail: `push_ghl: ${r.error}` };
			return { ok: true, ref: `rev_deals/${deal.id}`, detail: r.status === 'skipped' ? `skipped: ${r.error}` : `pushed ${r.ghl_contact_id ?? ''}` };
		}
		case 'create_task_revenue': {
			const deal = await revenueDeal(db, ctx);
			if (!deal) return { ok: true, detail: 'no prospect deal on this row', stop: true };
			let owner: string | null = null;
			if (!step.config.owner || step.config.owner === 'owner') owner = deal.owner_setter_id ?? deal.owner_closer_id ?? deal.owner_lg_id;
			else owner = resolveUser(step.config.owner, ctx) ?? (step.config.owner.startsWith('deal.') ? ((deal as unknown as Record<string, unknown>)[step.config.owner.slice(5)] as string | null) : null);
			const { data, error } = await db
				.from('rev_tasks')
				.insert({
					deal_id: deal.id,
					person_id: deal.primary_person_id,
					owner_id: owner,
					title: interpolate(step.config.title, ctx).slice(0, 300),
					body_md: step.config.body ? interpolate(step.config.body, ctx).slice(0, 2000) : `Automation: ${rule.name}`,
					due_at: step.config.due_minutes ? new Date(Date.now() + step.config.due_minutes * 60_000).toISOString() : null,
					created_by_kind: 'automation',
				})
				.select('id')
				.single();
			if (error) throw new Error(`create_task_revenue: ${error.message}`);
			return { ok: true, ref: `rev_tasks/${data.id}` };
		}
	}
}

interface RevenueDeal {
	id: string;
	pipeline_id: string;
	pipeline_slug: string;
	stage_id: string;
	primary_person_id: string | null;
	owner_lg_id: string | null;
	owner_setter_id: string | null;
	owner_closer_id: string | null;
	meta: Record<string, unknown> | null;
}

/** The prospect deal behind the trigger row (rev_deals.id, or *.deal_id on activities / contracts / calls / referrals). */
async function revenueDeal(db: Db, ctx: RunContext): Promise<RevenueDeal | null> {
	const row = ctx.row as Record<string, unknown>;
	const id = typeof row.pipeline_id === 'string' && typeof row.stage_id === 'string' ? (row.id as string) : (row.deal_id as string | undefined) ?? (ctx.vars.deal_id as string | undefined);
	if (!id || !UUID_RE.test(id)) return null;
	const { data } = await db.from('rev_deals').select('id, pipeline_id, stage_id, primary_person_id, owner_lg_id, owner_setter_id, owner_closer_id, meta, rev_pipelines(slug)').eq('id', id).maybeSingle();
	if (!data) return null;
	const p = (data as unknown as { rev_pipelines: { slug: string } | { slug: string }[] | null }).rev_pipelines;
	const slug = Array.isArray(p) ? p[0]?.slug : p?.slug;
	const { rev_pipelines: _p, ...rest } = data as unknown as RevenueDeal & { rev_pipelines: unknown };
	void _p;
	return { ...rest, pipeline_slug: slug ?? '' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveUser(to: string, ctx: RunContext): string | null {
	if (to === 'requester') return ctx.run.requested_by;
	if (UUID_RE.test(to)) return to;
	const v = getPath(ctx, to);
	return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}
