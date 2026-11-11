'use server';

// Revenue Engine P7 actions (0127): referral codes + payouts, feedback
// requests, reviews.

import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const PATH = '/prospects/referrals';

function friendly(m: string) {
	return m.includes('row-level security') ? 'Not allowed: you do not hold the permission for this write.' : m;
}
function appUrl() {
	return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
}

const CodeInput = z.object({
	referrer_person_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	referrer_client_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	referrer_name: optText(160),
	referrer_email: z.string().trim().email().optional().or(z.literal('')).transform((v) => (v ? v.toLowerCase() : null)),
	kind: z.enum(['non_client', 'client', 'staff']).default('non_client'),
	code: z.string().trim().regex(/^[A-Za-z0-9_-]{4,40}$/).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

/** Mint a referral code / "send us a lead" link for a person, client or affiliate. */
export async function createReferralCode(formData: FormData): Promise<Result<{ code: string; url: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = CodeInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	if (!d.referrer_person_id && !d.referrer_client_id && !d.referrer_email) return { ok: false, error: 'Pick a person or client, or give an email.' };
	const code = d.code ?? (d.referrer_name ? d.referrer_name.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() : 'REF') + randomBytes(2).toString('hex').toUpperCase();
	const supabase = await createClient();
	const { error } = await supabase.from('rev_referral_codes').insert({ code, referrer_person_id: d.referrer_person_id, referrer_client_id: d.referrer_client_id, referrer_name: d.referrer_name, referrer_email: d.referrer_email, kind: d.kind, created_by: profile.id });
	if (error) return { ok: false, error: error.message.includes('duplicate') ? 'That code is taken.' : friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_referral_codes/${code}`, action: 'revenue.referral_code.create', diff: { kind: d.kind } });
	revalidatePath(PATH);
	return { ok: true, code, url: `${appUrl()}/refer/${code}` };
}

export async function attachReferral(input: { deal_id: string; code: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.deal_id).success || !/^[A-Za-z0-9_-]{4,40}$/.test(input.code)) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('rev_attach_referral', { p_deal: input.deal_id, p_code: input.code });
	if (error) return { ok: false, error: friendly(error.message) };
	if (!data) return { ok: false, error: 'Unknown or inactive code.' };
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	revalidatePath(PATH);
	return { ok: true };
}

export async function markPayout(input: { id: string; status: 'paid' | 'void' | 'due'; note?: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid payout.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: input.status, note: input.note ?? null };
	if (input.status === 'paid') {
		patch.paid_at = new Date().toISOString();
		patch.paid_by = profile.id;
	}
	const { error, count } = await supabase.from('rev_commission_payouts').update(patch, { count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated: payouts need the manage_revenue capability.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_commission_payouts/${input.id}`, action: `revenue.payout.${input.status}` });
	revalidatePath(PATH);
	return { ok: true };
}

/** Mint the feedback link for a pending feedback row (shown once; emailed by the rep). */
export async function mintFeedbackLink(input: { id: string }): Promise<Result<{ url: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!uuid.safeParse(input.id).success) return { ok: false, error: 'Invalid row.' };
	const supabase = await createClient();
	const { data: f } = await supabase.from('rev_feedback').select('id, submitted_at').eq('id', input.id).maybeSingle();
	if (!f) return { ok: false, error: 'Not visible to you.' };
	if (f.submitted_at) return { ok: false, error: 'Already submitted.' };
	const token = randomBytes(18).toString('base64url');
	const { error } = await createServiceRoleClient().from('rev_feedback').update({ token_hash: createHash('sha256').update(token).digest('hex'), requested_at: new Date().toISOString() }).eq('id', input.id);
	if (error) return { ok: false, error: error.message };
	revalidatePath(PATH);
	return { ok: true, url: `${appUrl()}/feedback/${token}` };
}

const ReviewInput = z.object({ id: uuid, status: z.enum(['requested', 'reminded', 'collected', 'declined', 'void']), platform: optText(40), url: optText(500), rating: z.string().optional().transform((v) => (v && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null)), quote: optText(2000), display: z.string().optional().transform((v) => v === 'on' || v === 'true') });

export async function saveReview(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ReviewInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...patch } = parsed.data;
	const supabase = await createClient();
	const { error, count } = await supabase.from('rev_reviews').update({ ...patch, ...(patch.status === 'collected' ? { collected_at: new Date().toISOString() } : {}) }, { count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	revalidatePath(PATH);
	return { ok: true };
}

export async function requestReview(input: { deal_id?: string | null; client_id?: string | null; milestone: 'signed' | 'first_placement' | 'day_90' | 'renewal' | 'manual' }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!input.deal_id && !input.client_id) return { ok: false, error: 'A deal or client is needed.' };
	const supabase = await createClient();
	const { error } = await supabase.from('rev_reviews').insert({ deal_id: input.deal_id ?? null, client_id: input.client_id ?? null, milestone: input.milestone, requested_by: profile.id });
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(PATH);
	return { ok: true };
}
