'use server';

// Revenue Engine server actions (0121). Thin: zod on FormData, RLS on the
// tables (can_view_revenue for rep writes, can_manage_revenue for config and
// merges) is the guard, recordAudit on every write. Return { ok, error } for
// the client forms; the board drag uses moveDeal the same way.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { BUDGET_BANDS, LOGGABLE_KINDS, MOTIONS, PERSON_ROLES, TIMINGS } from '@/lib/revenue/shared';
import { nextActionWrite } from '@/lib/revenue/nextAction';
import { ilikeEscape, quickAddError, splitDisplayName } from '@/lib/revenue/dealPage';
import { cleanTerm } from '@/lib/revenue/lists';

type Result = { ok: true; id?: string } | { ok: false; error: string };

const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optCents = z
	.string()
	.trim()
	.optional()
	.transform((v) => {
		if (!v) return null;
		const n = Number(v.replace(/[$,\s]/g, ''));
		return Number.isFinite(n) ? Math.round(n * 100) : null;
	});
const optUuid = z.string().trim().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null));
const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).or(z.literal('')).optional().transform((v) => (v ? v : null));

function revalidate(dealId?: string, personId?: string, brandId?: string) {
	revalidatePath('/prospects');
	revalidatePath('/prospects/deals');
	revalidatePath('/prospects/people');
	revalidatePath('/prospects/brands');
	revalidatePath('/prospects/duplicates');
	revalidatePath('/admin/prospects', 'layout');
	if (dealId) revalidatePath(`/prospects/deals/${dealId}`);
	if (personId) revalidatePath(`/prospects/people/${personId}`);
	if (brandId) revalidatePath(`/prospects/brands/${brandId}`);
}

async function viewer() {
	const profile = await getAuthProfile();
	if (!profile) return null;
	return profile;
}

// ---------------------------------------------------------------- intake

const IntakeInput = z.object({
	first_name: optText(100),
	last_name: optText(100),
	display_name: optText(200),
	title: optText(120),
	email: z.string().trim().max(200).optional().transform((v) => (v ? v.toLowerCase() : null)),
	phone: optText(40),
	linkedin_url: optText(300),
	instagram: optText(120),
	website: optText(300),
	location: optText(120),
	notes: optText(5000),
	brand_name: optText(200),
	brand_website: optText(300),
	company_name: optText(200),
	industry: optText(120),
	vertical: optText(120),
	person_role: optEnum(PERSON_ROLES),
	pipeline: z.string().trim().min(1, 'Pick a pipeline'),
	stage: optText(80),
	motion: optEnum(MOTIONS),
	product_slugs: z.array(z.string()).optional(),
	est_mrr: optCents,
	est_one_time: optCents,
	source: optText(60),
	campaign: optText(120),
	channel: optText(60),
	owner_email: optText(200),
});

