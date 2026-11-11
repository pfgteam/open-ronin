// Flywheel AI (F2+). Server-only. Runs through the content provider
// registry's generate_text capability like lib/hiring/ai.ts, so keys and
// cost caps live in one place. Nothing here writes a program directly:
// extracts land in fw_intake_extracts for a human to apply.

import { adaptersFor } from '@/lib/providers/registry';
import type { ProviderAdapter } from '@/lib/providers/types';

function textAdapter(): ProviderAdapter | null {
	return adaptersFor('generate_text').find((a) => a.isConfigured()) ?? null;
}

export function aiConfigured(): boolean {
	return textAdapter() !== null;
}

export function aiProviderLabel(): string | null {
	return textAdapter()?.spec.id ?? null;
}

export async function generateText(system: string, prompt: string, maxTokens = 2000): Promise<{ ok: true; text: string; provider: string } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	try {
		const out = await adapter.submit({ capability: 'generate_text', prompt, system, maxTokens });
		const text = 'result' in out ? out.result.text?.trim() : undefined;
		if (!text) return { ok: false, error: `${adapter.spec.label} returned no text` };
		return { ok: true, text, provider: adapter.spec.id };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'AI call failed.' };
	}
}

export function extractJson<T>(text: string): T | null {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		return JSON.parse(m[0]) as T;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- F2: intake extract

export interface IntakeExtract {
	brand_name?: string | null;
	primary_url?: string | null;
	competitors?: string[];
	keywords?: string[];
	anchor_keyword?: string | null;
	icp_md?: string | null;
	sme_name?: string | null;
	sme_email?: string | null;
	sme_phone?: string | null;
	dev_contact?: string | null;
	facts?: string[];
	keyword_hypotheses?: { keyword: string; why: string; source?: string }[];
	angles_md?: string | null;
	access?: { gbp?: boolean; search_console?: boolean; analytics?: boolean; site_backend?: boolean; notes?: string };
	open_questions?: string[];
}

const INTAKE_SYSTEM = `You are the intake analyst for Open Ronin's AEO Flywheel program. You read a discovery-call transcript (or notes) and extract the onboarding fields the SOP requires. Be literal: only state what the client said or clearly confirmed; put guesses under keyword_hypotheses with the reason, and anything unanswered under open_questions. Facts must be specific and checkable (founding year, counts, awards, certifications, proprietary methods, validations) — 6 to 10 if the material supports it. Keywords are the exact phrases a buyer would type or ask an AI. Return ONLY JSON:
{"brand_name":string|null,"primary_url":string|null,"competitors":string[],"keywords":string[],"anchor_keyword":string|null,"icp_md":string|null,"sme_name":string|null,"sme_email":string|null,"sme_phone":string|null,"dev_contact":string|null,"facts":string[],"keyword_hypotheses":[{"keyword":string,"why":string,"source":"transcript"}],"angles_md":string|null,"access":{"gbp":boolean,"search_console":boolean,"analytics":boolean,"site_backend":boolean,"notes":string},"open_questions":string[]}`;

export async function extractIntake(input: { transcript: string; brand_hint?: string | null; url_hint?: string | null }): Promise<{ ok: true; extract: IntakeExtract; provider: string } | { ok: false; error: string }> {
	const r = await generateText(INTAKE_SYSTEM, [`Known: brand="${input.brand_hint ?? ''}" url="${input.url_hint ?? ''}".`, `TRANSCRIPT / NOTES:\n${input.transcript.slice(0, 90_000)}`].join('\n\n'), 2500);
	if (!r.ok) return r;
	const j = extractJson<IntakeExtract>(r.text);
	if (!j) return { ok: false, error: 'The model did not return an intake extract.' };
	const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
	const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);
	const extract: IntakeExtract = {
		brand_name: str(j.brand_name, 160),
		primary_url: str(j.primary_url, 400),
		competitors: list(j.competitors, 10),
		keywords: list(j.keywords, 20),
		anchor_keyword: str(j.anchor_keyword, 200),
		icp_md: str(j.icp_md, 4000),
		sme_name: str(j.sme_name, 120),
		sme_email: str(j.sme_email, 160),
		sme_phone: str(j.sme_phone, 40),
		dev_contact: str(j.dev_contact, 200),
		facts: list(j.facts, 12).map((f) => f.slice(0, 600)),
		keyword_hypotheses: (Array.isArray(j.keyword_hypotheses) ? j.keyword_hypotheses : []).slice(0, 20).map((h) => ({ keyword: String(h?.keyword ?? '').slice(0, 200), why: String(h?.why ?? '').slice(0, 300), source: 'transcript' })).filter((h) => h.keyword),
		angles_md: str(j.angles_md, 4000),
		access: j.access && typeof j.access === 'object' ? { gbp: !!j.access.gbp, search_console: !!j.access.search_console, analytics: !!j.access.analytics, site_backend: !!j.access.site_backend, notes: str(j.access.notes, 1000) ?? undefined } : undefined,
		open_questions: list(j.open_questions, 15),
	};
	return { ok: true, extract, provider: r.provider };
}

