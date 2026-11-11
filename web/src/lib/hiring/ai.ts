// Hiring AI (H1: 4R drafting). Server-only. Runs through the content
// provider registry's generate_text capability like lib/revenue/ai.ts, so
// keys and cost caps live in one place. Nothing here writes a 4R: drafts
// land in hire_four_r_drafts for a people manager / Alex to approve.

import type { SupabaseClient } from '@supabase/supabase-js';
import { adaptersFor } from '@/lib/providers/registry';
import type { ProviderAdapter } from '@/lib/providers/types';
import type { FourRText } from './shared';

type Db = SupabaseClient;

function textAdapter(): ProviderAdapter | null {
	return adaptersFor('generate_text').find((a) => a.isConfigured()) ?? null;
}

export function aiConfigured(): boolean {
	return textAdapter() !== null;
}

async function generate(adapter: ProviderAdapter, system: string, prompt: string, maxTokens = 1800): Promise<string> {
	const out = await adapter.submit({ capability: 'generate_text', prompt, system, maxTokens });
	const text = 'result' in out ? out.result.text?.trim() : undefined;
	if (!text) throw new Error(`${adapter.spec.label} returned no text`);
	return text;
}

function extractJson<T>(text: string): T | null {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		return JSON.parse(m[0]) as T;
	} catch {
		return null;
	}
}

const SYSTEM = `You write 4R job descriptions for Open Ronin (Open Ronin), a purpose-driven PR agency (HQ; CPG, food & beverage, fashion, beauty, health & wellness clients) that also runs Beacon (self-serve PR software). A 4R has four sections: Role (one or two paragraphs: what the position is for), Responsibilities (bullets: what the person does), Results (bullets: what it looks like when done well, measurable where possible), Requirements (bullets: skills, experience, traits). Tone: direct, concrete, the org's voice ("minimum effective dose", "client-centric mission", "125% of goal", daily huddle, weekly one-on-one, metrics by the 5th). No pay, no About Us, no personal names. Markdown bullets as "- ". Return ONLY JSON: {"position_label": string, "department": string|null, "reports_to": string|null, "role_md": string, "responsibilities_md": string, "results_md": string, "requirements_md": string}.`;

export interface DraftInput {
	name: string;
	job_role: string | null;
	title: string | null;
	pap_position: string | null;
	position_track: string | null;
	department: string | null;
	manager_name: string | null;
	/** The closest template, if any, as the starting point. */
	template: FourRText | null;
	/** Recent work-item titles / metrics, to ground the draft in what they do. */
	context: string[];
}

/** Drafts a 4R for a person from their profile facts, the nearest template and recent work. */
export async function draftFourRForPerson(input: DraftInput): Promise<{ ok: true; draft: FourRText } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	const prompt = [
		`Draft the 4R for this team member. Describe the ROLE, not the person: the result must read as a position description that would survive the person leaving.`,
		`Facts: role="${input.job_role ?? ''}", title="${input.title ?? ''}", specialty="${input.pap_position ?? ''}", track="${input.position_track ?? ''}", department="${input.department ?? ''}", reports to="${input.manager_name ?? ''}".`,
		input.template ? `Starting template (adapt, do not copy verbatim):\n${JSON.stringify(input.template)}` : 'No template matched; write from the facts.',
		input.context.length ? `Recent work (titles): ${input.context.slice(0, 40).join(' | ')}` : '',
		`reports_to should be the manager's POSITION if you can infer it, otherwise null.`,
	]
		.filter(Boolean)
		.join('\n\n');
	try {
		const text = await generate(adapter, SYSTEM, prompt);
		const j = extractJson<FourRText>(text);
		if (!j || !j.role_md) return { ok: false, error: 'The model did not return a 4R.' };
		return {
			ok: true,
			draft: {
				position_label: String(j.position_label ?? input.job_role ?? '').slice(0, 160),
				department: j.department ? String(j.department).slice(0, 80) : (input.department ?? null),
				reports_to: j.reports_to ? String(j.reports_to).slice(0, 120) : null,
				role_md: String(j.role_md ?? '').trim(),
				responsibilities_md: String(j.responsibilities_md ?? '').trim(),
				results_md: String(j.results_md ?? '').trim(),
				requirements_md: String(j.requirements_md ?? '').trim(),
			},
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'AI draft failed.' };
	}
}

