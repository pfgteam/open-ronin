// Hiring H4: enrichment + AI scoring (0131). Server-only, service role in
// the cron; the review actions call scoreApplication() with the caller's
// client for the audit row. Spec flow 6 + round 3:
//
//   enrichment      drains hire_enrichment_jobs: 'link' fetches the URL and
//                   extracts readable text + an AI review; 'resume' parses the
//                   PDF / DOCX in the bucket to text + structured facts;
//                   'video' transcribes through the provider registry's
//                   transcribe capability (Deepgram / AssemblyAI / ElevenLabs,
//                   whichever has a key) on a signed URL, or just records the
//                   link when it is Loom / YouTube (no download); 'linkedin'
//                   runs the Apify actor from settings ONLY when
//                   enrichment.linkedin is on and APIFY_TOKEN exists.
//   scoreApplication  Merit 0-100 against the role's 4R + scoring categories
//                   (from application_config.scoring or defaults), Integrity
//                   0-100 = 100 minus the configured penalties for honeypots,
//                   restarts, blocked pastes, pasted chars, AI-text flags and
//                   claim mismatches the model finds between answers, resume,
//                   links and transcript; overall = weighted blend. Writes the
//                   application + a hire_scoring_runs row; previous_overall
//                   keeps the delta for the dashboard.
//   shortlist       hire_shortlist() + Top-N summaries.

import type { SupabaseClient } from '@supabase/supabase-js';
import { adaptersFor } from '@/lib/providers/registry';
import type { ProviderAdapter } from '@/lib/providers/types';
import { aiTextHeuristic, type ApplicationConfig } from './application';

type Db = SupabaseClient;

function textAdapter(): ProviderAdapter | null {
	return adaptersFor('generate_text').find((a) => a.isConfigured()) ?? null;
}
function transcribeAdapter(): ProviderAdapter | null {
	return adaptersFor('transcribe').find((a) => a.isConfigured()) ?? null;
}
async function generate(adapter: ProviderAdapter, system: string, prompt: string, maxTokens = 2500): Promise<string> {
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

export interface EnrichmentSettings {
	links: boolean;
	resume: boolean;
	video: boolean;
	linkedin: boolean;
	linkedin_actor: string;
	max_fetch_bytes: number;
	fetch_timeout_ms: number;
}
export interface ScoringSettings {
	auto_score_on_submit: boolean;
	merit_weight: number;
	integrity_weight: number;
	integrity_penalties: { honeypot_hit: number; restart: number; blocked_paste: number; pasted_chars_per_500: number; ai_text_flag: number; claim_mismatch: number };
	shortlist_size: number;
}
const DEFAULT_ENRICH: EnrichmentSettings = { links: true, resume: true, video: true, linkedin: false, linkedin_actor: 'apimaestro/linkedin-profile-detail', max_fetch_bytes: 1_500_000, fetch_timeout_ms: 12_000 };
const DEFAULT_SCORING: ScoringSettings = { auto_score_on_submit: true, merit_weight: 70, integrity_weight: 30, integrity_penalties: { honeypot_hit: 25, restart: 5, blocked_paste: 4, pasted_chars_per_500: 3, ai_text_flag: 10, claim_mismatch: 15 }, shortlist_size: 10 };

export async function loadScoringSettings(db: Db): Promise<{ enrich: EnrichmentSettings; scoring: ScoringSettings }> {
	const { data } = await db.from('hire_settings').select('key, value').in('key', ['enrichment', 'scoring']);
	const map = new Map(((data ?? []) as { key: string; value: Record<string, unknown> }[]).map((r) => [r.key, r.value]));
	return {
		enrich: { ...DEFAULT_ENRICH, ...((map.get('enrichment') ?? {}) as Partial<EnrichmentSettings>) },
		scoring: { ...DEFAULT_SCORING, ...((map.get('scoring') ?? {}) as Partial<ScoringSettings>), integrity_penalties: { ...DEFAULT_SCORING.integrity_penalties, ...(((map.get('scoring') ?? {}) as Partial<ScoringSettings>).integrity_penalties ?? {}) } },
	};
}

// ---------------------------------------------------------------- text extraction

export function htmlToText(html: string, max = 20_000): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		.replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n')
		.trim()
		.slice(0, max);
}

