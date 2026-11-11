// Revenue Engine ↔ GHL sync (0123, spec §5). Server-only.
//
// OUTBOUND (Open Ronin → GHL), pushDeal():
//   runs when ghl_cutover.push_prospects = 'main' and the deal is
//   ghl_push_status = 'eligible' (a positive reply or a booked-stage move
//   set it; the trigger re-flags a pushed deal when scores / owner / stage
//   change). Steps: contact upsert (email/phone match on the GHL side) →
//   tags (source tag + quality-<n>, old quality tag removed) → custom fields
//   (Heat, Quality) → opportunity create or update in the mapped pipeline /
//   stage (ghl_stage_overrides first, then rev_stages.ghl_stage_id, then
//   rev_pipelines.ghl_pipeline_id). One ghl_sync_log row per step; a failure
//   marks the deal 'failed' with the error so Admin can replay.
//
// INBOUND (GHL → Open Ronin), handleWebhook():
//   GHL workflow webhooks (ContactCreate/Update, OpportunityStageUpdate,
//   InboundMessage/OutboundMessage, AppointmentCreate/Update, FormSubmit,
//   CallCompleted…). Matched to a person by ghl_contact_id, then
//   email/phone; unknown contacts with a positive signal become intake via
//   the 'ghl' intake source mapping. Stage changes are LOGGED and applied
//   only when ghl_cutover.accept_ghl_stage_changes = 'main'. Open Ronin wins.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlFetch } from '@/lib/ghl/client';
import { flattenWebhookPayload, mapOpportunity, webhookExternalId, opportunityEvent, type GhlOpportunity, type ImportResult } from './ghlImport';
import { fetchUserEmails } from './ghlBackfill';

type Db = SupabaseClient;

export interface Cutover {
	[key: string]: 'ghl' | 'main' | 'off';
}

export async function loadCutover(db: Db): Promise<Cutover> {
	const { data } = await db.from('ghl_cutover').select('key, owner');
	const out: Cutover = {};
	for (const r of (data ?? []) as { key: string; owner: 'ghl' | 'main' | 'off' }[]) out[r.key] = r.owner;
	return out;
}

async function settings(db: Db): Promise<Record<string, unknown>> {
	const { data } = await db.from('ghl_settings').select('key, value');
	const out: Record<string, unknown> = {};
	for (const r of (data ?? []) as { key: string; value: unknown }[]) out[r.key] = r.value;
	return out;
}

interface Conn {
	id: string;
	ghl_location_id: string | null;
	label: string | null;
	org: string | null;
	is_default: boolean;
	disconnected_at: string | null;
}

/** The connection for a deal's org, else the default, else the first live one. */
export async function connectionFor(db: Db, org: string | null): Promise<Conn | null> {
	const { data } = await db.from('ghl_connections').select('id, ghl_location_id, label, org, is_default, disconnected_at').is('disconnected_at', null).order('installed_at');
	const rows = (data ?? []) as Conn[];
	return rows.find((c) => org && c.org === org) ?? rows.find((c) => c.is_default) ?? rows[0] ?? null;
}

async function log(db: Db, row: { connection_id?: string | null; direction: 'outbound' | 'inbound'; kind: string; status: 'ok' | 'failed' | 'skipped' | 'retry'; deal_id?: string | null; person_id?: string | null; ghl_contact_id?: string | null; ghl_opportunity_id?: string | null; summary?: string; payload?: unknown; error?: string | null }) {
	await db.from('ghl_sync_log').insert({ ...row, payload: row.payload ?? null });
}

export interface PushResult {
	deal_id: string;
	status: 'pushed' | 'failed' | 'skipped';
	ghl_contact_id?: string | null;
	ghl_opportunity_id?: string | null;
	error?: string;
}

interface DealForPush {
	id: string;
	title: string;
	motion: string;
	status: string;
	brand_id: string | null;
	primary_person_id: string | null;
	pipeline_id: string;
	stage_id: string;
	quality_score: number | null;
	heat_score: number | null;
	est_mrr_cents: number | null;
	est_one_time_cents: number | null;
	owner_lg_id: string | null;
	owner_setter_id: string | null;
	owner_closer_id: string | null;
	source: string | null;
	campaign: string | null;
	ghl_contact_id: string | null;
	ghl_opportunity_id: string | null;
	ghl_location_id: string | null;
	ghl_push_status: string | null;
}

