'use server';

// Revenue Engine P6 actions (0126): contracts (build from products, send via
// the SignatureProvider, mark by hand), presentation builder, templates,
// portal links.

import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/permissions/capabilities';
import { markdownToHtml, renderContract, totals, type LineItem } from '@/lib/revenue/contracts';
import { activeSignatureProvider, providerById } from '@/lib/revenue/esign';
import { adaptersFor } from '@/lib/providers/registry';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

function friendly(m: string) {
	return m.includes('row-level security') ? 'Not allowed: you do not hold the permission for this write.' : m;
}

// ---------------------------------------------------------------- contracts

const ContractInput = z.object({
	deal_id: uuid,
	template_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	signer_person_id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	signer_name: z.string().trim().min(1).max(160),
	signer_email: z.string().trim().email(),
	signer_title: optText(120),
	title: z.string().trim().min(1).max(200),
	term_months: z.string().optional().transform((v) => (v && Number(v) > 0 ? Math.round(Number(v)) : null)),
	starts_on: z.string().trim().min(8).max(10),
	deposit: z.string().optional().transform((v) => (v && Number(v.replace(/[$,\s]/g, '')) > 0 ? Math.round(Number(v.replace(/[$,\s]/g, '')) * 100) : null)),
	line_items: z.string().min(2),
});

/** Build a draft contract from products + template; renders the body now. */
export async function createContract(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = ContractInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	let items: LineItem[];
	try {
		items = (JSON.parse(d.line_items) as LineItem[]).filter((li) => li && li.name && Number(li.qty) > 0);
	} catch {
		return { ok: false, error: 'Line items are not valid.' };
	}
	if (!items.length) return { ok: false, error: 'Add at least one product.' };
	const supabase = await createClient();
	const [{ data: deal }, { data: tpl }] = await Promise.all([
		supabase.from('rev_deals').select('id, brand_id, title').eq('id', d.deal_id).maybeSingle(),
		d.template_id ? supabase.from('rev_contract_templates').select('id, body_md, terms_md, version').eq('id', d.template_id).maybeSingle() : Promise.resolve({ data: null }),
	]);
	if (!deal) return { ok: false, error: 'Deal not visible to you.' };
	const { data: brand } = deal.brand_id ? await supabase.from('rev_brands').select('name').eq('id', deal.brand_id).maybeSingle() : { data: null };
	const t = totals(items);
	const body = tpl
		? renderContract({ template: tpl.body_md, terms: tpl.terms_md, brand_name: brand?.name ?? deal.title, signer_name: d.signer_name, signer_title: d.signer_title, start_date: d.starts_on, term_months: d.term_months, line_items: items, deposit_cents: d.deposit })
		: null;
	const { data, error } = await supabase
		.from('rev_contracts')
		.insert({
			deal_id: d.deal_id,
			brand_id: deal.brand_id,
			template_id: tpl?.id ?? null,
			template_version: tpl?.version ?? null,
			signer_person_id: d.signer_person_id,
			signer_email: d.signer_email.toLowerCase(),
			signer_name: d.signer_name,
			title: d.title,
			line_items: items,
			mrr_cents: t.mrr_cents,
			one_time_cents: t.one_time_cents,
			deposit_cents: d.deposit,
			term_months: d.term_months,
			starts_on: d.starts_on,
			body_md: body,
			terms_md: tpl?.terms_md ?? null,
			created_by: profile.id,
		})
		.select('id')
		.single();
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_contracts/${data.id}`, action: 'revenue.contract.create', diff: { mrr_cents: t.mrr_cents, one_time_cents: t.one_time_cents, items: items.length } });
	revalidatePath(`/prospects/deals/${d.deal_id}`);
	return { ok: true, id: data.id };
}

/** Send for signature through the active provider (DocuSeal default; manual = mark sent). */
export async function sendContract(input: { contract_id: string; deal_id: string }): Promise<Result<{ provider: string; signer_url: string | null }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const supabase = await createClient();
	const { data: c } = await supabase.from('rev_contracts').select('id, title, body_md, signer_name, signer_email, status').eq('id', input.contract_id).maybeSingle();
	if (!c) return { ok: false, error: 'Contract not visible to you.' };
	if (c.status !== 'draft') return { ok: false, error: `Contract is already ${c.status}.` };
	if (!c.body_md) return { ok: false, error: 'Contract has no body: pick a template or paste one first.' };
	if (!c.signer_email) return { ok: false, error: 'Signer email is missing.' };
	const provider = activeSignatureProvider();
	let ref: string, url: string | null;
	try {
		const r = await provider.send({ contractId: c.id, title: c.title, bodyHtml: markdownToHtml(c.body_md), signer: { name: c.signer_name ?? c.signer_email, email: c.signer_email } });
		ref = r.providerRef;
		url = r.signerUrl;
	} catch (e) {
		return { ok: false, error: `${provider.label}: ${(e as Error).message}` };
	}
	const { error } = await supabase.from('rev_contracts').update({ status: 'sent', provider: provider.id, provider_ref: ref, provider_url: url, sent_at: new Date().toISOString() }).eq('id', c.id);
	if (error) return { ok: false, error: friendly(error.message) };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_contracts/${c.id}`, action: 'revenue.contract.send', diff: { provider: provider.id } });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	return { ok: true, provider: provider.id, signer_url: url };
}