/** Manual add: everything goes through rev_intake() so dedupe is one path. */
export async function addProspect(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const raw = Object.fromEntries(formData) as Record<string, unknown>;
	raw.product_slugs = formData.getAll('product_slugs').map(String).filter(Boolean);
	const parsed = IntakeInput.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	// The quick Add form (spec 2026-10-20 §7) is stricter: a name plus an email or a phone.
	const form = formData.get('form');
	if (form === 'quick' || form === 'quick-prefill') {
		const e = quickAddError({ display_name: d.display_name ?? '', first_name: d.first_name ?? '', last_name: d.last_name ?? '', email: d.email ?? '', phone: d.phone ?? '', linkedin_url: d.linkedin_url ?? '', brand_name: d.brand_name ?? '', pipeline: d.pipeline, prefilled: form === 'quick-prefill' });
		if (e) return { ok: false, error: e.message };
	}
	// rev_intake keeps display_name as given and the GHL push sends first_name: split a single Name field.
	if (!d.first_name && !d.last_name && d.display_name) {
		const n = splitDisplayName(d.display_name);
		d.first_name = n.first_name;
		d.last_name = n.last_name;
	}
	if (!d.display_name && !d.first_name && !d.last_name && !d.email && !d.phone && !d.linkedin_url && !d.brand_name) {
		return { ok: false, error: 'Give at least a name, email, phone, LinkedIn URL or brand.' };
	}
	const payload: Record<string, unknown> = {
		...d,
		est_mrr_cents: d.est_mrr,
		est_one_time_cents: d.est_one_time,
		created_via: 'ui',
		activity: { kind: 'note', subject: 'Added by hand', is_touch: false },
	};
	delete payload.est_mrr;
	delete payload.est_one_time;
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('rev_intake', { p: payload });
	if (error) return { ok: false, error: error.message };
	const out = data as { deal_id: string | null; person_id: string; matched_on: string | null };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${out.deal_id ?? out.person_id}`, action: 'revenue.intake', diff: { matched_on: out.matched_on, pipeline: d.pipeline } });
	revalidate(out.deal_id ?? undefined, out.person_id);
	return { ok: true, id: out.deal_id ?? out.person_id };
}

/**
 * Quick add's "already exists" notes (spec 2026-10-20 §7). Read-only and
 * informational: rev_intake still dedupes on submit. People match on
 * email_key = lower(btrim(email)); brands on the exact name, case-insensitive.
 */
export async function lookupExisting(input: { email?: string; brand?: string }): Promise<{ person: { id: string; name: string } | null; brand: { id: string; name: string; openDeals: number } | null }> {
	if (!(await viewer())) return { person: null, brand: null };
	const supabase = await createClient();
	const email = input.email?.trim().toLowerCase() ?? '';
	const brandName = input.brand?.trim() ?? '';
	const [p, b] = await Promise.all([
		email.includes('@') ? supabase.from('rev_people').select('id, display_name').eq('email_key', email).limit(1).maybeSingle() : Promise.resolve({ data: null }),
		brandName.length >= 2 ? supabase.from('rev_brands').select('id, name').ilike('name', ilikeEscape(brandName)).limit(1).maybeSingle() : Promise.resolve({ data: null }),
	]);
	const person = p.data as { id: string; display_name: string } | null;
	const brand = b.data as { id: string; name: string } | null;
	let openDeals = 0;
	if (brand) {
		const { count } = await supabase.from('rev_deals').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id).eq('status', 'open');
		openDeals = count ?? 0;
	}
	return { person: person ? { id: person.id, name: person.display_name } : null, brand: brand ? { id: brand.id, name: brand.name, openDeals } : null };
}

/** Form-action variant: add then land on the deal page. */
export async function addProspectAndOpen(formData: FormData): Promise<void> {
	const r = await addProspect(formData);
	if (!r.ok) redirect(`/prospects/deals/new?error=${encodeURIComponent(r.error)}`);
	redirect(`/prospects/deals/${r.id}`);
}

// ---------------------------------------------------------------- deals

const MoveInput = z.object({ deal_id: uuid, stage_id: uuid, note: optText(500) });

/** Board drag / stage select. The stage guard in SQL validates, hands off and logs history. */
export async function moveDeal(input: { deal_id: string; stage_id: string; note?: string }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = MoveInput.safeParse(input);
	if (!parsed.success) return { ok: false, error: 'Invalid move.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_deals').update({ stage_id: parsed.data.stage_id }, { count: 'exact' }).eq('id', parsed.data.deal_id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing moved: the deal is not visible to you.' };
	if (parsed.data.note) {
		await supabase.from('rev_activities').insert({ deal_id: parsed.data.deal_id, kind: 'note', actor_id: profile.id, subject: 'Stage note', body_md: parsed.data.note, is_touch: false });
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${parsed.data.deal_id}`, action: 'revenue.deal.move', diff: { stage_id: parsed.data.stage_id } });
	revalidate(parsed.data.deal_id);
	return { ok: true };
}