interface PersonForPush {
	id: string;
	first_name: string | null;
	last_name: string | null;
	display_name: string;
	email: string | null;
	phone: string | null;
	ghl_contact_id: string | null;
	website: string | null;
}

function orgOfPipeline(brand: string | null): string | null {
	return brand === 'all' ? null : brand;
}

export async function pushDeal(db: Db, dealId: string, opts: { force?: boolean } = {}): Promise<PushResult> {
	const cut = await loadCutover(db);
	if (cut.push_prospects !== 'main' && !opts.force) {
		return { deal_id: dealId, status: 'skipped', error: 'push_prospects is off (Admin → Prospects → GHL)' };
	}
	const { data: d } = await db.from('rev_deals').select('*').eq('id', dealId).maybeSingle();
	const deal = d as DealForPush | null;
	if (!deal) return { deal_id: dealId, status: 'failed', error: 'deal not found' };
	if (!opts.force && deal.ghl_push_status !== 'eligible' && deal.ghl_push_status !== 'failed') {
		return { deal_id: dealId, status: 'skipped', error: `deal is ${deal.ghl_push_status ?? 'not eligible'}` };
	}
	const { data: p } = deal.primary_person_id ? await db.from('rev_people').select('id, first_name, last_name, display_name, email, phone, ghl_contact_id, website').eq('id', deal.primary_person_id).maybeSingle() : { data: null };
	const person = p as PersonForPush | null;
	if (!person || (!person.email && !person.phone)) {
		await db.from('rev_deals').update({ ghl_push_status: 'failed', ghl_push_error: 'no person with an email or phone' }).eq('id', dealId);
		await log(db, { direction: 'outbound', kind: 'contact_upsert', status: 'failed', deal_id: dealId, error: 'no person with an email or phone' });
		return { deal_id: dealId, status: 'failed', error: 'no person with an email or phone' };
	}
	const [{ data: pipe }, { data: stage }, { data: brand }, s] = await Promise.all([
		db.from('rev_pipelines').select('slug, brand, ghl_pipeline_id').eq('id', deal.pipeline_id).maybeSingle(),
		db.from('rev_stages').select('id, slug, name, ghl_stage_id, outcome').eq('id', deal.stage_id).maybeSingle(),
		deal.brand_id ? db.from('rev_brands').select('name, website, domain').eq('id', deal.brand_id).maybeSingle() : Promise.resolve({ data: null }),
		settings(db),
	]);
	const conn = await connectionFor(db, orgOfPipeline((pipe as { brand: string } | null)?.brand ?? null));
	if (!conn || !conn.ghl_location_id) {
		await db.from('rev_deals').update({ ghl_push_status: 'failed', ghl_push_error: 'no live GHL connection' }).eq('id', dealId);
		await log(db, { direction: 'outbound', kind: 'contact_upsert', status: 'failed', deal_id: dealId, error: 'no live GHL connection' });
		return { deal_id: dealId, status: 'failed', error: 'no live GHL connection' };
	}
	const loc = conn.ghl_location_id;
	const { data: ov } = await db.from('ghl_stage_overrides').select('ghl_pipeline_id').eq('stage_id', deal.stage_id).maybeSingle();
	const ghlPipelineId = (ov as { ghl_pipeline_id: string } | null)?.ghl_pipeline_id ?? (pipe as { ghl_pipeline_id: string | null } | null)?.ghl_pipeline_id ?? null;
	const ghlStageId = (stage as { ghl_stage_id: string | null } | null)?.ghl_stage_id ?? null;

	try {
		// 1. contact upsert
		const qualityPrefix = String(s.quality_tag_prefix ?? 'quality-');
		const sourceTag = String(s.source_tag ?? 'openronin');
		const tags = [sourceTag];
		if (deal.quality_score != null) tags.push(`${qualityPrefix}${deal.quality_score}`);
		const customFields: { key: string; field_value: string }[] = [];
		if (deal.heat_score != null && s.heat_field_key) customFields.push({ key: String(s.heat_field_key), field_value: String(deal.heat_score) });
		if (deal.quality_score != null && s.quality_field_key) customFields.push({ key: String(s.quality_field_key), field_value: String(deal.quality_score) });
		const contactBody: Record<string, unknown> = {
			locationId: loc,
			firstName: person.first_name ?? undefined,
			lastName: person.last_name ?? undefined,
			name: person.display_name,
			email: person.email ?? undefined,
			phone: person.phone ?? undefined,
			companyName: (brand as { name: string } | null)?.name ?? undefined,
			website: (brand as { website: string | null } | null)?.website ?? person.website ?? undefined,
			source: deal.source ?? 'openronin',
			tags,
			customFields,
		};
		const up = await ghlFetch<{ contact?: { id: string }; new?: boolean }>(conn.id, '/contacts/upsert', { method: 'POST', body: JSON.stringify(contactBody) });
		const contactId = up.contact?.id ?? person.ghl_contact_id ?? deal.ghl_contact_id;
		if (!contactId) throw new Error('upsert returned no contact id');
		await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'contact_upsert', status: 'ok', deal_id: dealId, person_id: person.id, ghl_contact_id: contactId, summary: `${up.new ? 'created' : 'updated'} ${person.display_name}`, payload: { tags, customFields } });

		// 2. tags: GHL upsert merges tags; drop stale quality-* tags explicitly
		try {
			const cur = await ghlFetch<{ contact?: { tags?: string[] } }>(conn.id, `/contacts/${contactId}`);
			const stale = (cur.contact?.tags ?? []).filter((t) => t.startsWith(qualityPrefix) && !tags.includes(t));
			if (stale.length) await ghlFetch(conn.id, `/contacts/${contactId}/tags`, { method: 'DELETE', body: JSON.stringify({ tags: stale }) });
			if (stale.length) await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'tag_sync', status: 'ok', deal_id: dealId, ghl_contact_id: contactId, summary: `removed ${stale.join(', ')}` });
		} catch (e) {
			await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'tag_sync', status: 'failed', deal_id: dealId, ghl_contact_id: contactId, error: (e as Error).message });
		}

		// 3. opportunity
		let oppId = deal.ghl_opportunity_id;
		const value = Math.round(((deal.est_mrr_cents ?? 0) + (deal.est_one_time_cents ?? 0)) / 100);
		const oppStatus = deal.status === 'won' ? 'won' : deal.status === 'lost' ? 'lost' : 'open';
		if (ghlPipelineId) {
			const oppBody: Record<string, unknown> = {
				pipelineId: ghlPipelineId,
				locationId: loc,
				name: `${deal.title}${String(s.opportunity_name_suffix ?? '')}`,
				status: oppStatus,
				contactId,
				...(ghlStageId ? { pipelineStageId: ghlStageId } : {}),
				...(value ? { monetaryValue: value } : {}),
				...(deal.source ? { source: deal.source } : {}),
			};
			if (oppId) {
				const { locationId: _l, contactId: _c, ...patch } = oppBody;
				void _l;
				void _c;
				await ghlFetch(conn.id, `/opportunities/${oppId}`, { method: 'PUT', body: JSON.stringify(patch) });
				await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'opportunity_update', status: 'ok', deal_id: dealId, ghl_contact_id: contactId, ghl_opportunity_id: oppId, summary: `${(stage as { name: string } | null)?.name ?? ''} · ${oppStatus}` });
			} else {
				const created = await ghlFetch<{ opportunity?: { id: string } }>(conn.id, '/opportunities/', { method: 'POST', body: JSON.stringify(oppBody) });
				oppId = created.opportunity?.id ?? null;
				await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'opportunity_create', status: oppId ? 'ok' : 'failed', deal_id: dealId, ghl_contact_id: contactId, ghl_opportunity_id: oppId, summary: `${(stage as { name: string } | null)?.name ?? ''} · ${oppStatus}` });
			}
		} else {
			await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'opportunity_create', status: 'skipped', deal_id: dealId, ghl_contact_id: contactId, summary: 'pipeline has no GHL id mapped' });
		}

		await db
			.from('rev_deals')
			.update({ ghl_push_status: 'pushed', ghl_push_error: null, ghl_pushed_at: new Date().toISOString(), ghl_contact_id: contactId, ghl_opportunity_id: oppId, ghl_location_id: loc, ghl_pipeline_id: ghlPipelineId, ghl_stage_id: ghlStageId })
			.eq('id', dealId);
		await db.from('rev_people').update({ ghl_contact_id: contactId, ghl_location_id: loc, ghl_pushed_at: new Date().toISOString() }).eq('id', person.id);
		await db.from('ghl_connections').update({ last_ok_at: new Date().toISOString(), last_error: null }).eq('id', conn.id);
		return { deal_id: dealId, status: 'pushed', ghl_contact_id: contactId, ghl_opportunity_id: oppId };
	} catch (e) {
		const msg = (e as Error).message.slice(0, 1000);
		await db.from('rev_deals').update({ ghl_push_status: 'failed', ghl_push_error: msg }).eq('id', dealId);
		await db.from('ghl_connections').update({ last_error: msg }).eq('id', conn.id);
		await log(db, { connection_id: conn.id, direction: 'outbound', kind: 'push', status: 'failed', deal_id: dealId, error: msg });
		return { deal_id: dealId, status: 'failed', error: msg };
	}
}