/** Mark signed / declined / void by hand (manual provider, GHL contracts, paper). Signed triggers the conversion. */
export async function markContract(input: { contract_id: string; deal_id: string; status: 'signed' | 'declined' | 'void'; reason?: string }): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!['signed', 'declined', 'void'].includes(input.status)) return { ok: false, error: 'Invalid status.' };
	const supabase = await createClient();
	const patch: Record<string, unknown> = { status: input.status };
	if (input.status === 'signed') patch.signed_at = new Date().toISOString();
	if (input.status === 'declined') {
		patch.declined_at = new Date().toISOString();
		patch.decline_reason = input.reason ?? null;
	}
	const { data: cur } = await supabase.from('rev_contracts').select('provider').eq('id', input.contract_id).maybeSingle();
	if (!cur) return { ok: false, error: 'Contract not visible to you.' };
	if (!cur.provider) patch.provider = 'manual';
	const { error, count } = await supabase.from('rev_contracts').update(patch, { count: 'exact' }).eq('id', input.contract_id);
	if (error) return { ok: false, error: friendly(error.message) };
	if (!count) return { ok: false, error: 'Nothing updated.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_contracts/${input.contract_id}`, action: `revenue.contract.${input.status}` });
	revalidatePath(`/prospects/deals/${input.deal_id}`);
	revalidatePath('/prospects');
	revalidatePath('/clients');
	return { ok: true };
}