/** Snooze: set only the next action + due time (My Day). */
export async function snoozeDeal(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = z.object({ deal_id: uuid, next_action: optText(300), next_action_at: optText(40) }).safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { error, count } = await supabase
		.from('rev_deals')
		.update({ next_action: d.next_action ?? 'Follow up', next_action_at: d.next_action_at ? new Date(d.next_action_at).toISOString() : null }, { count: 'exact' })
		.eq('id', d.deal_id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	revalidate(d.deal_id);
	revalidatePath('/');
	return { ok: true };
}

const DealInput = z.object({
	id: uuid,
	title: z.string().trim().min(1).max(240),
	motion: z.enum(MOTIONS),
	est_mrr: optCents,
	est_one_time: optCents,
	owner_lg_id: optUuid,
	owner_setter_id: optUuid,
	owner_closer_id: optUuid,
	source: optText(60),
	campaign: optText(120),
	channel: optText(60),
	budget_band: optEnum(BUDGET_BANDS),
	timing: optEnum(TIMINGS),
	next_action: optText(300),
	next_action_at: optText(40),
	lost_reason: optText(300),
	product_ids: z.array(z.string().uuid()).optional(),
});

export async function updateDeal(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const raw = Object.fromEntries(formData) as Record<string, unknown>;
	raw.product_ids = formData.getAll('product_ids').map(String).filter(Boolean);
	const parsed = DealInput.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, est_mrr, est_one_time, next_action_at, ...rest } = parsed.data;
	const patch = {
		...rest,
		est_mrr_cents: est_mrr,
		est_one_time_cents: est_one_time,
		next_action_at: next_action_at ? new Date(next_action_at).toISOString() : null,
		product_ids: rest.product_ids ?? [],
	};
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_deals').update(patch, { count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${id}`, action: 'revenue.deal.update', diff: patch });
	revalidate(id);
	return { ok: true };
}

const ActivityInput = z.object({
	deal_id: uuid,
	person_id: optUuid,
	kind: z.enum(LOGGABLE_KINDS as unknown as [string, ...string[]]),
	channel: optText(40),
	direction: z.enum(['inbound', 'outbound', 'internal']).optional().default('outbound'),
	disposition_id: optUuid,
	subject: optText(200),
	body_md: optText(10000),
	is_positive: z.string().optional().transform((v) => (v === 'yes' ? true : v === 'no' ? false : null)),
	occurred_at: optText(40),
	next_action: optText(300),
	next_action_at: optText(40),
	// "No next step" in the log form: the only way a log clears the next action (spec 2026-10-20 §4.2).
	clear_next: z.literal('yes').optional(),
});

