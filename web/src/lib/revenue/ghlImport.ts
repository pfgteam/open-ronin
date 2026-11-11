// GHL → Revenue Engine mapping (0155). Pure: no server imports, so the
// backfill runner, the webhook handler and the tests share one definition of
// "what a GHL opportunity becomes". The SQL side is rev_ghl_import_rows().

export interface GhlContactLite {
	id?: string;
	name?: string | null;
	companyName?: string | null;
	email?: string | null;
	phone?: string | null;
	tags?: string[];
}

export interface GhlOpportunity {
	id: string;
	name?: string | null;
	monetaryValue?: number | null;
	pipelineId: string;
	pipelineStageId: string;
	status: string;
	source?: string | null;
	assignedTo?: string | null;
	createdAt?: string | null;
	lastStageChangeAt?: string | null;
	lastStatusChangeAt?: string | null;
	contactId?: string | null;
	locationId?: string | null;
	contact?: GhlContactLite | null;
}

export type GhlStatus = 'open' | 'won' | 'lost' | 'abandoned';
const STATUSES: readonly GhlStatus[] = ['open', 'won', 'lost', 'abandoned'];
export const BACKFILL_STATUSES = ['won', 'lost', 'abandoned', 'open'] as const;

export interface GhlImportRow {
	ghl_opportunity_id: string;
	ghl_contact_id: string | null;
	ghl_location_id: string;
	ghl_pipeline_id: string;
	ghl_stage_id: string;
	ghl_status: GhlStatus;
	created_at: string | null;
	last_stage_change_at: string | null;
	last_status_change_at: string | null;
	value_cents: number | null;
	owner_email: string | null;
	ghl_source: string | null;
	person: { display_name: string; email?: string; phone?: string; company_name?: string };
}

export type ImportStatus = 'imported' | 'merged' | 'exists' | 'skipped' | 'error';
export interface ImportResult {
	opp: string | null;
	status: ImportStatus;
	deal_id?: string;
	reason?: string;
	error?: string;
}

function clean(v: string | null | undefined): string | null {
	const t = (v ?? '').trim();
	return t ? t : null;
}

export function mapOpportunity(o: GhlOpportunity, ctx: { locationId: string; userEmails: Record<string, string> }): GhlImportRow | null {
	if (!clean(o.id) || !clean(o.pipelineId) || !clean(o.pipelineStageId)) return null;
	if (!(STATUSES as readonly string[]).includes(o.status)) return null;
	const c = o.contact ?? {};
	const email = clean(c.email);
	const phone = clean(c.phone);
	const display = clean(c.name) ?? clean(o.name) ?? email ?? phone ?? 'GHL contact';
	const company = clean(c.companyName);
	const person: GhlImportRow['person'] = { display_name: display };
	if (email) person.email = email;
	if (phone) person.phone = phone;
	if (company && company.toLowerCase() !== display.toLowerCase()) person.company_name = company;
	return {
		ghl_opportunity_id: o.id,
		ghl_contact_id: clean(c.id) ?? clean(o.contactId),
		ghl_location_id: clean(o.locationId) ?? ctx.locationId,
		ghl_pipeline_id: o.pipelineId,
		ghl_stage_id: o.pipelineStageId,
		ghl_status: o.status as GhlStatus,
		created_at: clean(o.createdAt),
		last_stage_change_at: clean(o.lastStageChangeAt),
		last_status_change_at: clean(o.lastStatusChangeAt),
		value_cents: o.monetaryValue && o.monetaryValue > 0 ? Math.round(o.monetaryValue * 100) : null,
		owner_email: (o.assignedTo && ctx.userEmails[o.assignedTo]) || null,
		ghl_source: clean(o.source),
		person,
	};
}

function str(v: unknown): string | null {
	return v == null || v === '' ? null : String(v);
}

/** An opportunity event and its id, from a native GHL webhook or a workflow "Webhook" action with custom data. */
export function opportunityEvent(payload: Record<string, unknown>): { type: string; oppId: string } | null {
	const type = str(payload.type) ?? str(payload.event) ?? str(payload.eventType);
	if (!type || !/^opportunity/i.test(type)) return null;
	const oppId = str(payload.opportunityId) ?? str(payload.opportunity_id) ?? str(payload.id);
	return oppId ? { type, oppId } : null;
}