async function fetchReadable(url: string, s: EnrichmentSettings): Promise<{ ok: true; title: string | null; text: string; final_url: string; status: number } | { ok: false; error: string }> {
	let res: Response;
	try {
		res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(s.fetch_timeout_ms), headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenRoninBot/1.0; +https://app.example.com/careers)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
	if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
	const ct = res.headers.get('content-type') ?? '';
	if (!/text\/|html|xml|json/i.test(ct)) return { ok: false, error: `not text (${ct.split(';')[0]})` };
	const raw = (await res.text()).slice(0, s.max_fetch_bytes);
	const title = raw.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
	return { ok: true, title, text: htmlToText(raw), final_url: res.url || url, status: res.status };
}

export async function extractResumeText(buf: Uint8Array, mime: string | null, name: string | null): Promise<string> {
	const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name ?? '');
	const isDocx = mime?.includes('officedocument.wordprocessingml') || /\.docx$/i.test(name ?? '');
	if (isPdf) {
		const { extractText, getDocumentProxy } = await import('unpdf');
		const pdf = await getDocumentProxy(buf);
		const { text } = await extractText(pdf, { mergePages: true });
		return String(text).replace(/\s+\n/g, '\n').slice(0, 60_000);
	}
	if (isDocx) {
		const mammoth = await import('mammoth');
		const r = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
		return r.value.slice(0, 60_000);
	}
	// legacy .doc or unknown: best-effort latin1 strings
	const s = Buffer.from(buf).toString('latin1');
	return (s.match(/[\x20-\x7E\n]{4,}/g) ?? []).join(' ').slice(0, 60_000);
}

// ---------------------------------------------------------------- enrichment workers

const RESUME_SYSTEM = `You read a resume and return ONLY JSON: {"name":string|null,"headline":string|null,"location":string|null,"years_experience":number|null,"roles":[{"title":string,"company":string,"start":string|null,"end":string|null,"summary":string}],"skills":[string],"education":[string],"languages":[string],"links":[string],"red_flags":[string],"summary":"2 sentences"}. Be literal; do not invent.`;
const LINK_SYSTEM = `You review a web page a job candidate submitted as proof of work (portfolio, personal site, GitHub, Behance, published article). Return ONLY JSON: {"what_it_is":"one line","owner_matches_candidate":true|false|null,"quality":1-5,"relevance_notes":"what this says about their skills, one or two sentences","claims":[string],"red_flags":[string]}.`;

async function runLinkJob(db: Db, job: Job, s: EnrichmentSettings): Promise<Record<string, unknown>> {
	if (!s.links) throw new Error('skipped: links enrichment off');
	const r = await fetchReadable(job.target, s);
	if (!r.ok) throw new Error(r.error);
	const adapter = textAdapter();
	let review: Record<string, unknown> | null = null;
	if (adapter && r.text.length > 80) {
		const { data: cand } = await db.from('hire_candidates').select('full_name').eq('id', job.candidate_id).maybeSingle();
		try {
			review = extractJson<Record<string, unknown>>(await generate(adapter, LINK_SYSTEM, `Candidate: ${(cand as { full_name: string } | null)?.full_name ?? ''}\nURL: ${r.final_url}\nTitle: ${r.title ?? ''}\n\nPAGE TEXT:\n${r.text.slice(0, 12_000)}`, 900));
		} catch {
			review = null;
		}
	}
	return { title: r.title, final_url: r.final_url, chars: r.text.length, excerpt: r.text.slice(0, 1500), review };
}

