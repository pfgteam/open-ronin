'use server';

// Proof Library actions (0160): edit case studies / testimonials / assets,
// manage slots and placements. RLS (can_manage_revenue) is the real guard;
// a zero-row update is reported as a permission problem.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
	ASSET_TYPES,
	ITEM_KINDS,
	KIND_SEGMENTS,
	KIND_TABLES,
	PROOF_INDUSTRIES,
	PROOF_SERVICES,
	PROOF_STATUSES,
	SLOT_MEDIA_TYPES,
	SLOT_STRATEGIES,
	slugify,
	splitList,
	type ItemKind,
} from '@/lib/proof/shared';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const PATH = '/prospects/proof';

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: editing the Proof Library needs the manage_revenue capability.';
	if (m.includes('PROOF_SLOT_MEDIA')) return 'That slot takes a different media type (video and written proof never share a slot).';
	if (m.includes('PROOF_SLOT_KIND')) return 'That slot takes a different kind of item.';
	if (m.includes('duplicate key')) return 'Already there (same slug, or the item is already in that slot).';
	return m;
}

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const list = z.string().optional().transform((v) => splitList(v ?? ''));
const checks = (allowed: readonly string[]) =>
	z.union([z.string(), z.array(z.string())]).optional().transform((v) => (Array.isArray(v) ? v : v ? [v] : []).filter((s) => allowed.includes(s)));
const url = z.string().trim().max(1000).optional().transform((v) => (v ? v : null)).refine((v) => !v || /^https?:\/\//.test(v), 'URLs must start with http(s)://');
const bool = z.string().optional().transform((v) => v === 'on' || v === 'true' || v === '1');
const intOrNull = (min: number, max: number) =>
	z.string().optional().transform((v) => (v && v.trim() ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), `Must be a whole number between ${min} and ${max}.`);

const Common = {
	client_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	industry: z.enum(PROOF_INDUSTRIES).default('other'),
	services: checks(PROOF_SERVICES),
	status: z.enum(PROOF_STATUSES).default('draft'),
	tags: list,
	source_urls: list,
	thumbnail_url: url,
};

const CaseStudyInput = z.object({
	...Common,
	slug: z.string().trim().max(80).optional().transform((v) => (v ? slugify(v) : null)),
	client_name: z.string().trim().min(1, 'Client name is required.').max(200),
	year: intOrNull(2010, 2100),
	headline: text(300),
	problem: text(5000),
	approach: text(5000),
	results: text(8000),
	metrics: z.string().optional().transform((v, ctx) => {
		if (!v || !v.trim()) return {};
		try {
			const parsed = JSON.parse(v);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
			return parsed as Record<string, unknown>;
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Metrics must be a JSON object, e.g. {"placements": 12}.' });
			return {};
		}
	}),
	notable_outlets: list,
	quote: text(3000),
	quote_person: text(200),
	quote_title: text(200),
	media_type: z.enum(['text', 'video']).default('text'),
	video_url: url,
	image_url: url,
	is_featured: bool,
	strength: intOrNull(0, 100).transform((v) => v ?? 0),
});

const TestimonialInput = z.object({
	...Common,
	slug: z.string().trim().max(80).optional().transform((v) => (v ? slugify(v) : null)),
	quote: z.string().trim().min(1, 'The quote is required.').max(5000),
	person: text(200),
	title: text(200),
	company: text(200),
	case_study_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	media_type: z.enum(['text', 'video', 'image']).default('text'),
	video_url: url,
	image_url: url,
	source: text(300),
	rating: intOrNull(1, 5),
	is_featured: bool,
});

const AssetInput = z.object({
	...Common,
	type: z.enum(ASSET_TYPES),
	label: z.string().trim().min(1, 'Label is required.').max(300),
	url,
	value: text(100),
	description: text(2000),
	case_study_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
});

function parseFor(kind: ItemKind, fd: FormData) {
	const obj: Record<string, unknown> = {};
	for (const [k, v] of fd.entries()) {
		if (typeof v !== 'string') continue;
		if (k in obj) obj[k] = ([] as string[]).concat(obj[k] as string | string[], v);
		else obj[k] = v;
	}
	if (kind === 'case_study') return CaseStudyInput.safeParse(obj);
	if (kind === 'testimonial') return TestimonialInput.safeParse(obj);
	return AssetInput.safeParse(obj);
}

/** Create or update one item. `id` empty = create. */
export async function saveProofItem(kind: ItemKind, id: string | null, formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!ITEM_KINDS.includes(kind)) return { ok: false, error: 'Unknown kind.' };
	if (id && !uuid.safeParse(id).success) return { ok: false, error: 'Bad id.' };
	const parsed = parseFor(kind, formData);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data as Record<string, unknown>;
	if (kind !== 'asset' && !d.slug) {
		d.slug = slugify(kind === 'case_study' ? String(d.client_name) : [d.company, d.person].filter(Boolean).join(' ') || 'testimonial');
		if (!id) d.slug = `${d.slug}-${Math.random().toString(36).slice(2, 6)}`;
	}
	if (kind === 'testimonial' && d.media_type === 'video' && !d.video_url) return { ok: false, error: 'A video testimonial needs a video URL.' };
	if (kind === 'asset' && d.type !== 'stat' && !d.url) return { ok: false, error: 'This asset type needs a URL (or upload it to the proof-assets bucket).' };
	if (kind === 'asset' && d.type === 'stat' && !d.value) return { ok: false, error: 'A stat needs its value ("1,200+ placements").' };
	const supabase = await createClient();
	const table = KIND_TABLES[kind];
	let outId = id;
	if (id) {
		const { error, count } = await supabase.from(table).update(d, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: editing needs the manage_revenue capability.' };
	} else {
		const { data, error } = await supabase.from(table).insert({ ...d, created_by: profile.id }).select('id').single();
		if (error) return { ok: false, error: friendly(error.message) };
		outId = (data as { id: string }).id;
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `${table}/${outId}`, action: `proof.${kind}.${id ? 'update' : 'create'}`, diff: { status: d.status, industry: d.industry } });
	revalidatePath(PATH);
	revalidatePath(`${PATH}/${KIND_SEGMENTS[kind]}/${outId}`);
	return { ok: true, id: outId! };
}

