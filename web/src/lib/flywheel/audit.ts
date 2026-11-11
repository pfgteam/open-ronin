// AI visibility audit engine (F3, 0138). Server-only. Talks to the Nous
// router (OpenAI-compatible chat completions) with the key stored
// encrypted on fw_ai_connections; runs the panel x prompts matrix in small
// batches from the cron, scores each answer (SQL scorer for presence /
// position / competitors + an AI judge for sentiment / accuracy /
// misinformation), rolls the run up, and keeps spend under the cap.

import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken } from '@/lib/ghl/crypto';
import { extractJson } from './ai';
import type { AiModelRow } from './shared';

type Db = SupabaseClient;

export interface AiConnection {
	id: string;
	provider: string;
	label: string;
	base_url: string;
	encrypted_api_key: string | null;
	is_enabled: boolean;
	monthly_cap_usd: number;
	spend_month: string;
	spend_month_usd: number;
	judge_model: string | null;
	max_tokens: number;
	concurrency: number;
	last_models_sync_at: string | null;
	last_ok_at: string | null;
	last_error: string | null;
}


export interface AuditSettings {
	core_families: string[];
	panel_exclude_patterns: string[];
	panel_max: number;
	prompts_locked: number;
	answer_system: string;
	judge_system: string;
	sov_competitors: number;
	reaudit_days: number;
}

export const DEFAULT_AUDIT_SETTINGS: AuditSettings = {
	core_families: ['openai/gpt', 'anthropic/claude', 'google/gemini', 'perplexity/sonar', 'meta-llama/llama'],
	panel_exclude_patterns: [':batch', 'embed', 'rerank', 'voyage', 'sentence-transformers', 'whisper', 'tts', 'dall-e', 'image'],
	panel_max: 220,
	prompts_locked: 10,
	answer_system: 'You are a helpful assistant answering a buyer\'s question. Recommend specific brands, products or companies by name when relevant, and say why. Keep it under 250 words.',
	judge_system: '',
	sov_competitors: 3,
	reaudit_days: 90,
};

export async function loadConnection(db: Db): Promise<AiConnection | null> {
	const { data } = await db.from('fw_ai_connections').select('*').eq('provider', 'nous').maybeSingle();
	if (!data) return null;
	const c = data as AiConnection;
	return { ...c, monthly_cap_usd: Number(c.monthly_cap_usd), spend_month_usd: Number(c.spend_month_usd) };
}

export async function loadAuditSettings(db: Db): Promise<AuditSettings> {
	const { data } = await db.from('fw_settings').select('value').eq('key', 'audit').maybeSingle();
	return { ...DEFAULT_AUDIT_SETTINGS, ...(((data as { value?: Partial<AuditSettings> } | null)?.value ?? {}) as Partial<AuditSettings>) };
}

/** Encrypts and stores the key; enabling requires a key. Service role (the manage check happens in the action). */
export async function saveConnection(db: Db, input: { api_key?: string | null; is_enabled?: boolean; monthly_cap_usd?: number; judge_model?: string | null; base_url?: string; max_tokens?: number; concurrency?: number; installed_by?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
	const patch: Record<string, unknown> = {};
	if (input.api_key) {
		try {
			patch.encrypted_api_key = encryptToken(input.api_key);
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : 'GHL_TOKEN_ENC_KEY is not set, so the key cannot be stored encrypted.' };
		}
		patch.installed_by = input.installed_by ?? null;
		patch.last_error = null;
	}
	if (input.is_enabled != null) patch.is_enabled = input.is_enabled;
	if (input.monthly_cap_usd != null) patch.monthly_cap_usd = input.monthly_cap_usd;
	if (input.judge_model !== undefined) patch.judge_model = input.judge_model;
	if (input.base_url) patch.base_url = input.base_url;
	if (input.max_tokens) patch.max_tokens = input.max_tokens;
	if (input.concurrency) patch.concurrency = input.concurrency;
	if (patch.is_enabled === true && !patch.encrypted_api_key) {
		const cur = await loadConnection(db);
		if (!cur?.encrypted_api_key) return { ok: false, error: 'Enter the Nous API key before enabling the panel.' };
	}
	const { error } = await db.from('fw_ai_connections').update(patch).eq('provider', 'nous');
	if (error) return { ok: false, error: error.message };
	return { ok: true };
}