/** Log a call / message / note. Required after every call (dispositions are the configurable list). */
export async function logActivity(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ActivityInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (d.kind === 'call' && !d.disposition_id) return { ok: false, error: 'Pick an outcome for the call.' };
	const supabase = await createClient();
	const { error } = await supabase.from('rev_activities').insert({
		deal_id: d.deal_id,
		person_id: d.person_id,
		kind: d.kind,
		channel: d.channel ?? (d.kind === 'call' ? 'phone' : d.kind === 'email' ? 'email' : null),
		direction: d.direction,
		actor_id: profile.id,
		actor_kind: 'human',
		disposition_id: d.disposition_id,
		subject: d.subject,
		body_md: d.body_md,
		is_touch: d.kind !== 'note',
		is_positive: d.is_positive,
		occurred_at: d.occurred_at ? new Date(d.occurred_at).toISOString() : new Date().toISOString(),
	});
	if (error) return { ok: false, error: friendly(error.message) };
	// Absent fields are left alone: a log that does not touch the next step keeps its text and due time.
	const next = nextActionWrite({ next_action: d.next_action, next_action_at: d.next_action_at, clear: d.clear_next === 'yes' });
	if (next) await supabase.from('rev_deals').update(next).eq('id', d.deal_id);
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_deals/${d.deal_id}`, action: `revenue.activity.${d.kind}`, diff: { disposition_id: d.disposition_id, is_positive: d.is_positive } });
	revalidate(d.deal_id, d.person_id ?? undefined);
	return { ok: true };
}

const TaskInput = z.object({ deal_id: optUuid, person_id: optUuid, title: z.string().trim().min(1).max(300), due_at: optText(40), owner_id: optUuid });

export async function addTask(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = TaskInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (!d.deal_id && !d.person_id) return { ok: false, error: 'A task needs a deal or a person.' };
	const supabase = await createClient();
	// A to-do on a deal goes to the rep responsible for it (0159), not whoever
	// typed it; me when the deal has none or 0159 is not applied yet.
	const responsible = !d.owner_id && d.deal_id ? (await supabase.rpc('rev_deal_responsible', { p_deal_id: d.deal_id })).data : null;
	const { error } = await supabase.from('rev_tasks').insert({
		deal_id: d.deal_id,
		person_id: d.person_id,
		owner_id: d.owner_id ?? (typeof responsible === 'string' ? responsible : null) ?? profile.id,
		title: d.title,
		due_at: d.due_at ? new Date(d.due_at).toISOString() : null,
		created_by: profile.id,
	});
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(d.deal_id ?? undefined, d.person_id ?? undefined);
	return { ok: true };
}

export async function toggleTask(input: { id: string; done: boolean; deal_id?: string | null; person_id?: string | null }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid task.' };
	const supabase = await createClient();
	const { error } = await supabase.from('rev_tasks').update({ done_at: input.done ? new Date().toISOString() : null }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidate(input.deal_id ?? undefined, input.person_id ?? undefined);
	return { ok: true };
}

// ---------------------------------------------------------------- people / brands

const PersonInput = z.object({
	id: uuid,
	first_name: optText(100),
	last_name: optText(100),
	display_name: z.string().trim().min(1).max(200),
	title: optText(120),
	email: z.string().trim().max(200).optional().transform((v) => (v ? v.toLowerCase() : null)),
	phone: optText(40),
	linkedin_url: optText(300),
	instagram: optText(120),
	facebook: optText(200),
	tiktok: optText(120),
	x_handle: optText(120),
	website: optText(300),
	location: optText(120),
	notes_md: optText(10000),
	do_not_contact: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

export async function updatePerson(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = PersonInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...patch } = parsed.data;
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_people').update(patch, { count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_people/${id}`, action: 'revenue.person.update', diff: patch });
	revalidate(undefined, id);
	return { ok: true };
}

const BrandInput = z.object({
	id: uuid,
	name: z.string().trim().min(1).max(200),
	domain: optText(200),
	website: optText(300),
	industry: optText(120),
	vertical: optText(120),
	description: optText(5000),
	instagram: optText(200),
	facebook: optText(200),
	tiktok: optText(200),
	x: optText(200),
	linkedin: optText(300),
	youtube: optText(300),
});

export async function updateBrand(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = BrandInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, instagram, facebook, tiktok, x, linkedin, youtube, ...rest } = parsed.data;
	const socials: Record<string, string> = {};
	for (const [k, v] of Object.entries({ instagram, facebook, tiktok, x, linkedin, youtube })) if (v) socials[k] = v;
	const patch = { ...rest, domain: rest.domain ? rest.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') : null, socials };
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_brands').update(patch, { count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_brands/${id}`, action: 'revenue.brand.update', diff: patch });
	revalidate(undefined, undefined, id);
	return { ok: true };
}

// ---------------------------------------------------------------- person ↔ brand links
// A brand holds many people (owner, marketing manager, assistant…) and a
// person can sit on many brands. One link per person + brand (the role is an
// attribute of it), and at most one primary contact per brand. RLS (0121):
// any revenue viewer links and sets primary; only manage_revenue deletes, so
// Remove checks the capability and the deleted count.

const LinkInput = z.object({ person_id: uuid, brand_id: uuid, role: z.enum(PERSON_ROLES), is_primary: z.boolean() });

