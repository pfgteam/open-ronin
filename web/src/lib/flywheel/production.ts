// Production pipeline (F4, 0142). Server-only. Runs Chris's agents
// (placeholders until Riley hands the real prompts over) as text
// generations through the provider registry, records a skill_runs row for
// the audit trail, checks the execution rules, and lands the result as a
// fw_drafts row in `draft` for the lane → verification → apply ladder.
// Nothing here writes a page / citation / plan directly.

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractJson, generateText } from './ai';

type Db = SupabaseClient;

export interface AgentRow {
	key: string;
	label: string;
	persona: string | null;
	role_md: string | null;
	output_kind: 'plan' | 'keyword_research' | 'visibility_report' | 'page' | 'citation' | 'script' | 'shorts' | 'recap' | 'report' | 'humanize' | 'site_keywords' | 'other';
	parent_key: string | null;
	channel_key: string | null;
	lane: 'lane_flywheel' | 'lane_writers' | 'lane_pubs' | 'lane_smm';
	system_md: string;
	output_schema: Record<string, unknown> | null;
	model: string | null;
	max_tokens: number;
	is_placeholder: boolean;
	is_active: boolean;
	version: number;
	history: { version: number; system_md: string; by: string | null; at: string }[];
	updated_at: string;
}

export interface DraftRow {
	id: string;
	program_id: string;
	target_kind: 'cluster' | 'page' | 'citation' | 'video' | 'program' | 'audit_run';
	target_id: string;
	kind: AgentRow['output_kind'];
	agent_key: string | null;
	lane: AgentRow['lane'];
	status: 'queued' | 'generating' | 'draft' | 'in_review' | 'verification' | 'approved' | 'applied' | 'rejected' | 'failed';
	title: string | null;
	content_md: string | null;
	structured: Record<string, unknown> | null;
	input: Record<string, unknown>;
	rules_check: { ok: boolean; failed: string[]; checks: Record<string, boolean> } | null;
	skill_run_id: string | null;
	model: string | null;
	cost_usd: number | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	verified_by: string | null;
	verified_at: string | null;
	applied_at: string | null;
	rejected_reason: string | null;
	humanized_md: string | null;
	humanized_at: string | null;
	humanize_model: string | null;
	humanize_notes: string | null;
	source_context: string | null;
	error: string | null;
	requested_by: string | null;
	created_at: string;
	updated_at: string;
}

export const TARGET_FOR_KIND: Record<AgentRow['output_kind'], DraftRow['target_kind']> = {
	plan: 'cluster',
	keyword_research: 'cluster',
	visibility_report: 'audit_run',
	page: 'page',
	citation: 'citation',
	script: 'video',
	shorts: 'video',
	recap: 'program',
	report: 'program',
	humanize: 'program',
	site_keywords: 'program',
	other: 'program',
};

export async function loadAgents(db: Db): Promise<AgentRow[]> {
	const { data } = await db.from('fw_agents').select('*').order('output_kind').order('key');
	return ((data ?? []) as AgentRow[]).map((a) => ({ ...a, history: a.history ?? [] }));
}

// ---------------------------------------------------------------- briefs

interface Ctx {
	program: { id: string; brand_name: string | null; primary_url: string | null; icp_md: string | null; competitors: string[]; keywords: string[]; keyword_hypotheses: unknown; angles_md: string | null; sme_name: string | null };
	facts: string[];
}

async function loadCtx(db: Db, programId: string): Promise<Ctx> {
	const [{ data: p }, { data: f }] = await Promise.all([db.from('fw_programs').select('id, brand_name, primary_url, icp_md, competitors, keywords, keyword_hypotheses, angles_md, sme_name').eq('id', programId).maybeSingle(), db.from('fw_facts').select('fact').eq('program_id', programId).neq('status', 'retired').order('sort')]);
	const prog = p as Ctx['program'] | null;
	if (!prog) throw new Error('Program not found.');
	return { program: { ...prog, competitors: prog.competitors ?? [], keywords: prog.keywords ?? [] }, facts: ((f ?? []) as { fact: string }[]).map((x) => x.fact) };
}

function brandBlock(c: Ctx): string {
	return `BRAND: ${c.program.brand_name ?? '[NEEDS brand]'}\nURL: ${c.program.primary_url ?? '[NEEDS url]'}\nIDEAL CUSTOMER: ${c.program.icp_md ?? '[NEEDS icp]'}\nCOMPETITORS: ${c.program.competitors.join(', ') || '[NEEDS]'}\nVERIFIED FACTS:\n${c.facts.map((f) => `- ${f}`).join('\n') || '- [NEEDS facts]'}`;
}