function apiKey(conn: AiConnection): string {
	if (!conn.encrypted_api_key) throw new Error('No Nous key stored.');
	return decryptToken(conn.encrypted_api_key);
}

// ---------------------------------------------------------------- router calls

interface RouterModel {
	id: string;
	name?: string;
	context_length?: number;
	pricing?: { prompt?: string; completion?: string; web_search?: string };
	architecture?: { output_modalities?: string[]; modality?: string };
}

/** GET /v1/models → fw_ai_models (upsert; rows gone from the router flip is_active=false). Public endpoint, no key needed. */
export async function syncModels(db: Db, conn: AiConnection, settings: AuditSettings): Promise<{ ok: true; total: number; panel: number; core: number } | { ok: false; error: string }> {
	let models: RouterModel[];
	try {
		const res = await fetch(`${conn.base_url.replace(/\/$/, '')}/models`, { headers: conn.encrypted_api_key ? { authorization: `Bearer ${apiKey(conn)}` } : {}, signal: AbortSignal.timeout(30_000) });
		if (!res.ok) return { ok: false, error: `Nous /models returned ${res.status}` };
		models = ((await res.json()) as { data?: RouterModel[] }).data ?? [];
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'models fetch failed' };
	}
	const textOnly = models.filter((m) => {
		const out = m.architecture?.output_modalities ?? ['text'];
		if (!out.includes('text')) return false;
		if (m.id.startsWith('~')) return false;
		return !settings.panel_exclude_patterns.some((p) => m.id.toLowerCase().includes(p.toLowerCase()));
	});
	// Core: newest (highest id lexically after the family prefix) of each core family.
	const coreIds = new Set<string>();
	for (const fam of settings.core_families) {
		const inFam = textOnly.filter((m) => m.id.startsWith(fam) && !/:/.test(m.id) && !/mini|nano|lite|flash-lite|8b|small|contributor/i.test(m.id)).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
		if (inFam[0]) coreIds.add(inFam[0].id);
	}
	const { data: existing } = await db.from('fw_ai_models').select('id, is_core, in_panel, sort');
	const prev = new Map(((existing ?? []) as { id: string; is_core: boolean; in_panel: boolean; sort: number }[]).map((r) => [r.id, r]));
	const ranked = textOnly.slice().sort((a, b) => a.id.localeCompare(b.id));
	const rows = ranked.map((m, i) => {
		const p = prev.get(m.id);
		const vendor = m.id.split('/')[0];
		const price = (s?: string) => (s != null && s !== '' ? Math.round(Number(s) * 1_000_000 * 1_000_000) / 1_000_000 : null);
		return {
			id: m.id,
			vendor,
			label: m.name ?? m.id,
			context_length: m.context_length ?? null,
			prompt_usd_per_m: price(m.pricing?.prompt),
			completion_usd_per_m: price(m.pricing?.completion),
			web_search: !!m.pricing?.web_search && Number(m.pricing.web_search) > 0,
			is_core: p ? p.is_core || (coreIds.has(m.id) && !prev.size) : coreIds.has(m.id),
			in_panel: p ? p.in_panel : i < settings.panel_max,
			is_active: true,
			sort: p?.sort ?? (coreIds.has(m.id) ? 1 : 100),
			meta: { modality: m.architecture?.modality ?? null },
			synced_at: new Date().toISOString(),
		};
	});
	for (let i = 0; i < rows.length; i += 200) {
		const { error } = await db.from('fw_ai_models').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
		if (error) return { ok: false, error: error.message };
	}
	const ids = rows.map((r) => r.id);
	if (ids.length) await db.from('fw_ai_models').update({ is_active: false }).not('id', 'in', `(${ids.map((x) => `"${x}"`).join(',')})`);
	await db.from('fw_ai_connections').update({ last_models_sync_at: new Date().toISOString(), last_error: null }).eq('id', conn.id);
	return { ok: true, total: rows.length, panel: rows.filter((r) => r.in_panel).length, core: rows.filter((r) => r.is_core).length };
}