async function runResumeJob(db: Db, job: Job, s: EnrichmentSettings): Promise<Record<string, unknown>> {
	if (!s.resume) throw new Error('skipped: resume parsing off');
	const { data: blob, error } = await db.storage.from('hiring-uploads').download(job.target);
	if (error || !blob) throw new Error(error?.message ?? 'download failed');
	const { data: fileRow } = await db.from('hire_application_files').select('id, mime, original_name').eq('path', job.target).maybeSingle();
	const f = fileRow as { id: string; mime: string | null; original_name: string | null } | null;
	const text = await extractResumeText(new Uint8Array(await blob.arrayBuffer()), f?.mime ?? blob.type, f?.original_name ?? null);
	let parsed: Record<string, unknown> | null = null;
	const adapter = textAdapter();
	if (adapter && text.length > 100) {
		try {
			parsed = extractJson<Record<string, unknown>>(await generate(adapter, RESUME_SYSTEM, text.slice(0, 30_000), 1800));
		} catch {
			parsed = null;
		}
	}
	if (f) await db.from('hire_application_files').update({ transcript: text.slice(0, 60_000), parsed }).eq('id', f.id);
	return { chars: text.length, parsed, excerpt: text.slice(0, 1500) };
}

async function runVideoJob(db: Db, job: Job, s: EnrichmentSettings): Promise<Record<string, unknown>> {
	if (!s.video) throw new Error('skipped: video off');
	const isPath = job.target.startsWith('sessions/') || job.target.startsWith('applications/');
	if (!isPath) {
		// Loom / YouTube / Vimeo / Drive: no download; the reviewer watches it. Record the link kind.
		const kind = /loom\.com/.test(job.target) ? 'loom' : /youtu/.test(job.target) ? 'youtube' : /vimeo/.test(job.target) ? 'vimeo' : /drive\.google/.test(job.target) ? 'gdrive' : 'link';
		return { kind, url: job.target, transcript: null, note: 'External video link; transcription applies to in-browser recordings only.' };
	}
	const adapter = transcribeAdapter();
	if (!adapter) throw new Error('skipped: no transcribe provider key (DEEPGRAM / ASSEMBLYAI / ELEVENLABS)');
	const { data: signed, error } = await db.storage.from('hiring-uploads').createSignedUrl(job.target, 1800);
	if (error || !signed) throw new Error(error?.message ?? 'sign failed');
	const out = await adapter.submit({ capability: 'transcribe', audioUrl: signed.signedUrl, language: 'en' });
	const transcript = 'result' in out ? (out.result.text ?? '').trim() : '';
	if (!transcript) throw new Error('empty transcript');
	await db.from('hire_candidates').update({ video_transcript: transcript.slice(0, 20_000) }).eq('id', job.candidate_id);
	await db.from('hire_application_files').update({ transcript: transcript.slice(0, 20_000) }).eq('path', job.target);
	return { kind: 'recording', transcript: transcript.slice(0, 20_000), words: transcript.split(/\s+/).length, provider: adapter.spec.id };
}

async function runLinkedInJob(db: Db, job: Job, s: EnrichmentSettings): Promise<Record<string, unknown>> {
	if (!s.linkedin) throw new Error('skipped: LinkedIn adapter off (Admin → Hiring → Scoring)');
	if (!process.env.APIFY_TOKEN) throw new Error('skipped: APIFY_TOKEN not set');
	const { startRun, getRun, getDatasetItems } = await import('@/lib/scrapers/apify');
	const run = await startRun(s.linkedin_actor, { profileUrls: [job.target], url: job.target });
	// poll up to ~50 s inside the cron budget
	let info = run;
	for (let i = 0; i < 10 && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(info.status); i++) {
		await new Promise((r) => setTimeout(r, 5000));
		info = await getRun(run.id);
	}
	if (info.status !== 'SUCCEEDED') throw new Error(`actor ${info.status}`);
	if (!info.defaultDatasetId) throw new Error('actor returned no dataset');
	const items = await getDatasetItems(info.defaultDatasetId, 0, 1);
	const profile = items[0] ?? null;
	if (profile) await db.from('hire_candidates').update({ enrichment: { linkedin: profile, linkedin_at: new Date().toISOString() } }).eq('id', job.candidate_id);
	return { profile };
}