export function ghlContactUrl(base: string | null | undefined, locationId: string | null | undefined, contactId: string | null | undefined): string | null {
	const b = clean(base);
	const l = clean(locationId);
	const c = clean(contactId);
	if (!b || !l || !c) return null;
	return `${b.replace(/\/+$/, '')}/v2/location/${l}/contacts/detail/${c}`;
}

export function pageRows(opps: GhlOpportunity[], ctx: { locationId: string; userEmails: Record<string, string>; since: string | null }): { rows: GhlImportRow[]; reachedSince: boolean } {
	const sinceMs = ctx.since ? Date.parse(ctx.since) : null;
	let reachedSince = false;
	const rows: GhlImportRow[] = [];
	for (const o of opps) {
		if (sinceMs != null && o.createdAt && Date.parse(o.createdAt) < sinceMs) {
			reachedSince = true;
			continue;
		}
		const row = mapOpportunity(o, ctx);
		if (row) rows.push(row);
	}
	return { rows, reachedSince };
}

export function countResults(results: ImportResult[]): { imported: number; existed: number; skipped: number; failed: number } {
	const t = { imported: 0, existed: 0, skipped: 0, failed: 0 };
	for (const r of results) {
		if (r.status === 'imported' || r.status === 'merged') t.imported++;
		else if (r.status === 'exists') t.existed++;
		else if (r.status === 'skipped') t.skipped++;
		else t.failed++;
	}
	return t;
}

export interface BackfillRunRow {
	id: string;
	connection_id: string;
	ghl_pipeline_id: string;
	ghl_status: GhlStatus;
	since: string | null;
	state: 'queued' | 'running' | 'done' | 'failed';
	cursor_after: number | null;
	cursor_after_id: string | null;
	fetched: number;
	imported: number;
	existed: number;
	skipped: number;
	failed: number;
	last_error: string | null;
	created_at: string;
	finished_at: string | null;
}

/** History (won / lost / abandoned) before open, so a reopened brand lands on a fresh open deal. */
export function nextRun(runs: BackfillRunRow[]): BackfillRunRow | null {
	const live = runs.filter((r) => r.state === 'queued' || r.state === 'running');
	live.sort((a, b) => Number(a.ghl_status === 'open') - Number(b.ghl_status === 'open') || a.created_at.localeCompare(b.created_at));
	return live[0] ?? null;
}

export function backfillSince(now: Date = new Date()): string {
	const d = new Date(now.getTime());
	d.setUTCFullYear(d.getUTCFullYear() - 1);
	return d.toISOString();
}

/**
 * GHL workflow "Webhook" actions post contact fields at the top level, Custom
 * Data under customData, and appointment data under calendar (status is not
 * offered as Custom Data, and GHL spells it appoinmentStatus). Lift both to
 * the top level the handler reads; native top-level fields always win.
 */
export function flattenWebhookPayload(payload: Record<string, unknown>): Record<string, unknown> {
	const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
	const cd = obj(payload.customData);
	const cal = obj(payload.calendar);
	const fromCalendar: Record<string, unknown> = {};
	if (cal) {
		const status = cal.appoinmentStatus ?? cal.appointmentStatus ?? cal.status;
		if (status != null) fromCalendar.appointmentStatus = status;
		if (cal.appointmentId != null) fromCalendar.appointmentId = cal.appointmentId;
	}
	if (!cd && !cal) return payload;
	return { ...fromCalendar, ...(cd ?? {}), ...payload };
}

/** A backfill page ends the run when it is short, reached `since`, or the cursor is incomplete (no restart from page 1). */
export function pageFinished(p: { count: number; reachedSince: boolean; after: number | null; afterId: string | null }): boolean {
	return p.reachedSince || p.count < 100 || p.after == null || !p.afterId;
}

/**
 * The dedupe key for ghl_webhook_events (unique on event_type + external_id).
 * Only ids that name ONE event qualify: a webhook id, a message id, an
 * appointment id plus its status, or an id plus a timestamp. A bare
 * opportunity id names the opportunity, not the move, so it returns null and
 * every stage move is processed (processing is idempotent anyway).
 */
export function webhookExternalId(payload: Record<string, unknown>): string | null {
	const s = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
	const appt = s(payload.appointmentId);
	if (s(payload.webhookId)) return s(payload.webhookId);
	if (s(payload.messageId)) return s(payload.messageId);
	if (appt) return `${appt}:${s(payload.appointmentStatus) ?? s(payload.status) ?? ''}`;
	if (s(payload.id) && s(payload.timestamp)) return `${s(payload.id)}:${s(payload.timestamp)}`;
	return null;
}
