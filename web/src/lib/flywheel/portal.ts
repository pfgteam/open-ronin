// Client portal (F5, 0144). Server-only.
//
// A portal visitor is a Supabase auth user with app_metadata.portal = true
// and a fw_portal_users row. Their JWT matches no public row (the
// restrictive portal_block policy on every table), so every read here goes
// through the SERVICE ROLE, scoped by the client_id on their portal row,
// and every write re-checks that scope. Nothing internal (notes_md,
// internal_note, team names beyond the strategist, costs) is selected.

import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { decryptToken, encryptToken } from '@/lib/ghl/crypto';

type Db = SupabaseClient;

export interface PortalSession {
	user: User;
	client_id: string;
	client_name: string;
	display_name: string;
	email: string;
	is_primary: boolean;
	clients: { client_id: string; client_name: string }[];
}

export function isPortalUser(user: User | null | undefined): boolean {
	return !!user && (user.app_metadata as { portal?: boolean } | undefined)?.portal === true;
}

/** The signed-in portal visitor, or null. `clientId` picks one of several memberships (cookie-less: query param). */
export async function getPortalSession(clientId?: string | null): Promise<PortalSession | null> {
	const sb = await createClient();
	const {
		data: { user },
	} = await sb.auth.getUser();
	if (!user || !isPortalUser(user)) return null;
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_portal_users').select('client_id, display_name, email, is_primary, is_active, client:clients_v2!fw_portal_users_client_id_fkey(display_name)').eq('user_id', user.id).eq('is_active', true);
	const rows = ((data ?? []) as unknown as { client_id: string; display_name: string | null; email: string; is_primary: boolean; client: { display_name: string } | null }[]).map((r) => ({ ...r, client_name: r.client?.display_name ?? 'Your account' }));
	if (rows.length === 0) return null;
	const pick = (clientId && rows.find((r) => r.client_id === clientId)) || rows[0];
	await svc.from('fw_portal_users').update({ last_seen_at: new Date().toISOString(), first_seen_at: new Date().toISOString() }).eq('user_id', user.id).eq('client_id', pick.client_id).is('first_seen_at', null);
	await svc.from('fw_portal_users').update({ last_seen_at: new Date().toISOString() }).eq('user_id', user.id).eq('client_id', pick.client_id);
	return { user, client_id: pick.client_id, client_name: pick.client_name, display_name: pick.display_name ?? pick.email, email: pick.email, is_primary: pick.is_primary, clients: rows.map((r) => ({ client_id: r.client_id, client_name: r.client_name })) };
}

export function portalLabel(s: PortalSession): string {
	return `client:${s.display_name}`;
}

// ---------------------------------------------------------------- invites (staff side, service role)

/** Create (or reuse) the portal auth user for a contact and send the magic link. Decision 28: nobody makes logins by hand. */
export async function invitePortalUser(svc: Db, input: { client_id: string; email: string; display_name: string | null; contact_id?: string | null; is_primary?: boolean; invited_by: string | null; redirectTo: string }): Promise<{ ok: true; user_id: string; sent: boolean } | { ok: false; error: string }> {
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Invalid email.' };
	// existing auth user?
	let userId: string | null = null;
	const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
	const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
	if (existing) {
		if (!isPortalUser(existing)) return { ok: false, error: 'That email belongs to a staff login; portal logins are for client contacts.' };
		userId = existing.id;
	} else {
		const { data: created, error } = await svc.auth.admin.createUser({ email, email_confirm: true, app_metadata: { portal: true }, user_metadata: { full_name: input.display_name ?? email } });
		if (error || !created.user) return { ok: false, error: error?.message ?? 'Could not create the portal login.' };
		userId = created.user.id;
	}
	const { error: e2 } = await svc.from('fw_portal_users').upsert({ user_id: userId, client_id: input.client_id, contact_id: input.contact_id ?? null, email, display_name: input.display_name, is_primary: input.is_primary ?? false, invited_by: input.invited_by, is_active: true }, { onConflict: 'user_id,client_id' });
	if (e2) return { ok: false, error: e2.message };
	// magic link (Supabase sends the email when SMTP is configured; otherwise generateLink gives us the URL to send ourselves)
	const { error: e3 } = await svc.auth.signInWithOtp({ email, options: { emailRedirectTo: input.redirectTo, shouldCreateUser: false } });
	return { ok: true, user_id: userId, sent: !e3 };
}