/** Poll the provider for status (for providers without a webhook configured). */
export async function refreshContractStatus(input: { contract_id: string; deal_id: string }): Promise<Result<{ status: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const supabase = await createClient();
	const { data: c } = await supabase.from('rev_contracts').select('id, provider, provider_ref, status').eq('id', input.contract_id).maybeSingle();
	if (!c?.provider || !c.provider_ref) return { ok: false, error: 'Not sent through a provider.' };
	const p = providerById(c.provider);
	if (!p || p.id === 'manual') return { ok: false, error: 'Manual contract: mark it by hand.' };
	try {
		const s = await p.status(c.provider_ref);
		if (s.status !== c.status) {
			const patch: Record<string, unknown> = { status: s.status };
			if (s.status === 'signed') patch.signed_at = s.signedAt ?? new Date().toISOString();
			if (s.status === 'viewed') patch.viewed_at = new Date().toISOString();
			await createServiceRoleClient().from('rev_contracts').update(patch).eq('id', c.id);
		}
		revalidatePath(`/prospects/deals/${input.deal_id}`);
		return { ok: true, status: s.status };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

// ---------------------------------------------------------------- presentation builder

const PresInput = z.object({ deal_id: uuid, brand: optText(200), goals: z.string().trim().min(3).max(2000), package: z.string().trim().min(1).max(200), case_studies: optText(2000) });

export async function buildPresentation(formData: FormData): Promise<Result<{ id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = PresInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const adapter = adaptersFor('generate_text').find((a) => a.isConfigured());
	const supabase = await createClient();
	const [{ data: deal }, { data: products }] = await Promise.all([
		supabase.from('rev_deals').select('id, title, brand_id, fit_signals, ai_fit_summary').eq('id', d.deal_id).maybeSingle(),
		supabase.from('rev_products').select('name, price_cents, deliverables_md').eq('is_active', true),
	]);
	if (!deal) return { ok: false, error: 'Deal not visible to you.' };
	const { data: brand } = deal.brand_id ? await supabase.from('rev_brands').select('name, industry, description, intel, enrichment').eq('id', deal.brand_id).maybeSingle() : { data: null };
	const pkg = (products ?? []).find((p) => p.name.toLowerCase() === d.package.toLowerCase());
	const inputs = { brand: d.brand ?? brand?.name ?? deal.title, goals: d.goals, package: d.package, case_studies: d.case_studies ? d.case_studies.split('\n').map((s) => s.trim()).filter(Boolean) : [] };
	let outline: unknown = null, body = '', analyzer: string | null = null;
	if (adapter) {
		const prompt = `Build the closing-call deck outline for ${inputs.brand}.\nGoals: ${inputs.goals}\nRecommended package: ${inputs.package}${pkg ? ` (${pkg.price_cents ? `$${Math.round(pkg.price_cents / 100)}/mo` : ''}; deliverables: ${pkg.deliverables_md ?? ''})` : ''}\nBrand facts: ${JSON.stringify({ industry: brand?.industry, description: brand?.description, intel: brand?.intel, fit: deal.fit_signals, ai_fit_summary: deal.ai_fit_summary })}\nCase studies to use: ${inputs.case_studies.join('; ') || 'pick two Open Ronin wins in a similar vertical (placeholders are fine, mark them [CASE STUDY])'}\n\nReturn ONLY JSON: {"slides":[{"title":"...","bullets":["..."],"notes":"speaker notes"}]} with 8-10 slides: cover, their goal in their words, the gap / cost of inaction, our approach, the package + deliverables + media-opp goal, proof (case studies), timeline / first 90 days, investment anchored against the tier above, next steps.`;
		try {
			const out = await adapter.submit({ capability: 'generate_text', system: 'You build persuasive, concrete sales decks for a purpose-driven PR agency. No fluff.', prompt, maxTokens: 2500 });
			const text = 'result' in out ? out.result.text ?? '' : '';
			const m = text.match(/\{[\s\S]*\}/);
			if (m) {
				const j = JSON.parse(m[0]) as { slides: { title: string; bullets: string[]; notes?: string }[] };
				outline = j.slides;
				body = j.slides.map((s, i) => `## ${i + 1}. ${s.title}\n${(s.bullets ?? []).map((b) => `- ${b}`).join('\n')}${s.notes ? `\n\n_Notes: ${s.notes}_` : ''}`).join('\n\n');
				analyzer = adapter.spec.id;
			}
		} catch (e) {
			body = `_Generation failed: ${(e as Error).message}_`;
		}
	} else {
		body = '_No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY). Outline skeleton:_\n\n## 1. Cover\n## 2. Your goal\n## 3. The gap\n## 4. Our approach\n## 5. Package and deliverables\n## 6. Proof\n## 7. First 90 days\n## 8. Investment\n## 9. Next steps';
	}
	const { data, error } = await supabase.from('rev_presentations').insert({ deal_id: d.deal_id, title: `${inputs.brand} — ${inputs.package}`, inputs, outline, body_md: body, analyzer, status: outline ? 'ready' : 'draft', created_by: profile.id }).select('id').single();
	if (error) return { ok: false, error: friendly(error.message) };
	await supabase.from('rev_documents').insert({ deal_id: d.deal_id, brand_id: deal.brand_id, kind: 'presentation', title: `${inputs.brand} — ${inputs.package}`, status: 'draft', meta: { presentation_id: data.id }, created_by: profile.id });
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_presentations/${data.id}`, action: 'revenue.presentation.build' });
	revalidatePath(`/prospects/deals/${d.deal_id}`);
	return { ok: true, id: data.id };
}

// ---------------------------------------------------------------- templates (manage_revenue)

const TplInput = z.object({
	id: z.string().optional().transform((v) => (v && uuid.safeParse(v).success ? v : null)),
	key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
	label: z.string().trim().min(1).max(120),
	org: z.enum(['main', 'premium', 'beacon']),
	body_md: z.string().trim().min(20).max(60000),
	terms_md: optText(10000),
	default_term_months: z.string().optional().transform((v) => (v && Number(v) > 0 ? Math.round(Number(v)) : null)),
	is_active: z.string().optional().transform((v) => v === 'on' || v === 'true'),
});

export async function saveContractTemplate(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = TplInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...row } = parsed.data;
	const supabase = await createClient();
	if (id) {
		const { data: cur } = await supabase.from('rev_contract_templates').select('version').eq('id', id).maybeSingle();
		const { error, count } = await supabase.from('rev_contract_templates').update({ ...row, version: ((cur as { version: number } | null)?.version ?? 0) + 1, updated_by: profile.id }, { count: 'exact' }).eq('id', id);
		if (error) return { ok: false, error: friendly(error.message) };
		if (!count) return { ok: false, error: 'Nothing updated: you need the manage_revenue capability.' };
	} else {
		const { error } = await supabase.from('rev_contract_templates').insert({ ...row, updated_by: profile.id });
		if (error) return { ok: false, error: friendly(error.message) };
	}
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_contract_templates/${row.key}`, action: 'revenue.template.save' });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

// ---------------------------------------------------------------- portal link

/** Mint a signed-contract viewing link for the client (shown once). */
export async function mintPortalLink(input: { contract_id: string; deal_id: string }): Promise<Result<{ url: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if (!(await hasCapability('manage_revenue'))) return { ok: false, error: 'You need the manage_revenue capability.' };
	const supabase = await createClient();
	const { data: c } = await supabase.from('rev_contracts').select('id, client_id, status, title').eq('id', input.contract_id).maybeSingle();
	if (!c) return { ok: false, error: 'Contract not visible to you.' };
	if (c.status !== 'signed' || !c.client_id) return { ok: false, error: 'Only a signed, converted contract gets a portal link.' };
	const token = randomBytes(24).toString('base64url');
	const db = createServiceRoleClient();
	const { error } = await db.from('rev_portal_tokens').insert({ token_hash: createHash('sha256').update(token).digest('hex'), client_id: c.client_id, contract_id: c.id, label: c.title, expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(), created_by: profile.id });
	if (error) return { ok: false, error: error.message };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `rev_contracts/${c.id}`, action: 'revenue.portal.mint' });
	return { ok: true, url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'}/portal/contract/${token}` };
}