/** Builds the user prompt for an agent against a target. Returns the brief + a title + the facts it should use. */
export async function buildBrief(db: Db, agent: AgentRow, programId: string, targetId: string, extra: Record<string, unknown> = {}): Promise<{ brief: string; title: string; keyword: string | null; channel: string | null; factsUsed: string[] }> {
	const c = await loadCtx(db, programId);
	const base = brandBlock(c);
	switch (agent.output_kind) {
		case 'plan':
		case 'keyword_research': {
			const { data: cl } = await db.from('fw_clusters').select('number, anchor_keyword, audit_run_id').eq('id', targetId).maybeSingle();
			const cluster = cl as { number: number; anchor_keyword: string | null; audit_run_id: string | null } | null;
			const { data: pages } = await db.from('fw_pages').select('number, kind, keyword').eq('cluster_id', targetId).order('number');
			let auditText = 'No audit run yet.';
			const runId = cluster?.audit_run_id ?? ((await db.from('fw_audit_runs').select('id').eq('program_id', programId).eq('status', 'done').order('finished_at', { ascending: false }).limit(1).maybeSingle()).data as { id: string } | null)?.id;
			if (runId) {
				const [{ data: run }, { data: scores }] = await Promise.all([db.from('fw_audit_runs').select('kind, presence_rate, core_presence_rate, sov, misinfo_count, per_competitor').eq('id', runId).maybeSingle(), db.from('fw_audit_scores').select('prompt_id, models, present, core_present').eq('run_id', runId)]);
				const { data: prompts } = await db.from('fw_audit_prompts').select('id, prompt').eq('program_id', programId);
				const pm = new Map(((prompts ?? []) as { id: string; prompt: string }[]).map((p) => [p.id, p.prompt]));
				auditText = `AUDIT (${(run as { kind: string } | null)?.kind}): ${JSON.stringify(run)}\nPER PROMPT (present / models): ${((scores ?? []) as { prompt_id: string; models: number; present: number; core_present: number }[]).map((s) => `"${pm.get(s.prompt_id) ?? s.prompt_id}" ${s.present}/${s.models} (core ${s.core_present})`).join('; ')}`;
			}
			const prior = agent.output_kind === 'plan' ? ((await db.from('fw_drafts').select('structured').eq('target_id', targetId).eq('kind', 'keyword_research').in('status', ['approved', 'applied']).order('created_at', { ascending: false }).limit(1).maybeSingle()).data as { structured: unknown } | null)?.structured : null;
			return {
				brief: [base, `CLUSTER ${cluster?.number ?? ''} · anchor keyword: ${cluster?.anchor_keyword ?? '[NEEDS]'}`, `CLIENT KEYWORDS: ${c.program.keywords.join('; ')}`, `KEYWORD HYPOTHESES (discovery call): ${JSON.stringify(c.program.keyword_hypotheses ?? [])}`, `ANGLES / NEWS: ${c.program.angles_md ?? '—'}`, `SME: ${c.program.sme_name ?? '[NEEDS]'}`, `SCAFFOLDED PAGES: ${((pages ?? []) as { number: number; kind: string; keyword: string }[]).map((p) => `${p.number} ${p.kind} "${p.keyword}"`).join('; ')}`, auditText, prior ? `KEYWORD RESEARCH (Kira, approved): ${JSON.stringify(prior).slice(0, 6000)}` : '', extra.notes ? `NOTES: ${String(extra.notes)}` : ''].filter(Boolean).join('\n\n'),
				title: `${agent.output_kind === 'plan' ? 'Cluster plan' : 'Keyword research'} · cluster ${cluster?.number ?? ''}`,
				keyword: cluster?.anchor_keyword ?? null,
				channel: null,
				factsUsed: c.facts,
			};
		}
		case 'visibility_report': {
			const [{ data: run }, { data: scores }, { data: prompts }, { data: baseline }] = await Promise.all([
				db.from('fw_audit_runs').select('*').eq('id', targetId).maybeSingle(),
				db.from('fw_audit_scores').select('*').eq('run_id', targetId),
				db.from('fw_audit_prompts').select('id, prompt').eq('program_id', programId),
				db.from('fw_audit_runs').select('kind, period_month, presence_rate, core_presence_rate, sov, misinfo_count').eq('program_id', programId).eq('status', 'done').neq('id', targetId).order('finished_at', { ascending: true }).limit(1).maybeSingle(),
			]);
			const { data: mis } = await db.from('fw_audit_answers').select('model_id, misinformation').eq('run_id', targetId).neq('misinformation', '{}').limit(30);
			const pm = new Map(((prompts ?? []) as { id: string; prompt: string }[]).map((p) => [p.id, p.prompt]));
			const r = run as { kind: string; period_month: string } | null;
			return {
				brief: [base, `THIS RUN: ${JSON.stringify(run)}`, `PER PROMPT: ${((scores ?? []) as { prompt_id: string; models: number; present: number; core_present: number; core_models: number }[]).map((s) => `"${pm.get(s.prompt_id)}" ${s.present}/${s.models} (core ${s.core_present}/${s.core_models})`).join('; ')}`, `MISINFORMATION: ${JSON.stringify(mis ?? [])}`, `BASELINE: ${baseline ? JSON.stringify(baseline) : 'none (this is the baseline)'}`].join('\n\n'),
				title: `AI visibility report · ${r?.kind ?? ''} ${r?.period_month?.slice(0, 7) ?? ''}`,
				keyword: null,
				channel: null,
				factsUsed: c.facts,
			};
		}
		case 'page': {
			const { data: pg } = await db.from('fw_pages').select('number, kind, keyword, title, chapter_index, video_id, word_target_min, word_target_max, internal_links, cluster_id').eq('id', targetId).maybeSingle();
			const page = pg as { number: number; kind: string; keyword: string; title: string | null; chapter_index: number | null; video_id: string | null; word_target_min: number; word_target_max: number; internal_links: string[]; cluster_id: string } | null;
			if (!page) throw new Error('Page not found.');
			let chapter = '';
			if (page.video_id) {
				const { data: v } = await db.from('fw_videos').select('transcript_md, chapters').eq('id', page.video_id).maybeSingle();
				const vid = v as { transcript_md: string | null; chapters: { index: number; title: string; start_sec?: number | null }[] } | null;
				chapter = vid?.transcript_md ? `SEED VIDEO TRANSCRIPT (chapter ${page.chapter_index ?? '?'} "${vid.chapters?.find((ch) => ch.index === page.chapter_index)?.title ?? ''}"):\n${vid.transcript_md.slice(0, 40_000)}` : 'SEED VIDEO TRANSCRIPT: not available yet — write from the brief and mark [NEEDS transcript] where the chapter should supply examples.';
			} else chapter = 'SEED VIDEO TRANSCRIPT: no video linked — write from the brief and mark [NEEDS transcript].';
			const { data: plan } = await db.from('fw_clusters').select('plan_md').eq('id', page.cluster_id).maybeSingle();
			const facts = c.facts.slice(((page.number - 1) % Math.max(1, c.facts.length)), ((page.number - 1) % Math.max(1, c.facts.length)) + 2);
			return {
				brief: [base, `PAGE ${page.number} · kind ${page.kind} · VERBATIM KEYWORD: "${page.keyword}" · ${page.word_target_min}–${page.word_target_max} words`, `FACTS TO USE (at least one): ${facts.map((f) => `- ${f}`).join('\n')}`, `INTERNAL LINKS: ${(page.internal_links ?? []).join(', ') || '[NEEDS: core service / product page URL]'}`, chapter, (plan as { plan_md: string | null } | null)?.plan_md ? `CLUSTER PLAN (excerpt):\n${String((plan as { plan_md: string }).plan_md).slice(0, 6000)}` : ''].filter(Boolean).join('\n\n'),
				title: `Page ${page.number}: ${page.keyword}`,
				keyword: page.keyword,
				channel: null,
				factsUsed: facts,
			};
		}
		case 'citation': {
			const { data: ct } = await db.from('fw_citations').select('channel_key, keyword, page_id, fact_id').eq('id', targetId).maybeSingle();
			const cit = ct as { channel_key: string; keyword: string | null; page_id: string | null; fact_id: string | null } | null;
			if (!cit) throw new Error('Citation not found.');
			const { data: pg } = cit.page_id ? await db.from('fw_pages').select('number, keyword, title, quick_answer_md, live_url').eq('id', cit.page_id).maybeSingle() : { data: null };
			const page = pg as { number: number; keyword: string; title: string | null; quick_answer_md: string | null; live_url: string | null } | null;
			const { data: ch } = await db.from('fw_channels').select('label, non_promotional, per_page_min').eq('key', cit.channel_key).maybeSingle();
			const { data: fact } = cit.fact_id ? await db.from('fw_facts').select('fact').eq('id', cit.fact_id).maybeSingle() : { data: null };
			const { data: siblings } = cit.page_id ? await db.from('fw_citations').select('channel_key, title, draft_md').eq('page_id', cit.page_id).neq('id', targetId).not('draft_md', 'is', null).limit(6) : { data: [] };
			const useFact = (fact as { fact: string } | null)?.fact ?? c.facts[Math.floor(Math.random() * Math.max(1, c.facts.length))] ?? '[NEEDS fact]';
			return {
				brief: [base, `CHANNEL: ${cit.channel_key} (${(ch as { label: string } | null)?.label ?? ''})${(ch as { non_promotional: boolean } | null)?.non_promotional ? ' — NON-PROMOTIONAL' : ''}`, `VERBATIM KEYWORD: "${cit.keyword ?? page?.keyword ?? ''}"`, `ON-SITE PAGE: ${page?.title ?? page?.keyword ?? ''} · ${page?.live_url ?? '[page not live yet: link the brand URL]'}\nQUICK ANSWER: ${page?.quick_answer_md ?? ''}`, `FACT TO ROTATE IN: ${useFact}`, `EARLIER CITATIONS FOR THIS PAGE (vary from these): ${((siblings ?? []) as { channel_key: string; title: string | null; draft_md: string | null }[]).map((s) => `[${s.channel_key}] ${s.title ?? ''}: ${(s.draft_md ?? '').slice(0, 300)}`).join('\n') || 'none yet'}`].join('\n\n'),
				title: `${(ch as { label: string } | null)?.label ?? cit.channel_key} · page ${page?.number ?? ''}`,
				keyword: cit.keyword ?? page?.keyword ?? null,
				channel: cit.channel_key,
				factsUsed: [useFact],
			};
		}
		case 'script':
		case 'shorts': {
			const { data: v } = await db.from('fw_videos').select('month, title, chapters, transcript_md, sme_name, cluster_id').eq('id', targetId).maybeSingle();
			const vid = v as { month: string; title: string | null; chapters: { index: number; title: string; start_sec?: number | null }[]; transcript_md: string | null; sme_name: string | null; cluster_id: string | null } | null;
			if (!vid) throw new Error('Video not found.');
			const { data: pages } = vid.cluster_id ? await db.from('fw_pages').select('number, keyword, chapter_index').eq('cluster_id', vid.cluster_id).order('number') : { data: [] };
			const chapterMap = (vid.chapters?.length ? vid.chapters : ((pages ?? []) as { number: number; keyword: string; chapter_index: number | null }[]).map((p) => ({ index: p.chapter_index ?? p.number, title: p.keyword }))).map((ch) => `${ch.index}. ${ch.title}`).join('\n');
			const { data: plan } = vid.cluster_id ? await db.from('fw_clusters').select('plan_md').eq('id', vid.cluster_id).maybeSingle() : { data: null };
			return {
				brief: [base, `RECORDING: ${vid.month.slice(0, 7)} · ${vid.title ?? ''} · SME on camera: ${vid.sme_name ?? c.program.sme_name ?? '[NEEDS]'}`, `CHAPTER MAP:\n${chapterMap || '[NEEDS chapters]'}`, agent.output_kind === 'shorts' ? `TRANSCRIPT:\n${vid.transcript_md?.slice(0, 60_000) ?? '[NEEDS transcript]'}` : '', agent.output_kind === 'script' && (plan as { plan_md: string | null } | null)?.plan_md ? `CLUSTER PLAN (excerpt):\n${String((plan as { plan_md: string }).plan_md).slice(0, 6000)}` : ''].filter(Boolean).join('\n\n'),
				title: `${agent.output_kind === 'script' ? 'Script' : 'Shorts cut list'} · ${vid.month.slice(0, 7)}`,
				keyword: null,
				channel: null,
				factsUsed: c.facts,
			};
		}
		default:
			return { brief: [base, extra.notes ? `NOTES: ${String(extra.notes)}` : ''].filter(Boolean).join('\n\n'), title: agent.label, keyword: null, channel: null, factsUsed: c.facts };
	}
}