/** Portal login from the portal's own form: only emails that hold a portal row get a link (no enumeration: same message either way). */
export async function requestPortalLink(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; error: string }> {
	const svc = createServiceRoleClient();
	const e = email.trim().toLowerCase();
	const { data } = await svc.from('fw_portal_users').select('user_id').eq('email', e).eq('is_active', true).limit(1).maybeSingle();
	if (!data) return { ok: true };
	await svc.auth.signInWithOtp({ email: e, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
	return { ok: true };
}

// ---------------------------------------------------------------- readers (service role, scoped)

export interface PortalOverview {
	client: { id: string; name: string };
	programs: { id: string; package_key: string; label: string | null; status: string; kickoff_on: string | null; first_set_live_on: string | null; auto_approve: { plans: { enabled: boolean; business_days: number }; content: { enabled: boolean; business_days: number } }; brand_name: string | null; primary_url: string | null }[];
	pending_approvals: number;
	open_notes: number;
	deliverables: { id: string; package_key: string; kind: string; title: string; status: string; due_on: string | null; period_month: string | null; delivered_at: string | null; client_href: string | null }[];
}

export async function loadPortalOverview(clientId: string): Promise<PortalOverview | null> {
	const svc = createServiceRoleClient();
	const { data } = await svc.rpc('fw_portal_overview', { p_client: clientId });
	return (data as PortalOverview | null) ?? null;
}

export async function loadPortalTrackers(programId: string) {
	const svc = createServiceRoleClient();
	const { data } = await svc.rpc('fw_portal_trackers', { p_program: programId });
	return (data ?? null) as {
		clusters: { id: string; number: number; anchor_keyword: string | null; status: string; plan_status: string; plan_md: string | null; plan_loom_url: string | null; starts_on: string | null; ends_on: string | null; reaudit_due_on: string | null }[];
		pages: { id: string; cluster_id: string; number: number; kind: string; keyword: string; title: string | null; status: string; quick_answer_md: string | null; body_md: string | null; live_url: string | null; live_at: string | null; target_citations: number | null; citations_shipped: number }[];
		citations: { id: string; page_id: string | null; channel_key: string; channel: string; status: string; title: string | null; url: string | null; posted_on: string | null; keyword: string | null; models_surfacing: string[] }[];
		videos: { id: string; month: string; title: string | null; status: string; shoot_at: string | null; youtube_url: string | null; checklist: { key: string; label: string; done?: boolean }[]; chapters: { index: number; title: string }[]; script_md: string | null; recording_path: string | null }[];
		facts: { id: string; fact: string; status: string }[];
	} | null;
}

export interface PortalApproval {
	id: string;
	program_id: string;
	kind: string;
	target_id: string;
	title: string;
	summary_md: string | null;
	status: string;
	requested_at: string;
	due_at: string | null;
	decided_at: string | null;
	decided_by_label: string | null;
	client_comment: string | null;
}

export async function loadPortalApprovals(clientId: string): Promise<PortalApproval[]> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_approvals').select('id, program_id, kind, target_id, title, summary_md, status, requested_at, due_at, decided_at, decided_by_label, client_comment').eq('client_id', clientId).order('status').order('requested_at', { ascending: false }).limit(100);
	return (data ?? []) as PortalApproval[];
}

/** Full text of what is being approved (page body / plan), only for an approval of this client. */
export async function loadApprovalBody(clientId: string, approvalId: string): Promise<{ title: string; body_md: string | null; loom_url: string | null } | null> {
	const svc = createServiceRoleClient();
	const { data: a } = await svc.from('fw_approvals').select('kind, target_id, title').eq('id', approvalId).eq('client_id', clientId).maybeSingle();
	const ap = a as { kind: string; target_id: string; title: string } | null;
	if (!ap) return null;
	if (ap.kind === 'page') {
		const { data } = await svc.from('fw_pages').select('title, quick_answer_md, body_md').eq('id', ap.target_id).maybeSingle();
		const p = data as { title: string | null; quick_answer_md: string | null; body_md: string | null } | null;
		return { title: p?.title ?? ap.title, body_md: [p?.quick_answer_md ? `**Quick answer**\n\n${p.quick_answer_md}` : '', p?.body_md ?? ''].filter(Boolean).join('\n\n'), loom_url: null };
	}
	if (ap.kind === 'plan') {
		const { data } = await svc.from('fw_clusters').select('plan_md, plan_loom_url').eq('id', ap.target_id).maybeSingle();
		const c = data as { plan_md: string | null; plan_loom_url: string | null } | null;
		return { title: ap.title, body_md: c?.plan_md ?? null, loom_url: c?.plan_loom_url ?? null };
	}
	return { title: ap.title, body_md: null, loom_url: null };
}

export interface PortalNote {
	id: string;
	kind: string;
	title: string;
	body_md: string | null;
	meta: Record<string, unknown>;
	status: string;
	reply_md: string | null;
	created_at: string;
	created_by_label: string | null;
}

export async function loadPortalNotes(clientId: string): Promise<PortalNote[]> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_portal_notes').select('id, kind, title, body_md, meta, status, reply_md, created_at, created_by_label').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200);
	return ((data ?? []) as PortalNote[]).map((n) => ({ ...n, meta: n.meta ?? {} }));
}