export async function setProofStatus(kind: ItemKind, id: string, status: 'draft' | 'ready' | 'hidden'): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!ITEM_KINDS.includes(kind) || !uuid.safeParse(id).success || !PROOF_STATUSES.includes(status)) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from(KIND_TABLES[kind]).update({ status }, { count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated: editing needs the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `${KIND_TABLES[kind]}/${id}`, action: `proof.${kind}.status`, diff: { status } });
	revalidatePath(PATH);
	return { ok: true };
}

export async function deleteProofItem(kind: ItemKind, id: string): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!ITEM_KINDS.includes(kind) || !uuid.safeParse(id).success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	await supabase.from('proof_placements').delete().eq('item_kind', kind).eq('item_id', id);
	const { error, count } = await supabase.from(KIND_TABLES[kind]).delete({ count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing deleted: this needs the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `${KIND_TABLES[kind]}/${id}`, action: `proof.${kind}.delete` });
	revalidatePath(PATH);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Slots + placements
// ---------------------------------------------------------------------------

const SlotInput = z.object({
	key: z.string().trim().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, 'Key looks like page.slot, lowercase (home.case_studies).'),
	label: z.string().trim().min(1).max(200),
	page: z.string().trim().min(1).max(80),
	item_kind: z.enum(ITEM_KINDS),
	media_type: z.enum(SLOT_MEDIA_TYPES),
	max_items: intOrNull(1, 24).transform((v) => v ?? 3),
	strategy: z.enum(SLOT_STRATEGIES).default('weighted'),
	industry: z.string().optional().transform((v) => (v && (PROOF_INDUSTRIES as readonly string[]).includes(v) ? v : null)),
	notes: text(1000),
	active: bool,
});

export async function saveSlot(existingKey: string | null, formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = SlotInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (d.item_kind === 'case_study' && d.media_type === 'image') return { ok: false, error: 'Case-study slots are text or video.' };
	if (d.item_kind === 'asset' && d.media_type === 'text') return { ok: false, error: 'Asset slots are image or video.' };
	const supabase = await createClient();
	if (existingKey) {
		const { key: _k, ...patch } = d;
		void _k;
		const { error, count } = await supabase.from('proof_slots').update(patch, { count: 'exact' }).eq('key', existingKey);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: this needs the manage_revenue capability.' };
	} else {
		const { error } = await supabase.from('proof_slots').insert(d);
		if (error) return { ok: false, error: friendly(error.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `proof_slots/${existingKey ?? d.key}`, action: `proof.slot.${existingKey ? 'update' : 'create'}` });
	revalidatePath(`${PATH}/slots`);
	return { ok: true };
}

export async function addPlacement(input: { slot_key: string; item_kind: ItemKind; item_id: string; variant?: string; weight?: number }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!ITEM_KINDS.includes(input.item_kind) || !uuid.safeParse(input.item_id).success || !/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(input.slot_key)) return { ok: false, error: 'Invalid input.' };
	const variant = (input.variant ?? 'a').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'a';
	const weight = Math.min(Math.max(Math.round(input.weight ?? 100), 0), 1000);
	const supabase = await createClient();
	const { error } = await supabase.from('proof_placements').insert({ slot_key: input.slot_key, item_kind: input.item_kind, item_id: input.item_id, variant, weight, created_by: profile.id });
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `proof_placements/${input.slot_key}`, action: 'proof.placement.add', diff: { item_kind: input.item_kind, item_id: input.item_id } });
	revalidatePath(`${PATH}/slots`);
	return { ok: true };
}

export async function updatePlacement(input: { id: string; weight?: number; active?: boolean; variant?: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid input.' };
	const patch: Record<string, unknown> = {};
	if (input.weight !== undefined) patch.weight = Math.min(Math.max(Math.round(input.weight), 0), 1000);
	if (input.active !== undefined) patch.active = !!input.active;
	if (input.variant !== undefined) patch.variant = input.variant.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'a';
	if (!Object.keys(patch).length) return { ok: true };
	const supabase = await createClient();
	const { error, count } = await supabase.from('proof_placements').update(patch, { count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated: this needs the manage_revenue capability.' };
	revalidatePath(`${PATH}/slots`);
	return { ok: true };
}

export async function removePlacement(id: string): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(id).success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { error, count } = await supabase.from('proof_placements').delete({ count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing removed: this needs the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `proof_placements/${id}`, action: 'proof.placement.remove' });
	revalidatePath(`${PATH}/slots`);
	return { ok: true };
}