/** Push every eligible deal (and retry failed ones younger than 24h). */
export async function pushEligible(db: Db, limit = 25): Promise<PushResult[]> {
	const cut = await loadCutover(db);
	if (cut.push_prospects !== 'main') return [];
	const since = new Date(Date.now() - 24 * 3600_000).toISOString();
	const { data } = await db
		.from('rev_deals')
		.select('id')
		.eq('status', 'open')
		.or(`ghl_push_status.eq.eligible,and(ghl_push_status.eq.failed,ghl_eligible_at.gte.${since})`)
		.order('ghl_eligible_at')
		.limit(limit);
	const out: PushResult[] = [];
	for (const d of (data ?? []) as { id: string }[]) out.push(await pushDeal(db, d.id));
	return out;
}

// ---------------------------------------------------------------- inbound

export interface WebhookOutcome {
	status: 'processed' | 'ignored' | 'failed' | 'duplicate';
	deal_id?: string | null;
	note?: string;
}

function str(v: unknown): string | null {
	return v == null || v === '' ? null : String(v);
}

const POSITIVE_RE = /\b(yes|interested|sure|sounds good|let'?s (talk|chat|do it)|book|schedule|tell me more|love to)\b/i;

/** Opportunity events (0155): the API copy of the opportunity is the truth, the payload only names it. */
async function handleOpportunityEvent(db: Db, type: string, oppId: string, payload: Record<string, unknown>): Promise<WebhookOutcome> {
	const conn = await connectionFor(db, 'main');
	if (!conn?.ghl_location_id) return { status: 'ignored', note: 'no GHL connection' };
	let opp: GhlOpportunity | null = null;
	try {
		opp = (await ghlFetch<{ opportunity?: GhlOpportunity }>(conn.id, `/opportunities/${encodeURIComponent(oppId)}`)).opportunity ?? null;
	} catch (e) {
		await log(db, { connection_id: conn.id, direction: 'inbound', kind: `webhook:${type}`, status: 'failed', ghl_opportunity_id: oppId, error: (e as Error).message });
	}
	const stageId = opp?.pipelineStageId ?? str(payload.pipelineStageId) ?? str(payload.pipleineStageId) ?? str(payload.stageId);

	let deal = ((await db.from('rev_deals').select('id, stage_id, status').eq('ghl_opportunity_id', oppId).maybeSingle()).data as { id: string; stage_id: string; status: string } | null) ?? null;
	if (!deal) deal = ((await db.from('rev_deals').select('id, stage_id, status').contains('meta', { ghl_opportunity_ids: [oppId] }).limit(1).maybeSingle()).data as { id: string; stage_id: string; status: string } | null) ?? null;

	if (!deal) {
		if (!opp) return { status: 'ignored', note: 'unknown opportunity and the GHL API did not return it' };
		const row = mapOpportunity(opp, { locationId: conn.ghl_location_id, userEmails: await fetchUserEmails(conn.id, conn.ghl_location_id) });
		if (!row) return { status: 'ignored', note: 'opportunity could not be mapped' };
		const { data, error } = await db.rpc('rev_ghl_import_rows', { p_rows: [row] });
		if (error) throw new Error(error.message);
		const res = ((data ?? []) as ImportResult[])[0];
		await log(db, { connection_id: conn.id, direction: 'inbound', kind: `webhook:${type}`, status: res?.deal_id ? 'ok' : 'skipped', deal_id: res?.deal_id ?? null, ghl_opportunity_id: oppId, summary: `import: ${res?.status ?? '?'}${res?.reason ? ` (${res.reason})` : ''}` });
		return { status: res?.deal_id ? 'processed' : 'ignored', deal_id: res?.deal_id ?? null, note: `import ${res?.status ?? '?'}` };
	}

	// GHL won / lost wins over the stage id: land on the lane's outcome stage
	const { data: m } = stageId ? await db.from('ghl_stage_map').select('pipeline_slug, stage_slug').eq('ghl_stage_id', stageId).maybeSingle() : { data: null };
	const map = m as { pipeline_slug: string; stage_slug: string } | null;
	let target: { id: string; name: string } | null = null;
	if (map) {
		const status = opp?.status ?? 'open';
		const pipeSlug = status === 'won' ? (map.pipeline_slug === 'beacon' ? 'beacon' : 'closer') : map.pipeline_slug;
		const { data: pipe } = await db.from('rev_pipelines').select('id').eq('slug', pipeSlug).maybeSingle();
		if (pipe) {
			let q = db.from('rev_stages').select('id, name').eq('pipeline_id', (pipe as { id: string }).id);
			q = status === 'won' ? q.eq('outcome', 'won') : status === 'lost' || status === 'abandoned' ? q.eq('outcome', 'lost') : q.eq('slug', map.stage_slug);
			target = ((await q.order('position').limit(1).maybeSingle()).data as { id: string; name: string } | null) ?? null;
		}
	}
	const cut = await loadCutover(db);
	if (target && cut.accept_ghl_stage_changes === 'main' && target.id !== deal.stage_id) {
		await db.from('rev_deals').update({ stage_id: target.id, ghl_stage_id: stageId }).eq('id', deal.id);
		await log(db, { connection_id: conn.id, direction: 'inbound', kind: 'stage_change_applied', status: 'ok', deal_id: deal.id, ghl_opportunity_id: oppId, summary: `→ ${target.name}` });
		return { status: 'processed', deal_id: deal.id, note: 'stage applied' };
	}
	await log(db, { connection_id: conn.id, direction: 'inbound', kind: 'stage_change_ignored', status: 'skipped', deal_id: deal.id, ghl_opportunity_id: oppId, summary: `GHL stage ${stageId ?? '?'} → ${target?.name ?? 'unmapped'}${cut.accept_ghl_stage_changes === 'main' ? '' : ' (accept_ghl_stage_changes off)'}` });
	return { status: 'processed', deal_id: deal.id, note: 'stage logged, not applied' };
}

export async function handleWebhook(db: Db, rawPayload: Record<string, unknown>): Promise<WebhookOutcome> {
	const payload = flattenWebhookPayload(rawPayload);
	const type = str(payload.type) ?? str(payload.event) ?? str(payload.eventType) ?? 'unknown';
	const locationId = str(payload.locationId) ?? str(payload.location_id);
	const contactId = str(payload.contactId) ?? str(payload.contact_id) ?? str((payload.contact as { id?: string } | undefined)?.id) ?? (type.startsWith('Contact') ? str(payload.id) : null);
	const oppId = str(payload.opportunityId) ?? str(payload.opportunity_id) ?? (type.startsWith('Opportunity') ? str(payload.id) : null);
	const externalId = webhookExternalId(payload);

	const { data: ev, error: evErr } = await db
		.from('ghl_webhook_events')
		.insert({ event_type: type, ghl_location_id: locationId, ghl_contact_id: contactId, ghl_opportunity_id: oppId, external_id: externalId, payload })
		.select('id')
		.single();
	if (evErr) {
		if (evErr.code === '23505') return { status: 'duplicate' };
		return { status: 'failed', note: evErr.message };
	}
	const finish = async (o: WebhookOutcome) => {
		await db.from('ghl_webhook_events').update({ status: o.status === 'duplicate' ? 'ignored' : o.status, deal_id: o.deal_id ?? null, error: o.status === 'failed' ? o.note : null, processed_at: new Date().toISOString() }).eq('id', ev.id);
		return o;
	};

	try {
		const oe = opportunityEvent(payload);
		if (oe) return finish(await handleOpportunityEvent(db, oe.type, oe.oppId, payload));

		// resolve person: ghl id, then email / phone
		const email = str(payload.email) ?? str((payload.contact as { email?: string } | undefined)?.email);
		const phone = str(payload.phone) ?? str((payload.contact as { phone?: string } | undefined)?.phone);
		let person: { id: string } | null = null;
		if (contactId) person = ((await db.from('rev_people').select('id').eq('ghl_contact_id', contactId).maybeSingle()).data as { id: string } | null) ?? null;
		if (!person && email) person = ((await db.from('rev_people').select('id').eq('email_key', email.toLowerCase()).maybeSingle()).data as { id: string } | null) ?? null;
		if (!person && phone) person = ((await db.from('rev_people').select('id').eq('phone', phone.replace(/[^0-9+]/g, '')).maybeSingle()).data as { id: string } | null) ?? null;

		type DealRef = { id: string; stage_id: string; ghl_opportunity_id: string | null };
		let deal: DealRef | null = null;
		if (oppId) deal = ((await db.from('rev_deals').select('id, stage_id, ghl_opportunity_id').eq('ghl_opportunity_id', oppId).maybeSingle()).data as DealRef | null) ?? null;
		if (!deal && person) deal = ((await db.from('rev_deals').select('id, stage_id, ghl_opportunity_id').eq('primary_person_id', person.id).eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle()).data as DealRef | null) ?? null;

		const body = str(payload.body) ?? str(payload.message) ?? str((payload.message as { body?: string } | undefined)?.body);
		const direction = /inbound/i.test(type) || payload.direction === 'inbound' ? 'inbound' : /outbound/i.test(type) || payload.direction === 'outbound' ? 'outbound' : null;
		const isMessage = /message|sms|email|conversation/i.test(type);
		const isCall = /call/i.test(type);
		const isAppt = /appointment|calendar/i.test(type);
		const isForm = /form|survey/i.test(type);
		const isContact = /^contact/i.test(type);

		// unknown person + inbound signal → intake through the 'ghl' source map
		if (!person && (isForm || isContact || (isMessage && direction === 'inbound'))) {
			const { data: src } = await db.from('rev_intake_sources').select('*').eq('key', 'ghl').maybeSingle();
			if (src && (email || phone || str(payload.first_name) || str(payload.full_name))) {
				const { processIntake } = await import('./intake');
				const r = await processIntake(db, src as unknown as import('./intake').IntakeSourceRow, { ...payload, id: contactId ?? payload.id, location_id: locationId });
				if (r.status === 'processed' && r.deal_id) {
					if (contactId) await db.from('rev_people').update({ ghl_contact_id: contactId, ghl_location_id: locationId }).eq('id', r.person_id ?? '');
					await log(db, { direction: 'inbound', kind: `webhook:${type}`, status: 'ok', deal_id: r.deal_id, ghl_contact_id: contactId, summary: 'new prospect from GHL' });
					return finish({ status: 'processed', deal_id: r.deal_id, note: 'intake' });
				}
			}
			await log(db, { direction: 'inbound', kind: `webhook:${type}`, status: 'skipped', ghl_contact_id: contactId, summary: 'no matching person' });
			return finish({ status: 'ignored', note: 'no matching person' });
		}
		if (!person) return finish({ status: 'ignored', note: 'no matching person' });

		if (contactId) await db.from('rev_people').update({ ghl_contact_id: contactId, ghl_location_id: locationId }).eq('id', person.id).is('ghl_contact_id', null);

		// activities
		const kind = isCall ? 'call' : isAppt ? 'meeting' : isForm ? 'form' : isMessage ? (/sms/i.test(type) || payload.messageType === 'SMS' ? 'sms' : /email/i.test(type) || payload.messageType === 'Email' ? 'email' : 'dm') : isContact ? 'system' : 'system';
		const positive = direction === 'inbound' && !!body && POSITIVE_RE.test(body);
		const { error: aErr } = await db.from('rev_activities').insert({
			deal_id: deal?.id ?? null,
			person_id: person.id,
			kind,
			channel: 'ghl',
			direction: direction ?? (isAppt || isForm ? 'inbound' : 'internal'),
			actor_kind: direction === 'outbound' ? 'human' : 'prospect',
			subject: isAppt ? `Appointment ${str(payload.status) ?? str(payload.appointmentStatus) ?? ''}`.trim() : isCall ? `Call ${str(payload.status) ?? str(payload.callStatus) ?? ''}`.trim() : `GHL ${type}`,
			body_md: body?.slice(0, 4000) ?? null,
			recording_url: str(payload.recordingUrl) ?? null,
			duration_sec: typeof payload.duration === 'number' ? payload.duration : null,
			is_touch: isMessage || isCall || isAppt || isForm,
			is_positive: positive ? true : null,
			external_source: 'ghl',
			external_id: externalId,
			occurred_at: str(payload.dateAdded) ?? str(payload.timestamp) ?? new Date().toISOString(),
			meta: { event_type: type },
		});
		if (aErr && aErr.code !== '23505') throw new Error(aErr.message);
		await log(db, { direction: 'inbound', kind: `webhook:${type}`, status: 'ok', deal_id: deal?.id ?? null, person_id: person.id, ghl_contact_id: contactId, ghl_opportunity_id: oppId, summary: kind + (positive ? ' (positive)' : '') });
		return finish({ status: 'processed', deal_id: deal?.id ?? null });
	} catch (e) {
		await log(db, { direction: 'inbound', kind: `webhook:${type}`, status: 'failed', ghl_contact_id: contactId, error: (e as Error).message });
		return finish({ status: 'failed', note: (e as Error).message });
	}
}

/** Replay a failed sync-log row: re-push its deal. */
export async function replayLog(db: Db, logId: string): Promise<PushResult | null> {
	const { data } = await db.from('ghl_sync_log').select('id, deal_id, attempts').eq('id', logId).maybeSingle();
	const row = data as { id: string; deal_id: string | null; attempts: number } | null;
	if (!row?.deal_id) return null;
	await db.from('ghl_sync_log').update({ status: 'retry', attempts: row.attempts + 1, retried_at: new Date().toISOString() }).eq('id', logId);
	return pushDeal(db, row.deal_id, { force: true });
}

/** Round-trip the connection: GET the location. */
export async function testConnection(db: Db, connectionId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
	const { data } = await db.from('ghl_connections').select('ghl_location_id').eq('id', connectionId).maybeSingle();
	const loc = (data as { ghl_location_id: string | null } | null)?.ghl_location_id;
	if (!loc) return { ok: false, error: 'no location id' };
	try {
		const r = await ghlFetch<{ location?: { name?: string } }>(connectionId, `/locations/${loc}`);
		await db.from('ghl_connections').update({ last_ok_at: new Date().toISOString(), last_error: null }).eq('id', connectionId);
		return { ok: true, name: r.location?.name };
	} catch (e) {
		await db.from('ghl_connections').update({ last_error: (e as Error).message.slice(0, 500) }).eq('id', connectionId);
		return { ok: false, error: (e as Error).message };
	}
}