export interface PortalFile {
	id: string;
	kind: string;
	path: string;
	original_name: string;
	content_type: string | null;
	size_bytes: number | null;
	note: string | null;
	created_at: string;
	uploaded_by_label: string | null;
	video_id: string | null;
	url: string | null;
}

export async function loadPortalFiles(clientId: string): Promise<PortalFile[]> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_portal_files').select('id, kind, bucket, path, original_name, content_type, size_bytes, note, created_at, uploaded_by_label, video_id').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200);
	const rows = (data ?? []) as (PortalFile & { bucket: string })[];
	const out: PortalFile[] = [];
	for (const r of rows) {
		const s = await svc.storage.from(r.bucket).createSignedUrl(r.path, 3600);
		out.push({ ...r, url: s.data?.signedUrl ?? null });
	}
	return out;
}

export interface PortalMediaOpp {
	id: string;
	title: string | null;
	outlet_name: string | null;
	status_raw: string | null;
	date_secured: string | null;
	live_link: string | null;
	live_date: string | null;
	reach: number | null;
	media_tier: string | null;
}

/** Media opps (PR package): what the client may see — no notes, no secured_by. */
export async function loadPortalMedia(clientId: string): Promise<PortalMediaOpp[]> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('media_opportunities').select('id, title, outlet_name, status_raw, date_secured, live_link, live_date, reach, media_tier').eq('client_id', clientId).order('date_added', { ascending: false }).limit(300);
	return (data ?? []) as PortalMediaOpp[];
}

export interface PortalBilling {
	contracts: { id: string; package: string | null; per_month_cents: number | null; setup_fee_cents: number | null; starts_on: string | null; ends_on: string | null; status: string; billing_starts_on: string | null }[];
	payments: { id: string; due_on: string | null; paid_on: string | null; status: string | null; type: string | null }[];
	signed: { id: string; title: string; signed_at: string | null; mrr_cents: number | null; one_time_cents: number | null; pdf_url: string | null }[];
}