/** Drafts the 4R for a NEW position from a title + brief + optional template. */
export async function draftFourRForPosition(input: { title: string; brand: string; department: string | null; brief: string | null; template: FourRText | null }): Promise<{ ok: true; draft: FourRText } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	const prompt = [
		`Draft the 4R for a new position.`,
		`Title: ${input.title}. Brand: ${input.brand}. Department: ${input.department ?? 'unknown'}.`,
		input.brief ? `Hiring manager's brief: ${input.brief}` : '',
		input.template ? `Starting template (adapt):\n${JSON.stringify(input.template)}` : '',
	]
		.filter(Boolean)
		.join('\n\n');
	try {
		const text = await generate(adapter, SYSTEM, prompt);
		const j = extractJson<FourRText>(text);
		if (!j || !j.role_md) return { ok: false, error: 'The model did not return a 4R.' };
		return {
			ok: true,
			draft: {
				position_label: input.title,
				department: j.department ? String(j.department).slice(0, 80) : input.department,
				reports_to: j.reports_to ? String(j.reports_to).slice(0, 120) : null,
				role_md: String(j.role_md ?? '').trim(),
				responsibilities_md: String(j.responsibilities_md ?? '').trim(),
				results_md: String(j.results_md ?? '').trim(),
				requirements_md: String(j.requirements_md ?? '').trim(),
			},
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'AI draft failed.' };
	}
}

/** Recent work-item titles for a person, to ground an AI 4R draft. */
export async function recentWorkTitles(db: Db, userId: string, limit = 40): Promise<string[]> {
	const { data } = await db.from('tasks').select('title').eq('assignee_id', userId).order('updated_at', { ascending: false }).limit(limit);
	return ((data ?? []) as { title: string | null }[]).map((t) => t.title ?? '').filter(Boolean);
}

// ---------------------------------------------------------------- application builder (H3)

const APP_SYSTEM = `You design the screening section of a job application for Open Ronin from the role's 4R. Return ONLY JSON with this shape:
{"screening":[{"key":"snake_case","type":"select|boolean|short_text|long_text","label":"...","required":true,"options":["..."]}],
 "skills":[{"key":"skill_<snake>","label":"Tool or skill the role really needs"}],
 "honeypots":[{"key":"skill_<snake>","label":"A plausible-sounding tool or method that does NOT exist in this field (so a 4/5 self-rating is a red flag)"}],
 "challenges":[{"key":"challenge_<n>","label":"A realistic 3-minute scenario question that tests judgment for THIS role; no research needed","time_limit_s":180}],
 "scoring":[{"key":"snake_case","label":"Scoring category","description":"what evidence counts","weight":10}]}
Rules: 4-6 screening questions (knockouts: hours, dedication, start date, comp expectation, relevant years); 5-7 real skills; 2-3 honeypots that sound real (invented product names, fake certifications); 2 challenges; 4-6 scoring categories whose weights sum to 100. Keys unique, lowercase, a-z0-9_. English.`;

export interface AppDraft {
	screening: { key: string; type: string; label: string; required?: boolean; options?: string[] }[];
	skills: { key: string; label: string }[];
	honeypots: { key: string; label: string }[];
	challenges: { key: string; label: string; time_limit_s?: number }[];
	scoring: { key: string; label: string; description?: string; weight: number }[];
}

/** AI drafts role-specific screening, skills + honeypots, timed challenges and scoring categories from the 4R. */
export async function draftApplicationFromFourR(input: { title: string; brand: string } & FourRText): Promise<{ ok: true; draft: AppDraft } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	try {
		const text = await generate(adapter, APP_SYSTEM, `Role: ${input.title} (${input.brand}).\n\nRole:\n${input.role_md}\n\nResponsibilities:\n${input.responsibilities_md}\n\nResults:\n${input.results_md}\n\nRequirements:\n${input.requirements_md}`, 2500);
		const j = extractJson<AppDraft>(text);
		if (!j || !Array.isArray(j.skills)) return { ok: false, error: 'The model did not return an application draft.' };
		const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q$1').slice(0, 60) || 'q';
		return {
			ok: true,
			draft: {
				screening: (j.screening ?? []).slice(0, 8).map((q) => ({ ...q, key: key(q.key), type: ['select', 'boolean', 'short_text', 'long_text'].includes(q.type) ? q.type : 'short_text' })),
				skills: (j.skills ?? []).slice(0, 10).map((s) => ({ key: key(s.key.startsWith('skill_') ? s.key : `skill_${s.key}`), label: String(s.label).slice(0, 120) })),
				honeypots: (j.honeypots ?? []).slice(0, 4).map((s) => ({ key: key(s.key.startsWith('skill_') ? s.key : `skill_${s.key}`), label: String(s.label).slice(0, 120) })),
				challenges: (j.challenges ?? []).slice(0, 3).map((c, i) => ({ key: key(c.key || `challenge_${i + 1}`), label: String(c.label).slice(0, 600), time_limit_s: Math.max(60, Math.min(900, Number(c.time_limit_s) || 180)) })),
				scoring: (j.scoring ?? []).slice(0, 8).map((s) => ({ key: key(s.key), label: String(s.label).slice(0, 80), description: s.description ? String(s.description).slice(0, 300) : undefined, weight: Math.max(1, Math.min(100, Number(s.weight) || 10)) })),
			},
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'AI draft failed.' };
	}
}

// ---------------------------------------------------------------- interviews (H5)

