// Automation step vocabulary (WORK_ENGINE_PLAN.md 1.4 / Module 6.1). Zod
// schemas mirror guard_automation_rule() in 0101; the database is the
// boundary, this is the honest UI and the engine's parser. No server imports.

import { z } from 'zod';

export const TRIGGER_KINDS = ['schedule', 'table_event', 'ingest_event', 'manual'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const STEP_TYPES = ['filter', 'map', 'run_skill', 'generate_content', 'notify', 'write_row', 'call_n8n_webhook', 'wait', 'move_stage', 'rescore', 'push_ghl', 'create_task_revenue'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_LABELS: Record<StepType, string> = {
	filter: 'Filter',
	map: 'Map fields',
	run_skill: 'Run skill',
	generate_content: 'Generate content',
	notify: 'Notify',
	write_row: 'Write row',
	call_n8n_webhook: 'Call n8n webhook',
	wait: 'Wait',
	// Revenue Engine (0127, spec §13)
	move_stage: 'Move prospect stage',
	rescore: 'Rescore prospect',
	push_ghl: 'Push to GHL',
	create_task_revenue: 'Create prospect to-do',
};

/** One dotted path into the run context, e.g. "row.status" or "vars.owner_id". */
const Path = z.string().trim().min(1).max(120);

export const FilterConfig = z.object({
	field: Path,
	op: z.enum(['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty', 'gt', 'lt']).default('equals'),
	value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const MapConfig = z.object({
	/** vars.<key> = template; "{{row.title}}" style interpolation. */
	assign: z.record(z.string().max(60), z.string().max(2000)).default({}),
});

export const RunSkillConfig = z.object({
	skill: z.string().trim().min(1).max(120),
	context: z.record(z.string(), z.string().max(2000)).default({}),
});

export const GenerateContentConfig = z.object({
	provider: z.string().trim().min(1).max(40),
	capability: z.string().trim().min(1).max(40),
	prompt: z.string().trim().min(1).max(4000),
});

export const NotifyConfig = z.object({
	/** A profile id, a dotted path resolving to one, or "requester". */
	to: z.string().trim().min(1).max(120),
	title: z.string().trim().min(1).max(200),
	body: z.string().trim().max(2000).default(''),
	href: z.string().trim().max(300).optional(),
});

export const WriteRowConfig = z.object({
	table: z.string().trim().min(1).max(60),
	mode: z.enum(['insert', 'update']).default('insert'),
	/** For update: which row. Template allowed. */
	match_id: z.string().trim().max(200).optional(),
	values: z.record(z.string().max(60), z.string().max(2000)).default({}),
});

export const WebhookConfig = z.object({
	url: z.string().trim().url().max(500),
	/** Which part of the context to POST; default the whole thing. */
	include: z.enum(['all', 'row', 'vars']).default('all'),
});

export const WaitConfig = z.object({
	minutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
	/** Alternative: a dotted path to an ISO timestamp / date in the context. */
	until_field: Path.optional(),
});

// Revenue Engine steps (0127). The deal is resolved from the trigger row:
// row.id when the source is rev_deals, row.deal_id for activities /
// contracts / calls; `deal.*` paths read the resolved deal in filters.
export const MoveStageConfig = z.object({
	/** Stage slug inside the deal's current pipeline (hand-off stages still hand off). */
	stage: z.string().trim().regex(/^[a-z0-9-]{1,60}$/),
	/** Only act when the deal sits in this pipeline slug. */
	only_if_pipeline: z.string().trim().max(60).optional(),
});
export const RescoreConfig = z.object({});
export const PushGhlConfig = z.object({ force: z.boolean().optional() });
export const CreateTaskRevenueConfig = z.object({
	title: z.string().trim().min(1).max(300),
	body: z.string().trim().max(2000).optional(),
	/** Minutes from now. */
	due_minutes: z.number().int().min(1).max(60 * 24 * 90).optional(),
	/** Profile id, dotted path, or 'owner' (the deal's lane owner). */
	owner: z.string().trim().max(120).optional(),
});

export const StepSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('filter'), config: FilterConfig }),
	z.object({ type: z.literal('map'), config: MapConfig }),
	z.object({ type: z.literal('run_skill'), config: RunSkillConfig }),
	z.object({ type: z.literal('generate_content'), config: GenerateContentConfig }),
	z.object({ type: z.literal('notify'), config: NotifyConfig }),
	z.object({ type: z.literal('write_row'), config: WriteRowConfig }),
	z.object({ type: z.literal('call_n8n_webhook'), config: WebhookConfig }),
	z.object({ type: z.literal('wait'), config: WaitConfig }),
	z.object({ type: z.literal('move_stage'), config: MoveStageConfig }),
	z.object({ type: z.literal('rescore'), config: RescoreConfig }),
	z.object({ type: z.literal('push_ghl'), config: PushGhlConfig }),
	z.object({ type: z.literal('create_task_revenue'), config: CreateTaskRevenueConfig }),
]);
export type Step = z.infer<typeof StepSchema>;

export const StepsSchema = z.array(StepSchema).max(20);

export const TriggerConfigSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('schedule'), cron: z.string().trim().regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, 'five cron fields') }),
	z.object({
		kind: z.literal('table_event'),
		table: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
		op: z.enum(['insert', 'update', 'delete', 'any']).default('any'),
	}),
	z.object({ kind: z.literal('ingest_event'), endpoint: z.string().trim().regex(/^[a-z0-9-]{1,60}$/) }),
	z.object({ kind: z.literal('manual') }),
]);