// ---------------------------------------------------------------- run one agent → draft

/** A channel variant inherits its parent's prompt: base rules first, then the variant's channel shape. */
async function effectiveSystem(db: Db, agent: AgentRow): Promise<string> {
	if (!agent.parent_key) return agent.system_md;
	const { data } = await db.from('fw_agents').select('system_md').eq('key', agent.parent_key).maybeSingle();
	const base = (data as { system_md: string } | null)?.system_md;
	return base ? `${base}\n\n--- CHANNEL VARIANT (${agent.channel_key ?? agent.key}) ---\n${agent.system_md}` : agent.system_md;
}

/** Prompt library assembly (0145): SHARED RULES + VOICE + BRAND FACTS + CTA ahead of the agent prompt, then {{variables}} filled. */
export async function assembleSystem(db: Db, agent: AgentRow, programId: string, vars: Record<string, string | null | undefined>): Promise<string> {
	const [{ data: rules }, { data: prog }] = await Promise.all([db.from('fw_settings').select('value').eq('key', 'prompt_rules').maybeSingle(), db.from('fw_programs').select('voice_md, brand_facts_md, cta_md').eq('id', programId).maybeSingle()]);
	const r = (rules as { value?: { rules_md?: string; banned_phrases?: string[] } } | null)?.value;
	const p = prog as { voice_md: string | null; brand_facts_md: string | null; cta_md: string | null } | null;
	const blocks = [r?.rules_md ? `${r.rules_md}\nBANNED PHRASES: ${(r.banned_phrases ?? []).join(', ')}` : '', p?.voice_md ? `VOICE BLOCK:\n${p.voice_md}` : '', p?.brand_facts_md ? `BRAND FACTS BLOCK:\n${p.brand_facts_md}` : '', p?.cta_md ? `CTA BLOCK: ${p.cta_md}` : ''].filter(Boolean);
	let text = await effectiveSystem(db, agent);
	text = text.replace(/\{\{([a-z_]+)\}\}/g, (_m, k: string) => {
		const v = vars[k];
		return v == null || v === '' ? `[${k.replace(/_/g, ' ')}: not set]` : String(v);
	});
	return [...blocks, text].join('\n\n');
}