interface Job {
	id: string;
	application_id: string | null;
	candidate_id: string;
	kind: 'link' | 'resume' | 'video' | 'linkedin';
	target: string;
	attempts: number;
}

/** Drain up to `limit` enrichment jobs. Skips land as 'skipped' (not failed) so the queue stays honest about what is off. */
export async function runEnrichment(db: Db, limit = 8): Promise<{ done: number; failed: number; skipped: number; errors: string[] }> {
	const { enrich } = await loadScoringSettings(db);
	const { data } = await db.from('hire_enrichment_jobs').select('id, application_id, candidate_id, kind, target, attempts').eq('status', 'pending').lt('attempts', 3).order('created_at').limit(limit);
	const out = { done: 0, failed: 0, skipped: 0, errors: [] as string[] };
	for (const job of (data ?? []) as Job[]) {
		await db.from('hire_enrichment_jobs').update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 }).eq('id', job.id);
		try {
			const result = job.kind === 'link' ? await runLinkJob(db, job, enrich) : job.kind === 'resume' ? await runResumeJob(db, job, enrich) : job.kind === 'video' ? await runVideoJob(db, job, enrich) : await runLinkedInJob(db, job, enrich);
			await db.from('hire_enrichment_jobs').update({ status: 'done', result, finished_at: new Date().toISOString(), error: null }).eq('id', job.id);
			out.done++;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const skipped = msg.startsWith('skipped:');
			await db.from('hire_enrichment_jobs').update({ status: skipped ? 'skipped' : job.attempts + 1 >= 3 ? 'failed' : 'pending', error: msg, finished_at: skipped || job.attempts + 1 >= 3 ? new Date().toISOString() : null }).eq('id', job.id);
			if (skipped) out.skipped++;
			else {
				out.failed++;
				out.errors.push(`${job.kind} ${job.target.slice(0, 60)}: ${msg}`);
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------- scoring

const SCORE_SYSTEM = `You are the first-pass reviewer for Open Ronin's hiring. You score a candidate against the role's 4R (Role, Responsibilities, Results, Requirements) and the scoring categories, using ONLY the evidence given (answers, resume text, link reviews, video transcript). Be fair and literal: strong evidence scores high, missing evidence scores low, never invent. Also cross-check claims: where the answers, resume, links or transcript contradict each other (years, titles, tools, employers), list them as claim_mismatches with the two conflicting facts. Return ONLY JSON:
{"categories":[{"key":"...","score":0-100,"evidence":"one or two lines quoting the evidence"}],
 "merit":0-100,
 "claim_mismatches":[{"claim":"...","conflict":"...","severity":"low|medium|high"}],
 "ai_written_suspects":[{"question_key":"...","why":"..."}],
 "top_strength":"one line","biggest_concern":"one line","summary_line":"one line, under 25 words, as a recruiter would write it",
 "recommendation":"advance|maybe|pass"}`;

const DEFAULT_CATEGORIES = [
	{ key: 'role_fit', label: 'Fit to the Role and Responsibilities', weight: 35, description: 'Has done this work or clearly adjacent work.' },
	{ key: 'results', label: 'Evidence of Results', weight: 25, description: 'Numbers, outcomes, ownership.' },
	{ key: 'requirements', label: 'Requirements met', weight: 20, description: 'Skills, tools, experience the 4R asks for.' },
	{ key: 'communication', label: 'Written communication and judgment', weight: 20, description: 'Clarity, specificity, the timed answers.' },
];

export interface ScoreResult {
	merit: number;
	integrity: number;
	overall: number;
	top_strength: string | null;
	biggest_concern: string | null;
	summary_line: string | null;
	breakdown: Record<string, unknown>;
	inputs_used: string[];
}

/** Score one application. Writes the application row + a hire_scoring_runs row. */
export async function scoreApplication(db: Db, applicationId: string, actorId: string | null = null): Promise<{ ok: true; result: ScoreResult } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).' };
	const t0 = Date.now();
	const { data: appRow } = await db.from('hire_applications').select('*, candidate:hire_candidates!hire_applications_candidate_id_fkey(*), position:hire_positions!hire_applications_position_id_fkey(title, brand, role_md, responsibilities_md, results_md, requirements_md, application_config)').eq('id', applicationId).maybeSingle();
	if (!appRow) return { ok: false, error: 'Application not found.' };
	const app = appRow as Record<string, unknown> & { candidate: Record<string, unknown>; position: Record<string, unknown> & { application_config: ApplicationConfig & { scoring?: typeof DEFAULT_CATEGORIES } } };
	const { scoring } = await loadScoringSettings(db);
	const [{ data: answers }, { data: jobs }] = await Promise.all([
		db.from('hire_application_answers').select('question_key, question_type, label, value, typed_chars, pasted_chars, paste_events, blocked_paste_attempts, time_used_s, is_honeypot').eq('application_id', applicationId).order('id'),
		db.from('hire_enrichment_jobs').select('kind, target, status, result').eq('application_id', applicationId),
	]);
	const ans = (answers ?? []) as { question_key: string; question_type: string; label: string | null; value: unknown; typed_chars: number; pasted_chars: number; paste_events: number; blocked_paste_attempts: number; time_used_s: number | null; is_honeypot: boolean }[];
	const enr = (jobs ?? []) as { kind: string; target: string; status: string; result: Record<string, unknown> | null }[];
	const categories = (app.position.application_config?.scoring?.length ? app.position.application_config.scoring : DEFAULT_CATEGORIES) as typeof DEFAULT_CATEGORIES;
	const inputs: string[] = ['answers'];
	const resume = enr.find((j) => j.kind === 'resume' && j.status === 'done');
	const video = enr.find((j) => j.kind === 'video' && j.status === 'done' && j.result?.transcript);
	const links = enr.filter((j) => j.kind === 'link' && j.status === 'done');
	const linkedin = enr.find((j) => j.kind === 'linkedin' && j.status === 'done');
	if (resume) inputs.push('resume');
	if (video) inputs.push('video');
	if (links.length) inputs.push('links');
	if (linkedin) inputs.push('linkedin');

	// local AI-text pass on long answers (adds to the application's count if the heuristic fires where submit missed it)
	const aiTextLocal = ans.filter((a) => (a.question_type === 'long_text' || a.question_type === 'timed_text') && typeof a.value === 'string' && aiTextHeuristic(a.value as string) >= 0.7).map((a) => a.question_key);

	const prompt = [
		`ROLE: ${app.position.title} (${app.position.brand})`,
		`4R:\nRole: ${app.position.role_md}\nResponsibilities: ${app.position.responsibilities_md}\nResults: ${app.position.results_md}\nRequirements: ${app.position.requirements_md}`,
		`SCORING CATEGORIES (weights sum ${categories.reduce((n, c) => n + c.weight, 0)}): ${JSON.stringify(categories)}`,
		`CANDIDATE: ${JSON.stringify({ name: app.candidate.full_name, location: app.candidate.location_text, current: app.candidate.current_title, linkedin: app.candidate.linkedin_url, links: app.candidate.portfolio_urls })}`,
		`ANSWERS (honeypot questions are fake tools; a self-rating >= 3 there is dishonest):\n${ans.filter((a) => !['consent_accept', 'english_ok', 'resume_file', 'video_intro'].includes(a.question_key)).map((a) => `- [${a.question_key}${a.is_honeypot ? ' HONEYPOT' : ''}${a.time_used_s != null ? ` ${a.time_used_s}s` : ''}${a.pasted_chars ? ` pasted:${a.pasted_chars}` : ''}] ${a.label ?? ''}: ${typeof a.value === 'string' ? a.value.slice(0, 2500) : JSON.stringify(a.value)}`).join('\n')}`,
		resume ? `RESUME (parsed): ${JSON.stringify(resume.result?.parsed ?? {}).slice(0, 6000)}\nRESUME TEXT: ${String(resume.result?.excerpt ?? '').slice(0, 3000)}` : 'RESUME: not available',
		links.length ? `LINK REVIEWS: ${JSON.stringify(links.map((l) => ({ url: l.target, review: l.result?.review, title: l.result?.title }))).slice(0, 5000)}` : '',
		video ? `VIDEO TRANSCRIPT: ${String(video.result?.transcript).slice(0, 4000)}` : '',
		linkedin ? `LINKEDIN: ${JSON.stringify(linkedin.result?.profile ?? {}).slice(0, 4000)}` : '',
	]
		.filter(Boolean)
		.join('\n\n');

	let j: { categories?: { key: string; score: number; evidence?: string }[]; merit?: number; claim_mismatches?: { claim: string; conflict: string; severity: string }[]; ai_written_suspects?: { question_key: string; why: string }[]; top_strength?: string; biggest_concern?: string; summary_line?: string; recommendation?: string } | null;
	try {
		j = extractJson(await generate(adapter, SCORE_SYSTEM, prompt, 2200));
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'scoring failed' };
	}
	if (!j) return { ok: false, error: 'The model did not return a score.' };

	// merit: weighted categories (fallback to the model's merit)
	const cats = categories.map((c) => {
		const m = j!.categories?.find((x) => x.key === c.key);
		return { ...c, score: Math.max(0, Math.min(100, Math.round(Number(m?.score ?? 0)))), evidence: m?.evidence ?? null };
	});
	const wsum = cats.reduce((n, c) => n + c.weight, 0) || 1;
	const merit = j.categories?.length ? Math.round(cats.reduce((n, c) => n + (c.score * c.weight) / wsum, 0)) : Math.max(0, Math.min(100, Math.round(Number(j.merit ?? 0))));

	// integrity: 100 minus penalties
	const p = scoring.integrity_penalties;
	const honeypots = Number(app.honeypot_hits ?? 0);
	const restarts = Number(app.restarts ?? 0);
	const blocked = Number(app.blocked_paste_attempts ?? 0);
	const pasted = Number(app.pasted_chars ?? 0);
	const aiFlags = Math.max(Number(app.ai_text_flags ?? 0), aiTextLocal.length, (j.ai_written_suspects ?? []).length);
	const mismatches = (j.claim_mismatches ?? []).filter((m) => m.severity === 'high' || m.severity === 'medium');
	const penalties = [
		{ signal: 'honeypot_hits', n: honeypots, impact: honeypots * p.honeypot_hit },
		{ signal: 'restarts', n: restarts, impact: Math.min(3, restarts) * p.restart },
		{ signal: 'blocked_paste_attempts', n: blocked, impact: Math.min(5, blocked) * p.blocked_paste },
		{ signal: 'pasted_chars', n: pasted, impact: Math.floor(pasted / 500) * p.pasted_chars_per_500 },
		{ signal: 'ai_text_flags', n: aiFlags, impact: aiFlags * p.ai_text_flag },
		{ signal: 'claim_mismatches', n: mismatches.length, impact: mismatches.length * p.claim_mismatch },
	].filter((x) => x.n > 0);
	const integrity = Math.max(0, Math.min(100, 100 - penalties.reduce((n, x) => n + x.impact, 0)));
	const overall = Math.round((merit * scoring.merit_weight + integrity * scoring.integrity_weight) / (scoring.merit_weight + scoring.integrity_weight));

	const result: ScoreResult = {
		merit,
		integrity,
		overall,
		top_strength: j.top_strength?.slice(0, 300) ?? null,
		biggest_concern: j.biggest_concern?.slice(0, 300) ?? null,
		summary_line: j.summary_line?.slice(0, 200) ?? null,
		breakdown: { categories: cats, integrity: penalties, claim_mismatches: j.claim_mismatches ?? [], ai_written_suspects: j.ai_written_suspects ?? [], recommendation: j.recommendation ?? null, weights: { merit: scoring.merit_weight, integrity: scoring.integrity_weight }, inputs },
		inputs_used: inputs,
	};
	const version = Number(app.score_version ?? 0) + 1;
	await db
		.from('hire_applications')
		.update({
			previous_overall: app.overall_score ?? null,
			merit_score: merit,
			integrity_score: integrity,
			overall_score: overall,
			top_strength: result.top_strength,
			biggest_concern: result.biggest_concern,
			summary_line: result.summary_line,
			score_breakdown: result.breakdown,
			scored_at: new Date().toISOString(),
			score_version: version,
			ai_text_flags: aiFlags,
			last_activity_at: new Date().toISOString(),
		})
		.eq('id', applicationId);
	await db.from('hire_scoring_runs').insert({ application_id: applicationId, version, model: adapter.spec.id, merit_score: merit, integrity_score: integrity, overall_score: overall, top_strength: result.top_strength, biggest_concern: result.biggest_concern, summary_line: result.summary_line, breakdown: result.breakdown, inputs_used: inputs, duration_ms: Date.now() - t0, created_by: actorId });
	return { ok: true, result };
}

