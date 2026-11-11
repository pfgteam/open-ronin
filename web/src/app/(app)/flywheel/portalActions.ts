'use server';

// Staff-side portal actions (F5): invite client contacts (magic link),
// deactivate, answer portal notes, withdraw an approval, trigger a Google
// metrics pull.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { FLYWHEEL_PATH } from '@/lib/flywheel/shared';
import { invitePortalUser, pullGoogleMetrics } from '@/lib/flywheel/portal';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const flag = z.string().optional().transform((v) => v === 'on' || v === 'true');

async function staffCanView(): Promise<boolean> {
	const supabase = await createClient();
	const { data } = await supabase.rpc('can_view_flywheel');
	return data === true;
}

export async function inviteContact(formData: FormData): Promise<Result<{ sent: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await staffCanView())) return { ok: false, error: 'Flywheel access needed.' };
	const p = z.object({ client_id: uuid, program_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), email: z.string().trim().email(), display_name: optText(120), contact_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)), is_primary: flag }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input.' };
	const svc = createServiceRoleClient();
	const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const r = await invitePortalUser(svc, { client_id: p.data.client_id, email: p.data.email, display_name: p.data.display_name, contact_id: p.data.contact_id, is_primary: p.data.is_primary, invited_by: profile.id, redirectTo: `${origin}/auth/callback?next=/portal` });
	if (!r.ok) return r;
	// contacts + client_contacts roster (0002 / 0144): create the contact if the email is new
	let contactId = p.data.contact_id;
	if (!contactId) {
		const { data: c } = await svc.from('contacts').select('id').ilike('email', p.data.email).limit(1).maybeSingle();
		contactId = (c as { id: string } | null)?.id ?? null;
		if (!contactId) {
			const [first, ...rest] = (p.data.display_name ?? p.data.email.split('@')[0]).split(' ');
			const { data: nc } = await svc.from('contacts').insert({ display_name: p.data.display_name ?? p.data.email, first_name: first, last_name: rest.join(' ') || null, email: p.data.email }).select('id').single();
			contactId = (nc as { id: string } | null)?.id ?? null;
		}
		if (contactId) {
			await svc.from('contact_roles').upsert({ contact_id: contactId, role: 'client', is_primary: p.data.is_primary }, { onConflict: 'contact_id,role', ignoreDuplicates: true });
			await svc.from('fw_portal_users').update({ contact_id: contactId }).eq('user_id', r.user_id).eq('client_id', p.data.client_id);
			const { data: ct } = await svc.from('contracts').select('airtable_contract_id').eq('client_id', p.data.client_id).not('airtable_contract_id', 'is', null).order('starts_on', { ascending: false }).limit(1).maybeSingle();
			const at = (ct as { airtable_contract_id: string } | null)?.airtable_contract_id;
			if (at) await svc.from('client_contacts').upsert({ airtable_contract_id: at, contact_id: contactId, client_id: p.data.client_id, relationship: 'portal', is_primary: p.data.is_primary }, { onConflict: 'airtable_contract_id,contact_id', ignoreDuplicates: true });
		}
	}
	if (p.data.program_id) await svc.rpc('fw_log', { p_program: p.data.program_id, p_kind: 'portal', p_summary: `Portal invite sent to ${p.data.email}${r.sent ? '' : ' (email not sent: SMTP not configured — copy a link from Supabase Auth)'}`, p_payload: { user_id: r.user_id }, p_client_visible: false, p_actor_label: null });
	await recordAudit({ actor_id: profile.id, entity_kind: 'auth', entity_ref: `portal:${r.user_id}`, action: 'flywheel.portal.invite', diff: { client_id: p.data.client_id } });
	revalidatePath(`${FLYWHEEL_PATH}/${p.data.program_id ?? ''}`, 'layout');
	revalidatePath(`/clients/${p.data.client_id}/portal`);
	return { ok: true, sent: r.sent };
}

export async function setPortalUserActive(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await staffCanView())) return { ok: false, error: 'Flywheel access needed.' };
	const p = z.object({ user_id: uuid, client_id: uuid, is_active: flag, program_id: z.string().optional() }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const svc = createServiceRoleClient();
	const { error } = await svc.from('fw_portal_users').update({ is_active: p.data.is_active }).eq('user_id', p.data.user_id).eq('client_id', p.data.client_id);
	if (error) return { ok: false, error: error.message };
	revalidatePath(`/clients/${p.data.client_id}/portal`);
	if (p.data.program_id) revalidatePath(`${FLYWHEEL_PATH}/${p.data.program_id}`, 'layout');
	return { ok: true };
}

export async function resendInvite(formData: FormData): Promise<Result<{ sent: boolean }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await staffCanView())) return { ok: false, error: 'Flywheel access needed.' };
	const p = z.object({ email: z.string().trim().email() }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const svc = createServiceRoleClient();
	const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const { error } = await svc.auth.signInWithOtp({ email: p.data.email.toLowerCase(), options: { emailRedirectTo: `${origin}/auth/callback?next=/portal`, shouldCreateUser: false } });
	return { ok: true, sent: !error };
}

export async function replyNote(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, status: z.enum(['open', 'acknowledged', 'in_progress', 'done', 'declined']).optional(), reply_md: optText(4000), internal_note: optText(4000), program_id: z.string().optional() }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { handled_by: profile.id };
	if (p.data.status) patch.status = p.data.status;
	if (formData.has('reply_md')) patch.reply_md = p.data.reply_md;
	if (formData.has('internal_note')) patch.internal_note = p.data.internal_note;
	const { error } = await supabase.from('fw_portal_notes').update(patch).eq('id', p.data.id);
	if (error) return { ok: false, error: error.message.includes('row-level security') ? 'Flywheel access needed.' : error.message };
	if (p.data.program_id) revalidatePath(`${FLYWHEEL_PATH}/${p.data.program_id}`, 'layout');
	revalidatePath(`${FLYWHEEL_PATH}/requests`);
	return { ok: true };
}

export async function withdrawApproval(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, program_id: uuid }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const { error } = await supabase.from('fw_approvals').update({ status: 'withdrawn', decided_by_label: `internal:${profile.id}` }).eq('id', p.data.id).eq('status', 'pending');
	if (error) return { ok: false, error: error.message };
	revalidatePath(`${FLYWHEEL_PATH}/${p.data.program_id}`, 'layout');
	return { ok: true };
}

export async function pullGoogleNow(formData: FormData): Promise<Result<{ rows: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await staffCanView())) return { ok: false, error: 'Flywheel access needed.' };
	const p = z.object({ client_id: uuid, program_id: z.string().optional() }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const r = await pullGoogleMetrics(createServiceRoleClient(), p.data.client_id);
	if (p.data.program_id) revalidatePath(`${FLYWHEEL_PATH}/${p.data.program_id}`, 'layout');
	return r.ok ? { ok: true, rows: r.rows } : { ok: false, error: r.error };
}