export async function linkPerson(input: { person_id: string; brand_id: string; role: string; is_primary: boolean }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = LinkInput.safeParse(input);
	if (!parsed.success) return { ok: false, error: 'Pick a person, a brand and a role.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { data: existing } = await supabase.from('rev_person_links').select('id').eq('person_id', d.person_id).eq('brand_id', d.brand_id).limit(1);
	if (existing?.length) return { ok: false, error: 'Already linked to this brand.' };
	// Insert first, then move "primary": a failed insert must not leave the brand without its primary contact.
	const { data: created, error } = await supabase.from('rev_person_links').insert({ person_id: d.person_id, brand_id: d.brand_id, role: d.role, is_primary: false }).select('id').single();
	if (error) return { ok: false, error: error.message.includes('rev_person_links_uniq') ? 'Already linked to this brand.' : friendly(error.message) };
	if (d.is_primary) {
		const linkId = (created as { id: string }).id;
		const cleared = await supabase.from('rev_person_links').update({ is_primary: false }).eq('brand_id', d.brand_id).eq('is_primary', true).neq('id', linkId);
		const set = cleared.error ? cleared : await supabase.from('rev_person_links').update({ is_primary: true }).eq('id', linkId);
		if (set.error) return { ok: false, error: `Linked, but not made primary: ${friendly(set.error.message)}` };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_brands/${d.brand_id}`, action: 'revenue.person.link', diff: { person_id: d.person_id, role: d.role, is_primary: d.is_primary } });
	revalidate(undefined, d.person_id, d.brand_id);
	return { ok: true };
}

/** Make one link the brand's primary contact (and clear the old one). */
export async function setPrimaryLink(input: { id: string; person_id: string; brand_id: string }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (![input.id, input.person_id, input.brand_id].every((v) => uuid.safeParse(v).success)) return { ok: false, error: 'Invalid link.' };
	const supabase = await createClient();
	const cleared = await supabase.from('rev_person_links').update({ is_primary: false }).eq('brand_id', input.brand_id).eq('is_primary', true).neq('id', input.id);
	if (cleared.error) return { ok: false, error: friendly(cleared.error.message) };
	const { error, count } = await supabase.from('rev_person_links').update({ is_primary: true }, { count: 'exact' }).eq('id', input.id).eq('brand_id', input.brand_id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'That link no longer exists.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_brands/${input.brand_id}`, action: 'revenue.person.primary', diff: { person_id: input.person_id } });
	revalidate(undefined, input.person_id, input.brand_id);
	return { ok: true };
}