export async function loadPortalBilling(clientId: string): Promise<PortalBilling> {
	const svc = createServiceRoleClient();
	const { data: contracts } = await svc.from('contracts').select('id, package, per_month_cents, setup_fee_cents, starts_on, ends_on, status, billing_starts_on, airtable_contract_id').eq('client_id', clientId).order('starts_on', { ascending: false });
	const cs = (contracts ?? []) as (PortalBilling['contracts'][number] & { airtable_contract_id: string | null })[];
	const ids = cs.map((c) => c.airtable_contract_id).filter((x): x is string => !!x);
	const { data: payments } = ids.length ? await svc.from('payments').select('id, due_on, paid_on, status, type').in('airtable_contract_id', ids).order('due_on', { ascending: false }).limit(60) : { data: [] };
	const { data: rc } = await svc.from('rev_contracts').select('id, title, signed_at, mrr_cents, one_time_cents, signed_pdf_path').eq('client_id', clientId).eq('status', 'signed').order('signed_at', { ascending: false });
	const signed: PortalBilling['signed'] = [];
	for (const r of (rc ?? []) as { id: string; title: string; signed_at: string | null; mrr_cents: number | null; one_time_cents: number | null; signed_pdf_path: string | null }[]) {
		let pdf: string | null = null;
		if (r.signed_pdf_path) pdf = (await svc.storage.from('revenue-documents').createSignedUrl(r.signed_pdf_path, 3600)).data?.signedUrl ?? null;
		signed.push({ id: r.id, title: r.title, signed_at: r.signed_at, mrr_cents: r.mrr_cents, one_time_cents: r.one_time_cents, pdf_url: pdf });
	}
	return { contracts: cs.map(({ airtable_contract_id: _a, ...c }) => c), payments: (payments ?? []) as PortalBilling['payments'], signed };
}

export interface PortalVisibility {
	latest: { kind: string; period_month: string; finished_at: string | null; presence_rate: number | null; core_presence_rate: number | null; avg_position: number | null; sentiment_score: number | null; sov: number | null; misinfo_count: number; models: number } | null;
	trend: { period_month: string; kind: string; presence_rate: number | null; core_presence_rate: number | null; sov: number | null }[];
	per_prompt: { prompt: string; present: number; models: number; core_present: number; core_models: number }[];
	report_md: string | null;
}

export async function loadPortalVisibility(programId: string): Promise<PortalVisibility> {
	const svc = createServiceRoleClient();
	const { data: runs } = await svc.from('fw_audit_runs').select('id, kind, period_month, finished_at, presence_rate, core_presence_rate, avg_position, sentiment_score, sov, misinfo_count, model_ids').eq('program_id', programId).eq('status', 'done').order('finished_at', { ascending: false }).limit(12);
	const rs = (runs ?? []) as { id: string; kind: string; period_month: string; finished_at: string | null; presence_rate: number | null; core_presence_rate: number | null; avg_position: number | null; sentiment_score: number | null; sov: number | null; misinfo_count: number; model_ids: string[] }[];
	const latest = rs[0] ?? null;
	let per_prompt: PortalVisibility['per_prompt'] = [];
	let report_md: string | null = null;
	if (latest) {
		const [{ data: scores }, { data: prompts }, { data: rep }] = await Promise.all([
			svc.from('fw_audit_scores').select('prompt_id, present, models, core_present, core_models').eq('run_id', latest.id),
			svc.from('fw_audit_prompts').select('id, prompt, position').eq('program_id', programId),
			svc.from('fw_drafts').select('content_md, humanized_md').eq('target_id', latest.id).eq('kind', 'visibility_report').in('status', ['approved', 'applied']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
		]);
		const pm = new Map(((prompts ?? []) as { id: string; prompt: string; position: number }[]).map((p) => [p.id, p]));
		per_prompt = ((scores ?? []) as { prompt_id: string; present: number; models: number; core_present: number; core_models: number }[]).map((s) => ({ prompt: pm.get(s.prompt_id)?.prompt ?? '', present: s.present, models: s.models, core_present: s.core_present, core_models: s.core_models })).sort((a, b) => (pm.get(a.prompt)?.position ?? 0) - (pm.get(b.prompt)?.position ?? 0));
		const r = rep as { content_md: string | null; humanized_md: string | null } | null;
		report_md = r?.humanized_md ?? r?.content_md ?? null;
	}
	return {
		latest: latest ? { ...latest, models: latest.model_ids?.length ?? 0, presence_rate: num(latest.presence_rate), core_presence_rate: num(latest.core_presence_rate), avg_position: num(latest.avg_position), sentiment_score: num(latest.sentiment_score), sov: num(latest.sov) } : null,
		trend: rs.slice().reverse().map((r) => ({ period_month: r.period_month, kind: r.kind, presence_rate: num(r.presence_rate), core_presence_rate: num(r.core_presence_rate), sov: num(r.sov) })),
		per_prompt,
		report_md,
	};
}

function num(v: unknown): number | null {
	return v == null ? null : Number(v);
}

export async function loadPortalEvents(clientId: string, limit = 40): Promise<{ id: number; kind: string; summary: string; created_at: string; actor_label: string | null }[]> {
	const svc = createServiceRoleClient();
	const { data: progs } = await svc.from('fw_programs').select('id').eq('client_id', clientId);
	const ids = ((progs ?? []) as { id: string }[]).map((p) => p.id);
	if (ids.length === 0) return [];
	const { data } = await svc.from('fw_events').select('id, kind, summary, created_at, actor_label').in('program_id', ids).eq('client_visible', true).order('created_at', { ascending: false }).limit(limit);
	return (data ?? []) as { id: number; kind: string; summary: string; created_at: string; actor_label: string | null }[];
}

export async function loadPortalCalls(clientId: string): Promise<{ id: string; call_type: string; occurred_at: string; duration_minutes: number | null; recording_url: string | null }[]> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('calls').select('id, call_type, occurred_at, duration_minutes, recording_url').eq('client_id', clientId).order('occurred_at', { ascending: false }).limit(40);
	return (data ?? []) as { id: string; call_type: string; occurred_at: string; duration_minutes: number | null; recording_url: string | null }[];
}