/** Cron: score unscored applications whose enrichment has settled (no pending/running jobs), then refresh shortlists. */
export async function scorePending(db: Db, limit = 6): Promise<{ scored: number; errors: string[]; shortlisted: number; waiting?: number }> {
	const { scoring } = await loadScoringSettings(db);
	const out = { scored: 0, errors: [] as string[], shortlisted: 0, waiting: 0 };
	if (!scoring.auto_score_on_submit) return out;
	const { data: unscored } = await db.from('hire_applications').select('id, position_id, submitted_at').is('scored_at', null).eq('hidden', false).not('status', 'in', '(rejected,withdrawn)').order('submitted_at').limit(limit * 3);
	out.waiting = (unscored ?? []).length;
	// No text provider in this deployment: every scoreApplication() call would
	// fail the same way. Say so once per tick (with the backlog size, so the
	// cron_runs summary / Dev Dashboard shows the queue growing) and stop,
	// instead of re-reading each application only to produce the same error.
	if (out.waiting > 0 && !textAdapter()) {
		out.errors.push(`${out.waiting} unscored application(s) waiting: no text provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY in Vercel).`);
		return out;
	}
	const touched = new Set<string>();
	let n = 0;
	for (const a of (unscored ?? []) as { id: string; position_id: string; submitted_at: string }[]) {
		if (n >= limit) break;
		const { count } = await db.from('hire_enrichment_jobs').select('id', { count: 'exact', head: true }).eq('application_id', a.id).in('status', ['pending', 'running']);
		// wait for enrichment, but not forever: 30 minutes after submit we score with what we have
		if ((count ?? 0) > 0 && Date.now() - new Date(a.submitted_at).getTime() < 30 * 60_000) continue;
		const r = await scoreApplication(db, a.id, null);
		if (r.ok) {
			out.scored++;
			touched.add(a.position_id);
		} else out.errors.push(`${a.id.slice(0, 8)}: ${r.error}`);
		n++;
	}
	for (const pid of touched) {
		const { data } = await db.rpc('hire_shortlist', { p_position_id: pid });
		out.shortlisted += Number(data ?? 0);
	}
	return out;
}