export async function unlinkPerson(input: { id: string; person_id: string; brand_id?: string | null }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid link.' };
	if (!(await hasCapability('manage_revenue'))) return { ok: false, error: 'Only Prospects managers can remove a link.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_person_links').delete({ count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing removed: the link is gone or you cannot remove it.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_brands/${input.brand_id ?? 'none'}`, action: 'revenue.person.unlink', diff: { link_id: input.id, person_id: input.person_id } });
	revalidate(undefined, input.person_id, input.brand_id ?? undefined);
	return { ok: true };
}

/** Typeahead for the link dialog: up to 8 people or brands matching the term. */
export async function searchLinkTargets(input: { kind: 'person' | 'brand'; q: string }): Promise<{ id: string; label: string; sub: string | null }[]> {
	const profile = await viewer();
	if (!profile) return [];
	const term = cleanTerm(String(input.q ?? ''));
	if (term.length < 2) return [];
	const supabase = await createClient();
	if (input.kind === 'person') {
		const { data } = await supabase
			.from('rev_people')
			.select('id, display_name, title, email')
			.or(`display_name.ilike.%${term}%,email_key.ilike.%${term.toLowerCase()}%`)
			.order('display_name')
			.limit(8);
		return ((data ?? []) as { id: string; display_name: string; title: string | null; email: string | null }[]).map((p) => ({ id: p.id, label: p.display_name, sub: [p.title, p.email].filter(Boolean).join(' · ') || null }));
	}
	const { data } = await supabase.from('rev_brands').select('id, name, domain').or(`name.ilike.%${term}%,domain.ilike.%${term}%`).order('name').limit(8);
	return ((data ?? []) as { id: string; name: string; domain: string | null }[]).map((b) => ({ id: b.id, label: b.name, sub: b.domain }));
}

// ---------------------------------------------------------------- duplicates

export async function decideDuplicate(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const id = String(formData.get('id') ?? '');
	const decision = String(formData.get('decision') ?? '');
	const keep = String(formData.get('keep_id') ?? '');
	const drop = String(formData.get('drop_id') ?? '');
	if (!uuid.safeParse(id).success) return { ok: false, error: 'Invalid candidate.' };
	// Every decision needs the capability: dismiss used to pass on RLS alone (rep table), unlike what the screen said.
	if (!(await hasCapability('manage_revenue'))) return { ok: false, error: 'Deciding duplicates needs the Configure the Revenue Engine capability.' };
	const supabase = await createClient();
	if (decision === 'dismiss') {
		const { error } = await supabase.from('rev_duplicate_candidates').update({ status: 'dismissed', decided_by: profile.id, decided_at: new Date().toISOString() }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
	} else if (decision === 'merge' || decision === 'merge_swap') {
		const [k, d] = decision === 'merge' ? [keep, drop] : [drop, keep];
		if (!uuid.safeParse(k).success || !uuid.safeParse(d).success) return { ok: false, error: 'Invalid pair.' };
		const { error } = await supabase.rpc('rev_merge_people', { p_keep: k, p_drop: d });
		if (error) return { ok: false, error: friendly(error.message) };
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_people/${k}`, action: 'revenue.person.merge', diff: { dropped: d, candidate: id } });
	} else {
		return { ok: false, error: 'Unknown decision.' };
	}
	revalidate();
	return { ok: true };
}

// ---------------------------------------------------------------- catalog (manage_revenue)