export async function loadPortalSettings(): Promise<{ subdomain: string; book_call_url: string; support_email: string; org_google_account: string }> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_settings').select('value').eq('key', 'portal').maybeSingle();
	const v = ((data as { value?: Record<string, string> } | null)?.value ?? {}) as Record<string, string>;
	return { subdomain: v.subdomain ?? 'portal.example.com', book_call_url: v.book_call_url ?? '', support_email: v.support_email ?? 'flywheel@example.com', org_google_account: v.org_google_account ?? '' };
}

// ---------------------------------------------------------------- Google connections (GA4 / Search Console / GBP)

export const GOOGLE_DATA_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/business.manage', 'openid', 'email'];

export function googleConfigured(): boolean {
	return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
	return `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'}/api/portal/google/callback`;
}

export function googleAuthUrl(state: string): string {
	const params = new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '', redirect_uri: googleRedirectUri(), response_type: 'code', scope: GOOGLE_DATA_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
	return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Signed state so the callback can trust the client id without a DB row: sha256(client_id + secret). */
export function signState(clientId: string): string {
	const nonce = randomBytes(8).toString('hex');
	const sig = createHash('sha256').update(`${clientId}:${nonce}:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`).digest('hex').slice(0, 32);
	return `${clientId}.${nonce}.${sig}`;
}

export function verifyState(state: string): string | null {
	const [clientId, nonce, sig] = state.split('.');
	if (!clientId || !nonce || !sig) return null;
	const want = createHash('sha256').update(`${clientId}:${nonce}:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`).digest('hex').slice(0, 32);
	return sig === want ? clientId : null;
}

export async function exchangeGoogleCode(code: string): Promise<{ refresh_token?: string; access_token: string; scope: string; id_token?: string }> {
	const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '', redirect_uri: googleRedirectUri(), grant_type: 'authorization_code' }) });
	if (!r.ok) throw new Error(`Google token exchange ${r.status}: ${(await r.text()).slice(0, 200)}`);
	return (await r.json()) as { refresh_token?: string; access_token: string; scope: string; id_token?: string };
}

async function googleAccessToken(encryptedRefresh: string): Promise<string> {
	const refresh = decryptToken(encryptedRefresh);
	const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refresh, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '', grant_type: 'refresh_token' }) });
	if (!r.ok) throw new Error(`Google refresh ${r.status}`);
	return ((await r.json()) as { access_token: string }).access_token;
}