/** The agent a program should run for a kind (+ channel): program roster → channel variant → base; null when the roster disables it. */
export async function agentFor(db: Db, programId: string, kind: AgentRow['output_kind'], channel: string | null = null): Promise<AgentRow | null> {
	const { data: key } = await db.rpc('fw_agent_for', { p_program: programId, p_kind: kind, p_channel: channel });
	const k = (key as string | null) ?? null;
	if (!k) return null;
	const { data } = await db.from('fw_agents').select('*').eq('key', k).maybeSingle();
	return (data as AgentRow | null) ?? null;
}

// ---------------------------------------------------------------- human layer

export interface HumanizeResult {
	ok: boolean;
	error?: string;
	changes?: string[];
	sources_used?: string[];
}

/** Second pass on a draft: voice, specifics, personal detail from the source context. Stores humanized_md next to the raw draft; never replaces content_md. */
export async function humanizeDraft(db: Db, draft: DraftRow, sourceContext: string | null): Promise<HumanizeResult> {
	const agent = (await agentFor(db, draft.program_id, 'humanize')) ?? ((await db.from('fw_agents').select('*').eq('key', 'humanize').maybeSingle()).data as AgentRow | null);
	if (!agent || !agent.is_active) return { ok: false, error: 'The humanize agent is inactive.' };
	const { data: prog } = await db.from('fw_programs').select('brand_name, primary_url, sme_name, icp_md').eq('id', draft.program_id).maybeSingle();
	const p = prog as { brand_name: string | null; primary_url: string | null; sme_name: string | null; icp_md: string | null } | null;
	// Source context: explicit, else the latest transcript on the program's videos, else the discovery extract input.
	let source = sourceContext?.trim() ?? '';
	if (!source) {
		const { data: v } = await db.from('fw_videos').select('transcript_md').eq('program_id', draft.program_id).not('transcript_md', 'is', null).order('month', { ascending: false }).limit(1).maybeSingle();
		source = ((v as { transcript_md: string | null } | null)?.transcript_md ?? '').slice(0, 30_000);
	}
	if (!source) {
		const { data: e } = await db.from('fw_intake_extracts').select('input_md').eq('program_id', draft.program_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
		source = ((e as { input_md: string | null } | null)?.input_md ?? '').slice(0, 30_000);
	}
	const { data: facts } = await db.from('fw_facts').select('fact').eq('program_id', draft.program_id).neq('status', 'retired');
	const channel = draft.kind === 'citation' ? ((await db.from('fw_citations').select('channel_key').eq('id', draft.target_id).maybeSingle()).data as { channel_key: string } | null)?.channel_key ?? null : null;
	const raw = draft.structured?.body_md ? String(draft.structured.body_md) : (draft.content_md ?? '');
	const prompt = [`BRAND: ${p?.brand_name ?? ''} (${p?.primary_url ?? ''})`, `SME / voice: ${p?.sme_name ?? '—'}`, `IDEAL CUSTOMER: ${p?.icp_md ?? ''}`, `CHANNEL: ${channel ?? draft.kind}`, `VERIFIED FACTS:\n${((facts ?? []) as { fact: string }[]).map((f) => `- ${f.fact}`).join('\n')}`, `SOURCE CONTEXT:\n${source || '(none available — keep every fact as is; do not invent personal detail)'}`, `DRAFT:\n${raw.slice(0, 40_000)}`].join('\n\n');
	const r = await generateText(agent.system_md, prompt, Math.max(agent.max_tokens, 4000));
	if (!r.ok) return { ok: false, error: r.error };
	const j = extractJson<{ text_md?: string; changes?: string[]; sources_used?: string[] }>(r.text);
	const text = (j?.text_md ?? r.text).trim();
	if (!text) return { ok: false, error: 'The humanize pass returned nothing.' };
	const changes = (j?.changes ?? []).map(String).slice(0, 20);
	const sources = (j?.sources_used ?? []).map(String).slice(0, 10);
	await db.from('fw_drafts').update({ humanized_md: text.slice(0, 200_000), humanized_at: new Date().toISOString(), humanize_model: r.provider, humanize_notes: [...changes.map((c) => `• ${c}`), ...(sources.length ? [`Sources: ${sources.join('; ')}`] : [])].join('\n').slice(0, 4000), source_context: source ? source.slice(0, 20_000) : null }).eq('id', draft.id);
	await db.rpc('fw_log', { p_program: draft.program_id, p_kind: 'note', p_summary: `Humanize pass on: ${draft.title ?? draft.kind} (${changes.length} changes)`, p_payload: { draft_id: draft.id }, p_client_visible: false, p_actor_label: null });
	return { ok: true, changes, sources_used: sources };
}

// ---------------------------------------------------------------- keyword discovery from the client site

function htmlToText(html: string, max = 40_000): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
		.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;|&#160;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

const STOP = new Set('the a an and or but of to in on for with at by from as is are was were be been it its this that these those we our you your they their he she his her i me my us them what which who how when where why can will would should could do does did not no yes if then than so very more most much many some any all each other such into out up down over under again also just only own same too about after before during between through above below here there now'.split(' '));

/** Crawl the home page + up to N linked same-host pages; returns text, titles / headings and a term-frequency table. */
export async function crawlSite(url: string, maxPages = 6): Promise<{ ok: true; pages: { url: string; title: string; headings: string[]; text: string }[]; terms: { term: string; count: number; in_headings: number }[] } | { ok: false; error: string }> {
	let home: URL;
	try {
		home = new URL(url);
	} catch {
		return { ok: false, error: 'Invalid URL.' };
	}
	const seen = new Set<string>();
	const queue = [home.toString()];
	const pages: { url: string; title: string; headings: string[]; text: string }[] = [];
	const fetchOne = async (u: string) => {
		const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenRoninBot/1.0; +https://app.example.com)', accept: 'text/html' } });
		if (!res.ok) throw new Error(`${res.status}`);
		const ct = res.headers.get('content-type') ?? '';
		if (!/html/i.test(ct)) throw new Error('not html');
		return await res.text();
	};
	while (queue.length && pages.length < maxPages) {
		const u = queue.shift()!;
		if (seen.has(u)) continue;
		seen.add(u);
		let html: string;
		try {
			html = await fetchOne(u);
		} catch {
			continue;
		}
		const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
		const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => htmlToText(m[1], 200)).filter(Boolean).slice(0, 20);
		pages.push({ url: u, title, headings, text: htmlToText(html) });
		if (pages.length === 1) {
			// gather internal links from the home page, prefer nav-ish ones
			const links = [...html.matchAll(/href="([^"#?]+)"/gi)].map((m) => m[1]);
			for (const l of links) {
				try {
					const abs = new URL(l, home);
					if (abs.host !== home.host) continue;
					if (/\.(png|jpe?g|gif|svg|pdf|css|js|xml|ico|webp|mp4)$/i.test(abs.pathname)) continue;
					if (/\/(wp-admin|wp-login|cart|checkout|account|login|tag|category|feed)\b/i.test(abs.pathname)) continue;
					const s = abs.toString().replace(/\/$/, '');
					if (!seen.has(s) && !queue.includes(s) && s !== home.toString().replace(/\/$/, '')) queue.push(s);
				} catch {
					/* skip */
				}
				if (queue.length > 40) break;
			}
		}
	}
	if (pages.length === 0) return { ok: false, error: 'Could not fetch the site (blocked, timeout or not HTML).' };
	// term frequency: unigrams + bigrams, stopwords out
	const counts = new Map<string, { count: number; in_headings: number }>();
	const bump = (t: string, heading: boolean) => {
		const cur = counts.get(t) ?? { count: 0, in_headings: 0 };
		cur.count++;
		if (heading) cur.in_headings++;
		counts.set(t, cur);
	};
	const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
	for (const p of pages) {
		const words = tokenize(p.text);
		for (let i = 0; i < words.length; i++) {
			bump(words[i], false);
			if (i + 1 < words.length) bump(`${words[i]} ${words[i + 1]}`, false);
		}
		for (const h of [p.title, ...p.headings]) {
			const hw = tokenize(h);
			for (let i = 0; i < hw.length; i++) {
				bump(hw[i], true);
				if (i + 1 < hw.length) bump(`${hw[i]} ${hw[i + 1]}`, true);
			}
		}
	}
	const terms = [...counts.entries()]
		.filter(([, v]) => v.count >= 3)
		.map(([term, v]) => ({ term, ...v }))
		.sort((a, b) => b.in_headings * 5 + b.count - (a.in_headings * 5 + a.count))
		.slice(0, 120);
	return { ok: true, pages, terms };
}

/** Crawl the program's site and run the keyword scout → a site_keywords draft on the program. */
export async function discoverSiteKeywords(db: Db, programId: string, requestedBy: string | null): Promise<{ ok: true; draft_id: string; pages: number; terms: number } | { ok: false; error: string }> {
	const { data: prog } = await db.from('fw_programs').select('brand_name, primary_url, icp_md, competitors, keywords').eq('id', programId).maybeSingle();
	const p = prog as { brand_name: string | null; primary_url: string | null; icp_md: string | null; competitors: string[]; keywords: string[] } | null;
	if (!p?.primary_url) return { ok: false, error: 'Set the primary URL on the program first.' };
	const agent = (await agentFor(db, programId, 'site_keywords')) ?? ((await db.from('fw_agents').select('*').eq('key', 'site_keywords').maybeSingle()).data as AgentRow | null);
	if (!agent) return { ok: false, error: 'The keyword scout agent is inactive.' };
	const crawl = await crawlSite(p.primary_url);
	if (!crawl.ok) return crawl;
	const brief = [`BRAND: ${p.brand_name ?? ''} (${p.primary_url})`, `IDEAL CUSTOMER: ${p.icp_md ?? ''}`, `COMPETITORS: ${(p.competitors ?? []).join(', ')}`, `CLIENT'S OWN KEYWORDS: ${(p.keywords ?? []).join('; ')}`, `PAGES CRAWLED (${crawl.pages.length}):\n${crawl.pages.map((pg) => `- ${pg.url}\n  title: ${pg.title}\n  headings: ${pg.headings.join(' | ')}`).join('\n')}`, `TERM FREQUENCY (term · count · in headings):\n${crawl.terms.map((t) => `${t.term} · ${t.count} · ${t.in_headings}`).join('\n')}`, `HOME PAGE TEXT (excerpt):\n${crawl.pages[0].text.slice(0, 8000)}`].join('\n\n');
	const { data: d } = await db.from('fw_drafts').insert({ program_id: programId, target_kind: 'program', target_id: programId, kind: 'site_keywords', agent_key: agent.key, lane: agent.lane, status: 'generating', title: `Keyword discovery · ${new URL(p.primary_url).host}`, input: { pages: crawl.pages.map((x) => x.url), terms: crawl.terms.slice(0, 60) }, requested_by: requestedBy }).select('id').single();
	const draftId = (d as { id: string } | null)?.id;
	if (!draftId) return { ok: false, error: 'Could not create the draft row.' };
	const r = await generateText(agent.system_md, brief, agent.max_tokens);
	if (!r.ok) {
		await db.from('fw_drafts').update({ status: 'failed', error: r.error }).eq('id', draftId);
		return { ok: false, error: r.error };
	}
	const j = extractJson<{ hypotheses?: unknown[]; anchor_candidates?: string[]; notes?: string }>(r.text);
	const md = j ? `Anchor candidates: ${(j.anchor_candidates ?? []).join(', ')}\n\n${((j.hypotheses ?? []) as { keyword?: string; why?: string; strength?: number; intent?: string }[]).map((h) => `- **${h.keyword}** (${h.intent ?? ''}, strength ${h.strength ?? '?'}) — ${h.why ?? ''}`).join('\n')}\n\n${j.notes ?? ''}` : r.text;
	await db.from('fw_drafts').update({ status: 'draft', content_md: md.slice(0, 100_000), structured: j, model: r.provider }).eq('id', draftId);
	await db.rpc('fw_log', { p_program: programId, p_kind: 'note', p_summary: `Keyword scout crawled ${crawl.pages.length} pages, ${crawl.terms.length} terms`, p_payload: { draft_id: draftId }, p_client_visible: false, p_actor_label: null });
	return { ok: true, draft_id: draftId, pages: crawl.pages.length, terms: crawl.terms.length };
}

/**
 * `auditDb`: client used for the skill_runs bookkeeping. skill_runs has SELECT +
 * INSERT policies only (0020 / 0115, no UPDATE), so with the user's client the
 * done / failed update silently matches zero rows and every run stays
 * 'running'. Server actions pass a service-role client; the cron already is one.
 */
export async function runAgent(db: Db, input: { agent: AgentRow; programId: string; targetId: string; requestedBy: string | null; notes?: string | null; vars?: Record<string, string | null | undefined>; auditDb?: Db }): Promise<{ ok: true; draft_id: string; rules_ok: boolean | null } | { ok: false; error: string; draft_id?: string }> {
	const { agent, programId, targetId, requestedBy } = input;
	const targetKind = TARGET_FOR_KIND[agent.output_kind];
	let brief: Awaited<ReturnType<typeof buildBrief>>;
	try {
		brief = await buildBrief(db, agent, programId, targetId, { notes: input.notes ?? null });
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'brief failed' };
	}
	// skill_runs row for the audit trail (requested_by must equal auth.uid() for a user session; service role bypasses)
	const { data: sr } = await (input.auditDb ?? db).from('skill_runs').insert({ skill: `fw:${agent.key}`, context: { program_id: programId, target_kind: targetKind, target_id: targetId, agent_version: agent.version }, status: 'running', requested_by: requestedBy, runtime: 'inline', started_at: new Date().toISOString() }).select('id').single();
	const skillRunId = (sr as { id: string } | null)?.id ?? null;
	const { data: d } = await db.from('fw_drafts').insert({ program_id: programId, target_kind: targetKind, target_id: targetId, kind: agent.output_kind, agent_key: agent.key, lane: agent.lane, status: 'generating', title: brief.title, input: { brief: brief.brief.slice(0, 60_000), notes: input.notes ?? null, agent_version: agent.version }, skill_run_id: skillRunId, requested_by: requestedBy }).select('id').single();
	const draftId = (d as { id: string } | null)?.id;
	if (!draftId) return { ok: false, error: 'Could not create the draft row (RLS?).' };
	// variables for the prompt library (0145): per-asset keyword first, then whatever the caller passed (angle, audience, word_count, format, secondary_keywords, question, list_items, my_hair, my_life)
	const { data: pk } = await db.from('fw_programs').select('keywords, icp_md').eq('id', programId).maybeSingle();
	const pr = pk as { keywords: string[] | null; icp_md: string | null } | null;
	const vars: Record<string, string | null | undefined> = { primary_keyword: brief.keyword, secondary_keywords: (pr?.keywords ?? []).filter((k) => k !== brief.keyword).slice(0, 5).join(', '), audience: pr?.icp_md ?? null, word_count: agent.output_kind === 'page' ? '1,200–2,500 (per the page kind)' : '800–1,200', format: agent.output_kind === 'page' ? 'on-site page' : (brief.channel ?? 'blog post'), angle: input.notes ?? brief.title, question: input.notes ?? brief.title, list_items: '7', source: '(see brief)', ...(input.vars ?? {}) };
	const r = await generateText(await assembleSystem(db, agent, programId, vars), brief.brief, agent.max_tokens);
	if (!r.ok) {
		await db.from('fw_drafts').update({ status: 'failed', error: r.error }).eq('id', draftId);
		if (skillRunId) await (input.auditDb ?? db).from('skill_runs').update({ status: 'failed', error: r.error, finished_at: new Date().toISOString() }).eq('id', skillRunId);
		return { ok: false, error: r.error, draft_id: draftId };
	}
	const structured = agent.output_schema ? extractJson<Record<string, unknown>>(r.text) : null;
	const content = structured ? String(structured.body_md ?? structured.content_md ?? (structured.clips ? JSON.stringify(structured.clips, null, 2) : r.text)) : r.text;
	// execution rules on pages / citations
	let rules: DraftRow['rules_check'] = null;
	if (agent.output_kind === 'page' || agent.output_kind === 'citation') {
		const { data: prog } = await db.from('fw_programs').select('brand_name, primary_url').eq('id', programId).maybeSingle();
		const p = prog as { brand_name: string | null; primary_url: string | null } | null;
		const text = agent.output_kind === 'page' ? `${String(structured?.title ?? '')}\n${String(structured?.quick_answer_md ?? '')}\n${content}` : `${String(structured?.title ?? '')}\n${content}`;
		const { data: rc } = await db.rpc('fw_check_rules', { p_text: text, p_brand: p?.brand_name ?? null, p_url: p?.primary_url ?? null, p_keyword: brief.keyword, p_facts: brief.factsUsed, p_channel: brief.channel });
		rules = await withBannedPhrases(db, (rc as DraftRow['rules_check']) ?? null, text);
	}
	await db.from('fw_drafts').update({ status: 'draft', content_md: content.slice(0, 200_000), structured, rules_check: rules, model: r.provider, title: structured?.title ? String(structured.title).slice(0, 240) : brief.title }).eq('id', draftId);
	if (skillRunId) await (input.auditDb ?? db).from('skill_runs').update({ status: 'done', result_md: `draft ${draftId}`, finished_at: new Date().toISOString() }).eq('id', skillRunId);
	await db.rpc('fw_log', { p_program: programId, p_kind: 'note', p_summary: `${agent.persona ?? agent.label} drafted: ${brief.title}${rules && !rules.ok ? ` (rules: ${rules.failed.join(', ')})` : ''}`, p_payload: { draft_id: draftId, agent: agent.key }, p_client_visible: false, p_actor_label: null });
	return { ok: true, draft_id: draftId, rules_ok: rules?.ok ?? null };
}

/** Prompt-library rule (0145): the banned AI-phrase list from fw_settings.prompt_rules, added to the SQL checks as `no_banned_phrases`. */
async function withBannedPhrases(db: Db, rules: DraftRow['rules_check'], text: string): Promise<DraftRow['rules_check']> {
	const { data } = await db.from('fw_settings').select('value').eq('key', 'prompt_rules').maybeSingle();
	const banned = ((data as { value?: { banned_phrases?: string[] } } | null)?.value?.banned_phrases ?? []).map((s) => s.toLowerCase());
	const low = text.toLowerCase();
	const hits = banned.filter((b) => low.includes(b));
	const base = rules ?? { ok: true, failed: [], checks: {} };
	const checks = { ...base.checks, no_banned_phrases: hits.length === 0 };
	const failed = hits.length ? Array.from(new Set([...base.failed, 'no_banned_phrases'])) : base.failed;
	return { ...base, ok: failed.length === 0, failed, checks, ...(hits.length ? { banned_hits: hits } : {}) } as DraftRow['rules_check'];
}

/** Re-check the execution rules on a draft after a human edit. */
export async function recheckRules(db: Db, draft: DraftRow): Promise<DraftRow['rules_check']> {
	if (draft.kind !== 'page' && draft.kind !== 'citation') return null;
	const { data: prog } = await db.from('fw_programs').select('brand_name, primary_url').eq('id', draft.program_id).maybeSingle();
	const p = prog as { brand_name: string | null; primary_url: string | null } | null;
	let keyword: string | null = null;
	let channel: string | null = null;
	if (draft.kind === 'page') keyword = ((await db.from('fw_pages').select('keyword').eq('id', draft.target_id).maybeSingle()).data as { keyword: string } | null)?.keyword ?? null;
	else {
		const c = (await db.from('fw_citations').select('keyword, channel_key').eq('id', draft.target_id).maybeSingle()).data as { keyword: string | null; channel_key: string } | null;
		keyword = c?.keyword ?? null;
		channel = c?.channel_key ?? null;
	}
	const { data: facts } = await db.from('fw_facts').select('fact').eq('program_id', draft.program_id).neq('status', 'retired');
	const text = `${String(draft.structured?.title ?? draft.title ?? '')}\n${String(draft.structured?.quick_answer_md ?? '')}\n${draft.content_md ?? ''}`;
	const { data: rc } = await db.rpc('fw_check_rules', { p_text: text, p_brand: p?.brand_name ?? null, p_url: p?.primary_url ?? null, p_keyword: keyword, p_facts: ((facts ?? []) as { fact: string }[]).map((f) => f.fact), p_channel: channel });
	return withBannedPhrases(db, (rc as DraftRow['rules_check']) ?? null, text);
}