interface ChatOut {
	choices?: { message?: { content?: string | { type: string; text?: string }[] } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	error?: { message?: string };
}

async function chat(conn: AiConnection, model: string, system: string, user: string, maxTokens: number): Promise<{ text: string; prompt_tokens: number; completion_tokens: number; ms: number }> {
	const t0 = Date.now();
	const res = await fetch(`${conn.base_url.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: { authorization: `Bearer ${apiKey(conn)}`, 'content-type': 'application/json' },
		body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.2 }),
		signal: AbortSignal.timeout(90_000),
	});
	const j = (await res.json().catch(() => ({}))) as ChatOut;
	if (!res.ok) throw new Error(j.error?.message ?? `Nous returned ${res.status}`);
	const c = j.choices?.[0]?.message?.content;
	const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '';
	return { text: text.trim(), prompt_tokens: j.usage?.prompt_tokens ?? 0, completion_tokens: j.usage?.completion_tokens ?? 0, ms: Date.now() - t0 };
}

function costOf(model: Pick<AiModelRow, 'prompt_usd_per_m' | 'completion_usd_per_m'> | undefined, pt: number, ct: number): number {
	if (!model) return 0;
	return Math.round(((Number(model.prompt_usd_per_m ?? 0) * pt + Number(model.completion_usd_per_m ?? 0) * ct) / 1_000_000) * 1_000_000) / 1_000_000;
}

/** One-call connectivity test (cheapest core model): stores last_ok_at / last_error. */
export async function testConnection(db: Db, conn: AiConnection): Promise<{ ok: true; model: string; ms: number } | { ok: false; error: string }> {
	const { data: m } = await db.from('fw_ai_models').select('id').eq('is_active', true).order('is_core', { ascending: false }).order('completion_usd_per_m', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
	const model = (m as { id: string } | null)?.id ?? 'meta-llama/llama-3.1-8b-instruct';
	try {
		const r = await chat(conn, model, 'Reply with the single word OK.', 'Ping', 8);
		await db.from('fw_ai_connections').update({ last_ok_at: new Date().toISOString(), last_error: null }).eq('id', conn.id);
		return { ok: true, model, ms: r.ms };
	} catch (e) {
		const error = e instanceof Error ? e.message : 'failed';
		await db.from('fw_ai_connections').update({ last_error: error }).eq('id', conn.id);
		return { ok: false, error };
	}
}

// ---------------------------------------------------------------- the worker

interface Judge {
	presence?: boolean;
	sentiment?: string;
	accuracy?: string;
	position?: number | null;
	competitors_named?: string[];
	misinformation?: string[];
	notes?: string;
}

/** Drains queued answers across running runs; moves queued runs to running; finishes runs when every answer settled. Service role, time-boxed. */
export async function advanceAudits(db: Db, opts: { budgetMs?: number; batch?: number } = {}): Promise<{ started: number; answered: number; failed: number; finished: number; skipped: string | null }> {
	const out = { started: 0, answered: 0, failed: 0, finished: 0, skipped: null as string | null };
	const conn = await loadConnection(db);
	if (!conn || !conn.is_enabled || !conn.encrypted_api_key) {
		out.skipped = 'panel off';
		return out;
	}
	const settings = await loadAuditSettings(db);
	const deadline = Date.now() + (opts.budgetMs ?? 45_000);
	// queued → running (cap re-checked: the month may have rolled)
	const { data: queued } = await db.from('fw_audit_runs').select('id, estimate_usd').eq('status', 'queued').order('created_at').limit(3);
	for (const r of (queued ?? []) as { id: string; estimate_usd: number | null }[]) {
		const cur = await loadConnection(db);
		if (cur && cur.spend_month_usd + Number(r.estimate_usd ?? 0) > cur.monthly_cap_usd) {
			await db.from('fw_audit_runs').update({ status: 'capped', error: `FW_AUDIT_CAP: $${cur.spend_month_usd.toFixed(2)} of $${cur.monthly_cap_usd} used this month` }).eq('id', r.id);
			continue;
		}
		await db.from('fw_audit_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', r.id);
		out.started++;
	}
	const { data: running } = await db.from('fw_audit_runs').select('id, program_id, competitors').eq('status', 'running').order('started_at').limit(3);
	const runs = (running ?? []) as { id: string; program_id: string; competitors: string[] }[];
	if (runs.length === 0) return out;
	const { data: models } = await db.from('fw_ai_models').select('id, prompt_usd_per_m, completion_usd_per_m');
	const modelMap = new Map(((models ?? []) as AiModelRow[]).map((m) => [m.id, m]));
	for (const run of runs) {
		if (Date.now() > deadline) break;
		const { data: prog } = await db.from('fw_programs').select('brand_name, primary_url, competitors').eq('id', run.program_id).maybeSingle();
		const p = prog as { brand_name: string | null; primary_url: string | null; competitors: string[] } | null;
		const brand = p?.brand_name ?? '';
		const url = p?.primary_url ?? '';
		const competitors = (run.competitors?.length ? run.competitors : p?.competitors) ?? [];
		const { data: facts } = await db.from('fw_facts').select('fact').eq('program_id', run.program_id).eq('status', 'verified').limit(10);
		const factList = ((facts ?? []) as { fact: string }[]).map((f) => f.fact);
		const { data: pending } = await db.from('fw_audit_answers').select('id, prompt_id, model_id, prompt:fw_audit_prompts!fw_audit_answers_prompt_id_fkey(prompt)').eq('run_id', run.id).eq('status', 'queued').limit(opts.batch ?? 12);
		const rows = (pending ?? []) as unknown as { id: string; prompt_id: string; model_id: string; prompt: { prompt: string } | null }[];
		// answer in parallel slices of `concurrency`
		for (let i = 0; i < rows.length; i += Math.max(1, conn.concurrency)) {
			if (Date.now() > deadline) break;
			await Promise.all(
				rows.slice(i, i + Math.max(1, conn.concurrency)).map(async (a) => {
					const promptText = a.prompt?.prompt ?? '';
					try {
						const r = await chat(conn, a.model_id, settings.answer_system, promptText, conn.max_tokens);
						const cost = costOf(modelMap.get(a.model_id), r.prompt_tokens, r.completion_tokens);
						// deterministic scoring
						const { data: s } = await db.rpc('fw_audit_score_answer', { p_answer: r.text, p_brand: brand, p_url: url, p_competitors: competitors });
						const sc = (s ?? {}) as { presence?: boolean; presence_how?: string | null; position?: number | null; competitors_named?: string[] };
						let judge: Judge | null = null;
						let judgeCost = 0;
						let judgedBy = 'sql';
						if (conn.judge_model && settings.judge_system && sc.presence) {
							try {
								const jr = await chat(conn, conn.judge_model, settings.judge_system, `BRAND: ${brand}\nURL: ${url}\nCOMPETITORS: ${competitors.join(', ')}\nVERIFIED FACTS:\n${factList.map((f) => `- ${f}`).join('\n')}\n\nPROMPT: ${promptText}\n\nANSWER:\n${r.text}`, 500);
								judge = extractJson<Judge>(jr.text);
								judgeCost = costOf(modelMap.get(conn.judge_model), jr.prompt_tokens, jr.completion_tokens);
								judgedBy = conn.judge_model;
							} catch {
								judge = null;
							}
						}
						const sentiment = judge?.sentiment && ['positive', 'neutral', 'negative', 'mixed', 'none'].includes(judge.sentiment) ? judge.sentiment : sc.presence ? 'neutral' : 'none';
						const accuracy = judge?.accuracy && ['accurate', 'inaccurate', 'partial', 'n/a'].includes(judge.accuracy) ? judge.accuracy : 'n/a';
						await db
							.from('fw_audit_answers')
							.update({
								status: 'done',
								answer_md: r.text.slice(0, 20000),
								prompt_tokens: r.prompt_tokens,
								completion_tokens: r.completion_tokens,
								cost_usd: cost + judgeCost,
								latency_ms: r.ms,
								presence: !!sc.presence,
								presence_how: sc.presence_how ?? null,
								sentiment,
								accuracy,
								position: sc.position ?? judge?.position ?? null,
								competitors_named: Array.from(new Set([...(sc.competitors_named ?? []), ...((judge?.competitors_named ?? []).filter((c) => competitors.some((x) => x.toLowerCase() === c.toLowerCase())))])),
								misinformation: (judge?.misinformation ?? []).map(String).slice(0, 10),
								judge_notes: judge?.notes ? String(judge.notes).slice(0, 500) : null,
								judged_by: judgedBy,
								error: null,
							})
							.eq('id', a.id);
						out.answered++;
					} catch (e) {
						await db.from('fw_audit_answers').update({ status: 'failed', error: e instanceof Error ? e.message.slice(0, 500) : 'failed' }).eq('id', a.id);
						out.failed++;
					}
				}),
			);
		}
		// finished?
		const { count: left } = await db.from('fw_audit_answers').select('id', { count: 'exact', head: true }).eq('run_id', run.id).eq('status', 'queued');
		if ((left ?? 0) === 0) {
			await db.rpc('fw_audit_rollup', { p_run: run.id });
			const { count: done } = await db.from('fw_audit_answers').select('id', { count: 'exact', head: true }).eq('run_id', run.id).eq('status', 'done');
			await db.from('fw_audit_runs').update({ status: (done ?? 0) > 0 ? 'done' : 'failed', finished_at: new Date().toISOString(), error: (done ?? 0) > 0 ? null : 'every answer failed' }).eq('id', run.id);
			out.finished++;
		} else {
			await db.rpc('fw_audit_rollup', { p_run: run.id });
		}
	}
	return out;
}

/** Re-judge failed answers (retry once) — cheap second pass from the cron. */
export async function retryFailedAnswers(db: Db, limit = 20): Promise<number> {
	const { data } = await db.from('fw_audit_answers').select('id').eq('status', 'failed').is('answer_md', null).order('updated_at').limit(limit);
	const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
	if (ids.length === 0) return 0;
	await db.from('fw_audit_answers').update({ status: 'queued', error: null }).in('id', ids);
	return ids.length;
}

/** Monthly re-scan scheduler: every active program with locked prompts and no run this month gets one queued (first tick of the month). Baseline / re-audit are human-queued. */
export async function scheduleMonthlyRescans(db: Db): Promise<{ queued: number; errors: string[] }> {
	const out = { queued: 0, errors: [] as string[] };
	const month = new Date().toISOString().slice(0, 7) + '-01';
	const { data: programs } = await db.from('fw_programs').select('id').eq('status', 'active');
	for (const p of (programs ?? []) as { id: string }[]) {
		const { count } = await db.from('fw_audit_runs').select('id', { count: 'exact', head: true }).eq('program_id', p.id).eq('period_month', month).neq('status', 'cancelled');
		if ((count ?? 0) > 0) continue;
		const { count: locked } = await db.from('fw_audit_prompts').select('id', { count: 'exact', head: true }).eq('program_id', p.id).eq('is_locked', true).is('retired_at', null);
		if ((locked ?? 0) === 0) continue;
		const { error } = await db.rpc('fw_audit_queue', { p_program: p.id, p_kind: 'monthly', p_model_ids: null, p_cluster: null });
		if (error) out.errors.push(`${p.id.slice(0, 8)}: ${error.message.slice(0, 120)}`);
		else out.queued++;
	}
	return out;
}