export async function saveGoogleConnection(svc: Db, input: { client_id: string; refresh_token: string; email: string | null; scopes: string[]; by_user: string | null; by_label: string | null }): Promise<void> {
	await svc.from('fw_google_connections').upsert({ client_id: input.client_id, encrypted_refresh_token: encryptToken(input.refresh_token), google_email: input.email, scopes: input.scopes, status: 'connected', connected_by_user: input.by_user, connected_by_label: input.by_label, connected_at: new Date().toISOString(), last_error: null }, { onConflict: 'client_id' });
}

export interface GoogleConnView {
	status: string;
	google_email: string | null;
	ga4_property_id: string | null;
	ga4_property_name: string | null;
	sc_site_url: string | null;
	gbp_location_name: string | null;
	connected_at: string | null;
	last_pull_at: string | null;
	last_error: string | null;
	scopes: string[];
}

export async function loadGoogleConnection(clientId: string): Promise<GoogleConnView | null> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_google_connections').select('status, google_email, ga4_property_id, ga4_property_name, sc_site_url, gbp_location_name, connected_at, last_pull_at, last_error, scopes').eq('client_id', clientId).maybeSingle();
	return (data as GoogleConnView | null) ?? null;
}

/** Lists what the connected account can see so the client picks the property / site / location. */
export async function listGoogleAssets(clientId: string): Promise<{ ga4: { id: string; name: string }[]; sc: { url: string }[]; gbp: { id: string; name: string }[]; error?: string }> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_google_connections').select('encrypted_refresh_token, scopes').eq('client_id', clientId).maybeSingle();
	const c = data as { encrypted_refresh_token: string | null; scopes: string[] } | null;
	if (!c?.encrypted_refresh_token) return { ga4: [], sc: [], gbp: [] };
	try {
		const tok = await googleAccessToken(c.encrypted_refresh_token);
		const h = { authorization: `Bearer ${tok}` };
		const out = { ga4: [] as { id: string; name: string }[], sc: [] as { url: string }[], gbp: [] as { id: string; name: string }[] };
		const ga = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers: h });
		if (ga.ok) {
			const j = (await ga.json()) as { accountSummaries?: { propertySummaries?: { property: string; displayName: string }[] }[] };
			for (const a of j.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.ga4.push({ id: p.property, name: p.displayName });
		}
		const sc = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: h });
		if (sc.ok) {
			const j = (await sc.json()) as { siteEntry?: { siteUrl: string }[] };
			out.sc = (j.siteEntry ?? []).map((s) => ({ url: s.siteUrl }));
		}
		const acc = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: h });
		if (acc.ok) {
			const j = (await acc.json()) as { accounts?: { name: string }[] };
			for (const a of (j.accounts ?? []).slice(0, 3)) {
				const loc = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=50`, { headers: h });
				if (loc.ok) {
					const lj = (await loc.json()) as { locations?: { name: string; title: string }[] };
					for (const l of lj.locations ?? []) out.gbp.push({ id: l.name, name: l.title });
				}
			}
		}
		return out;
	} catch (e) {
		await svc.from('fw_google_connections').update({ last_error: e instanceof Error ? e.message.slice(0, 300) : 'list failed', status: 'error' }).eq('client_id', clientId);
		return { ga4: [], sc: [], gbp: [], error: e instanceof Error ? e.message : 'list failed' };
	}
}

/** Pull the last 28 days (GA4 sessions by page, Search Console clicks / impressions / position by query + page) into fw_google_metrics. */
export async function pullGoogleMetrics(svc: Db, clientId: string): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
	const { data } = await svc.from('fw_google_connections').select('encrypted_refresh_token, ga4_property_id, sc_site_url').eq('client_id', clientId).maybeSingle();
	const c = data as { encrypted_refresh_token: string | null; ga4_property_id: string | null; sc_site_url: string | null } | null;
	if (!c?.encrypted_refresh_token) return { ok: false, error: 'Not connected.' };
	const to = new Date();
	const from = new Date(to.getTime() - 28 * 86_400_000);
	const f = from.toISOString().slice(0, 10);
	const t = to.toISOString().slice(0, 10);
	let rows = 0;
	try {
		const tok = await googleAccessToken(c.encrypted_refresh_token);
		const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
		if (c.ga4_property_id) {
			const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${c.ga4_property_id}:runReport`, { method: 'POST', headers: h, body: JSON.stringify({ dateRanges: [{ startDate: f, endDate: t }], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }], limit: 200, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] }) });
			if (r.ok) {
				const j = (await r.json()) as { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; totals?: { metricValues: { value: string }[] }[] };
				const up: Record<string, unknown>[] = (j.rows ?? []).map((row) => ({ client_id: clientId, source: 'ga4', period_from: f, period_to: t, dimension: `page:${row.dimensionValues[0]?.value}`, metrics: { sessions: Number(row.metricValues[0]?.value ?? 0), users: Number(row.metricValues[1]?.value ?? 0), engaged: Number(row.metricValues[2]?.value ?? 0) } }));
				if (j.totals?.[0]) up.push({ client_id: clientId, source: 'ga4', period_from: f, period_to: t, dimension: 'total', metrics: { sessions: Number(j.totals[0].metricValues[0]?.value ?? 0), users: Number(j.totals[0].metricValues[1]?.value ?? 0), engaged: Number(j.totals[0].metricValues[2]?.value ?? 0) } });
				if (up.length) await svc.from('fw_google_metrics').upsert(up, { onConflict: 'client_id,source,period_from,period_to,dimension' });
				rows += up.length;
			}
		}
		if (c.sc_site_url) {
			for (const dim of ['query', 'page'] as const) {
				const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.sc_site_url)}/searchAnalytics/query`, { method: 'POST', headers: h, body: JSON.stringify({ startDate: f, endDate: t, dimensions: [dim], rowLimit: 200 }) });
				if (r.ok) {
					const j = (await r.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };
					const up = (j.rows ?? []).map((row) => ({ client_id: clientId, source: 'search_console', period_from: f, period_to: t, dimension: `${dim}:${row.keys[0]}`, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } }));
					if (up.length) await svc.from('fw_google_metrics').upsert(up, { onConflict: 'client_id,source,period_from,period_to,dimension' });
					rows += up.length;
				}
			}
		}
		await svc.from('fw_google_connections').update({ last_pull_at: new Date().toISOString(), last_error: null, status: 'connected' }).eq('client_id', clientId);
		return { ok: true, rows };
	} catch (e) {
		const error = e instanceof Error ? e.message.slice(0, 300) : 'pull failed';
		await svc.from('fw_google_connections').update({ last_error: error, status: 'error' }).eq('client_id', clientId);
		return { ok: false, error };
	}
}

export async function loadGoogleMetrics(clientId: string): Promise<{ ga4_total: Record<string, number> | null; sc_queries: { key: string; metrics: Record<string, number> }[]; ga4_pages: { key: string; metrics: Record<string, number> }[]; period: { from: string; to: string } | null }> {
	const svc = createServiceRoleClient();
	const { data } = await svc.from('fw_google_metrics').select('source, period_from, period_to, dimension, metrics').eq('client_id', clientId).order('period_to', { ascending: false }).limit(600);
	const rows = (data ?? []) as { source: string; period_from: string; period_to: string; dimension: string; metrics: Record<string, number> }[];
	if (rows.length === 0) return { ga4_total: null, sc_queries: [], ga4_pages: [], period: null };
	const latestTo = rows[0].period_to;
	const cur = rows.filter((r) => r.period_to === latestTo);
	return {
		ga4_total: cur.find((r) => r.source === 'ga4' && r.dimension === 'total')?.metrics ?? null,
		ga4_pages: cur.filter((r) => r.source === 'ga4' && r.dimension.startsWith('page:')).map((r) => ({ key: r.dimension.slice(5), metrics: r.metrics })).sort((a, b) => (b.metrics.sessions ?? 0) - (a.metrics.sessions ?? 0)).slice(0, 20),
		sc_queries: cur.filter((r) => r.source === 'search_console' && r.dimension.startsWith('query:')).map((r) => ({ key: r.dimension.slice(6), metrics: r.metrics })).sort((a, b) => (b.metrics.clicks ?? 0) - (a.metrics.clicks ?? 0)).slice(0, 25),
		period: { from: cur[0].period_from, to: latestTo },
	};
}