const ProductInput = z.object({
	id: optUuid,
	slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, dashes'),
	name: z.string().trim().min(1).max(160),
	brand: z.enum(['main', 'premium', 'beacon']),
	family: z.enum(['pr', 'music', 'social', 'ads', 'addon', 'beacon', 'strategy', 'low_ticket', 'other']),
	kind: z.enum(['retainer', 'subscription', 'one_time', 'addon']),
	price: optCents,
	price_max: optCents,
	per_unit: optCents,
	unit_label: optText(80),
	deliverables_md: optText(10000),
	terms_md: optText(10000),
	position: z.coerce.number().int().min(0).max(10000).optional().default(100),
	is_active: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

export async function saveProduct(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ProductInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, price, price_max, per_unit, ...rest } = parsed.data;
	const row = { ...rest, price_cents: price, price_max_cents: price_max, per_unit_cents: per_unit };
	const supabase = await createClient();
	if (id) {
		// Slugs are referenced by intake (product_slugs) and contracts: fixed once created.
		const { slug: _slug, ...patch } = row;
		void _slug;
		const { error, count } = await supabase.from('rev_products').update(patch, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	} else {
		const { error } = await supabase.from('rev_products').insert(row);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_products/${id ?? rest.slug}`, action: 'revenue.product.save', diff: row });
	revalidatePath('/prospects/products');
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

const PipelineInput = z.object({
	id: optUuid,
	slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, dashes'),
	name: z.string().trim().min(1).max(120),
	lane: z.enum(['marketing', 'lead_gen', 'setter', 'closer', 'full_cycle', 'other']),
	brand: z.enum(['main', 'premium', 'beacon', 'all']),
	description: optText(1000),
	ghl_pipeline_id: optText(80),
	position: z.coerce.number().int().min(0).max(10000).optional().default(100),
	is_active: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

export async function savePipeline(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = PipelineInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...row } = parsed.data;
	const supabase = await createClient();
	if (id) {
		// The slug is a handle (intake defaults, GHL stage map, SQL): fixed once created.
		const { slug: _slug, ...patch } = row;
		void _slug;
		const { error, count } = await supabase.from('rev_pipelines').update(patch, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	} else {
		const { error } = await supabase.from('rev_pipelines').insert(row);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_pipelines/${id ?? row.slug}`, action: 'revenue.pipeline.save', diff: row });
	revalidatePath('/admin/prospects', 'layout');
	revalidatePath('/prospects');
	return { ok: true };
}

const StageInput = z.object({
	id: optUuid,
	pipeline_id: uuid,
	slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, dashes'),
	name: z.string().trim().min(1).max(120),
	position: z.coerce.number().int().min(0).max(10000).optional().default(100),
	probability: z.coerce.number().int().min(0).max(100).optional().default(0),
	sla_hours: z.string().trim().optional().transform((v) => (v && Number(v) > 0 ? Math.round(Number(v)) : null)),
	// Picked from the deal-column allow-list (adminOptions.REQUIRED_FIELD_OPTIONS); legacy values pass if well-formed.
	required_fields: z.array(z.string().regex(/^[a-z_]+$/)).optional().default([]),
	outcome: z.enum(['open', 'won', 'lost']),
	handoff_pipeline_id: optUuid,
	handoff_stage_slug: optText(60),
	ghl_stage_id: optText(80),
});

export async function saveStage(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const raw = Object.fromEntries(formData) as Record<string, unknown>;
	raw.required_fields = formData.getAll('required_fields').map(String).filter(Boolean);
	const parsed = StageInput.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...row } = parsed.data;
	if (!row.handoff_pipeline_id) row.handoff_stage_slug = null;
	const supabase = await createClient();
	if (id) {
		const { slug: _slug, pipeline_id: _pipe, ...patch } = row;
		void _slug;
		void _pipe;
		const { error, count } = await supabase.from('rev_stages').update(patch, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	} else {
		const { error } = await supabase.from('rev_stages').insert(row);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_stages/${id ?? row.slug}`, action: 'revenue.stage.save', diff: row });
	revalidatePath('/admin/prospects', 'layout');
	revalidatePath('/prospects');
	return { ok: true };
}

export async function deleteStage(input: { id: string }): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid stage.' };
	const supabase = await createClient();
	const { count: inUse } = await supabase.from('rev_deals').select('id', { count: 'exact', head: true }).eq('stage_id', input.id);
	if (inUse) return { ok: false, error: `${inUse} deal(s) sit in this stage. Move them first.` };
	const { error, count } = await supabase.from('rev_stages').delete({ count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing deleted: you need the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_stages/${input.id}`, action: 'revenue.stage.delete' });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

const DispositionInput = z.object({
	id: optUuid,
	slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, dashes'),
	name: z.string().trim().min(1).max(120),
	kind: z.enum(['call', 'dm', 'email', 'meeting']),
	// Buckets rev_daily_metrics reads (adminOptions.COUNTS_AS_OPTIONS); legacy 'dial' is kept when present. heat_delta is not edited: nothing reads it.
	counts_as: z.array(z.string().regex(/^[a-z_]+$/)).optional().default([]),
	position: z.coerce.number().int().min(0).max(10000).optional().default(100),
	is_active: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

export async function saveDisposition(formData: FormData): Promise<Result> {
	const profile = await viewer();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const raw = Object.fromEntries(formData) as Record<string, unknown>;
	raw.counts_as = formData.getAll('counts_as').map(String).filter(Boolean);
	const parsed = DispositionInput.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...row } = parsed.data;
	const supabase = await createClient();
	if (id) {
		const { slug: _slug, ...patch } = row;
		void _slug;
		const { error, count } = await supabase.from('rev_dispositions').update(patch, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	} else {
		const { error } = await supabase.from('rev_dispositions').insert(row);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_dispositions/${id ?? row.slug}`, action: 'revenue.disposition.save', diff: row });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

function friendly(message: string): string {
	if (message.includes('requires') && message.includes('to be set')) return message.replace(/^.*rev_deals: /, '');
	if (message.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	return message;
}