const QUESTIONS_SYSTEM = `You prepare an interviewer at Open Ronin for a specific candidate. Given the role's 4R, the standard questions for this interview level, the candidate's application highlights, scores and any earlier scorecards, return ONLY markdown: a short "Watch for" list (3-5 bullets from integrity flags, 2s on earlier cards, claim mismatches), then "Tailored questions" — 4-6 probing follow-ups specific to THIS candidate (reference their actual answers / resume), then for the role-specific execution question, a concrete version using one real responsibility from the 4R. Keep it under 350 words.`;

export async function draftInterviewQuestions(input: { kind: string; standard: { label: string; prompt: string }[]; fourR: FourRText; title: string; highlights: Record<string, unknown>; priorCards: Record<string, unknown>[] }): Promise<{ ok: true; md: string } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	try {
		const md = await generate(adapter, QUESTIONS_SYSTEM, `INTERVIEW: ${input.kind} for ${input.title}\n\n4R:\n${JSON.stringify({ role: input.fourR.role_md, responsibilities: input.fourR.responsibilities_md, requirements: input.fourR.requirements_md }).slice(0, 5000)}\n\nSTANDARD QUESTIONS:\n${input.standard.map((q) => `- ${q.label}: ${q.prompt}`).join('\n')}\n\nCANDIDATE HIGHLIGHTS:\n${JSON.stringify(input.highlights).slice(0, 6000)}\n\nEARLIER SCORECARDS:\n${JSON.stringify(input.priorCards).slice(0, 3000)}`, 1200);
		return { ok: true, md };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'draft failed' };
	}
}

const PREFILL_SYSTEM = `You read an interview transcript and prefill the interviewer's scorecard on the org's 4-point scale (1 No Hire, 2 Conditional Pass, 3 Proceed with Caution, 4 Good Candidate) using the anchors given. Only score questions the transcript actually covers; leave others out. Return ONLY JSON: {"summary_md":"under 150 words: what the candidate said, strengths, concerns","answers":{"<question_key>":{"score":1-4,"note":"one line quoting the transcript"}},"flags":["..."]}. A human confirms every score.`;

export async function prefillScorecard(input: { kind: string; questions: { key: string; label: string; prompt: string; anchors: Record<string, string> }[]; transcript: string }): Promise<{ ok: true; summary_md: string; answers: Record<string, { score: number; note: string }>; flags: string[] } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	try {
		const j = extractJson<{ summary_md?: string; answers?: Record<string, { score: number; note: string }>; flags?: string[] }>(await generate(adapter, PREFILL_SYSTEM, `INTERVIEW KIND: ${input.kind}\n\nQUESTIONS + ANCHORS:\n${JSON.stringify(input.questions)}\n\nTRANSCRIPT:\n${input.transcript.slice(0, 60_000)}`, 1800));
		if (!j) return { ok: false, error: 'The model did not return a prefill.' };
		const valid = new Set(input.questions.map((q) => q.key));
		const answers: Record<string, { score: number; note: string }> = {};
		for (const [k, v] of Object.entries(j.answers ?? {})) if (valid.has(k) && v?.score >= 1 && v.score <= 4) answers[k] = { score: Math.round(v.score), note: String(v.note ?? '').slice(0, 400) };
		return { ok: true, summary_md: String(j.summary_md ?? '').slice(0, 3000), answers, flags: (j.flags ?? []).map(String).slice(0, 10) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'prefill failed' };
	}
}

// ---------------------------------------------------------------- post kit (H2)

const POST_SYSTEM = `You rewrite a job posting for a specific job board. Keep every fact (title, brand, responsibilities, results, requirements, compensation statement, apply link) and the Open Ronin voice: direct, concrete, purpose-driven. Follow the board's format hint exactly. Plain text unless the hint says markdown. Never invent pay numbers; if the posting has a compensation statement, use it verbatim. The apply link must appear once, at the end, unchanged. Return ONLY the post text.`;

/** AI-format a posting for one board; falls back to the template text when no provider is configured. */
export async function formatPostForBoard(input: { posting_md: string; board_label: string; format_hint: string | null; max_chars: number | null; apply_link: string; template_text: string }): Promise<{ text: string; by: string }> {
	const adapter = textAdapter();
	if (!adapter) return { text: input.template_text, by: 'template' };
	try {
		const prompt = [`Board: ${input.board_label}.`, input.format_hint ? `Format hint: ${input.format_hint}` : '', input.max_chars ? `Hard limit: ${input.max_chars} characters.` : '', `Apply link: ${input.apply_link}`, `Source posting (markdown):\n${input.posting_md}`].filter(Boolean).join('\n\n');
		let text = await generate(adapter, POST_SYSTEM, prompt, 2500);
		if (!text.includes(input.apply_link)) text = `${text.trim()}\n\nApply: ${input.apply_link}`;
		if (input.max_chars && text.length > input.max_chars) return { text: input.template_text, by: 'template (AI output over limit)' };
		return { text, by: `ai:${adapter.spec.id}` };
	} catch {
		return { text: input.template_text, by: 'template (AI failed)' };
	}
}