export interface AutomationRuleRow {
	id: string;
	name: string;
	slug: string;
	description_md: string | null;
	trigger_kind: TriggerKind;
	trigger_config: Record<string, unknown>;
	steps: Step[];
	enabled: boolean;
	requires_approval: boolean;
	approver_group: string | null;
	client_id: string | null;
	daily_run_cap: number;
	next_run_at: string | null;
	last_run_at: string | null;
	last_run_status: string | null;
	last_error: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface AutomationRunRow {
	id: string;
	rule_id: string;
	status: string;
	trigger_payload: Record<string, unknown>;
	step_results: unknown[];
	current_step: number;
	wake_at: string | null;
	error: string | null;
	requested_by: string | null;
	requested_via: string;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

/** Run context the steps read and write. `row` is the trigger row, `vars` accumulates map outputs. */
export interface RunContext {
	row: Record<string, unknown>;
	vars: Record<string, unknown>;
	rule: { id: string; slug: string; name: string };
	run: { id: string; requested_by: string | null };
}

export function getPath(ctx: RunContext, path: string): unknown {
	const parts = path.split('.');
	let cur: unknown = ctx;
	for (const p of parts) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[p];
	}
	return cur;
}

/** "{{row.title}} for {{vars.client}}" -> interpolated string. Missing -> ''. */
export function interpolate(template: string, ctx: RunContext): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, p: string) => {
		const v = getPath(ctx, p);
		if (v === undefined || v === null) return '';
		return typeof v === 'object' ? JSON.stringify(v) : String(v);
	});
}

export function evalFilter(cfg: z.infer<typeof FilterConfig>, ctx: RunContext): boolean {
	const actual = getPath(ctx, cfg.field);
	const expected = cfg.value;
	switch (cfg.op) {
		case 'equals':
			return String(actual ?? '') === String(expected ?? '');
		case 'not_equals':
			return String(actual ?? '') !== String(expected ?? '');
		case 'contains':
			return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
		case 'is_empty':
			return actual === undefined || actual === null || actual === '';
		case 'is_not_empty':
			return !(actual === undefined || actual === null || actual === '');
		case 'gt':
			return Number(actual) > Number(expected);
		case 'lt':
			return Number(actual) < Number(expected);
	}
}

/**
 * Next fire time for a five-field cron expression, evaluated in
 * America/Chicago, at minute resolution. Supports *, lists, ranges, steps
 * and MON-FRI / JAN-DEC names — the subset the builder offers. Walks forward
 * up to 366 days; returns null if nothing matches (a malformed expression).
 */
export function nextCronRun(expr: string, from: Date = new Date(), tz = 'America/Chicago'): Date | null {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const [minF, hourF, domF, monF, dowF] = fields;
	const min = parseField(minF, 0, 59);
	const hour = parseField(hourF, 0, 23);
	const dom = parseField(domF, 1, 31);
	const mon = parseField(monF, 1, 12, MONTHS);
	const dow = parseField(dowF, 0, 6, DAYS);
	if (!min || !hour || !dom || !mon || !dow) return null;
	const domAny = domF === '*';
	const dowAny = dowF === '*';

	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hour12: false,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		weekday: 'short',
	});
	let t = new Date(Math.ceil((from.getTime() + 1) / 60_000) * 60_000);
	const limit = from.getTime() + 366 * 24 * 3600_000;
	while (t.getTime() <= limit) {
		const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
		const h = Number(parts.hour) % 24;
		const m = Number(parts.minute);
		const d = Number(parts.day);
		const mo = Number(parts.month);
		const wd = DAYS.indexOf(String(parts.weekday).toUpperCase().slice(0, 3));
		const dayOk = domAny && dowAny ? true : domAny ? dow.has(wd) : dowAny ? dom.has(d) : dom.has(d) || dow.has(wd);
		if (mon.has(mo) && dayOk && hour.has(h) && min.has(m)) return t;
		// Skip ahead: if hour/day don't match, jump to the next hour; else next minute.
		t = new Date(t.getTime() + (hour.has(h) && dayOk && mon.has(mo) ? 60_000 : 3600_000 - (m * 60_000)));
	}
	return null;
}

const MONTHS = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseField(field: string, lo: number, hi: number, names?: string[]): Set<number> | null {
	const out = new Set<number>();
	const toNum = (s: string): number | null => {
		if (/^\d+$/.test(s)) return Number(s);
		if (names) {
			const i = names.indexOf(s.toUpperCase());
			if (i >= 0) return i;
		}
		return null;
	};
	for (const part of field.split(',')) {
		const [rangePart, stepPart] = part.split('/');
		const step = stepPart ? Number(stepPart) : 1;
		if (!Number.isInteger(step) || step < 1) return null;
		let a: number, b: number;
		if (rangePart === '*') {
			a = lo;
			b = hi;
		} else if (rangePart.includes('-')) {
			const [x, y] = rangePart.split('-');
			const nx = toNum(x);
			const ny = toNum(y);
			if (nx === null || ny === null) return null;
			a = nx;
			b = ny;
		} else {
			const n = toNum(rangePart);
			if (n === null) return null;
			a = n;
			b = stepPart ? hi : n;
		}
		if (a < lo || b > hi || a > b) return null;
		for (let v = a; v <= b; v += step) out.add(v === 7 && lo === 0 && hi === 6 ? 0 : v);
	}
	return out.size ? out : null;
}
