// Revenue Engine AI (0125, spec §8). Server-only. Everything runs through
// the content provider registry's generate_text capability (Anthropic first,
// then OpenAI, whichever has a key) so the keys and cost caps live in one
// place. Nothing here sends anything externally: briefs and drafts land on
// the deal for a human to use.
//
//   buildBrief(deal)       pre-call intel brief (priority #1): who they are,
//                          the brand, fit + heat, prior touches, likely
//                          objections (fear / greed / urgency levers), the
//                          suggested package, questions to ask.
//   analyzeCall(call)      post-call (priority #2): summary, next steps,
//                          follow-up draft, stage suggestion, action items
//                          (owner + due), rubric score per criterion.
//   The realtime in-session agent (spec "Later") plugs in at the same
//   interface: it would call scoreTranscript() on a rolling window.

import type { SupabaseClient } from '@supabase/supabase-js';
import { adaptersFor } from '@/lib/providers/registry';
import type { ProviderAdapter } from '@/lib/providers/types';

type Db = SupabaseClient;

function textAdapter(): ProviderAdapter | null {
	return adaptersFor('generate_text').find((a) => a.isConfigured()) ?? null;
}

async function generate(adapter: ProviderAdapter, system: string, prompt: string, maxTokens = 1500): Promise<string> {
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

const OR_CONTEXT = `${process.env.NEXT_PUBLIC_ORG_NAME || 'the organization'}. Use only the packages, prices and services in the deal and product records; never invent a price.`;

// ---------------------------------------------------------------- facts

async function dealFacts(db: Db, dealId: string) {
	const { data: deal } = await db.from('rev_deals').select('*').eq('id', dealId).maybeSingle();
	if (!deal) throw new Error('deal not found');
	const [person, brand, company, acts, calls, stage, pipeline, products] = await Promise.all([
		deal.primary_person_id ? db.from('rev_people').select('display_name, title, email, phone, linkedin_url, instagram, location, notes_md, intel, enrichment').eq('id', deal.primary_person_id).maybeSingle() : Promise.resolve({ data: null }),
		deal.brand_id ? db.from('rev_brands').select('name, domain, website, industry, vertical, socials, description, intel, enrichment').eq('id', deal.brand_id).maybeSingle() : Promise.resolve({ data: null }),
		deal.company_id ? db.from('rev_companies').select('name, domain, industry, hq_city, hq_state, employee_count, est_revenue_cents').eq('id', deal.company_id).maybeSingle() : Promise.resolve({ data: null }),
		db.from('rev_activities').select('kind, channel, direction, subject, body_md, outcome, is_positive, occurred_at').eq('deal_id', dealId).order('occurred_at', { ascending: false }).limit(25),
		db.from('rev_calls').select('call_kind, status, occurred_at, summary_md, next_steps_md, score').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(5),
		db.from('rev_stages').select('name, slug').eq('id', deal.stage_id).maybeSingle(),
		db.from('rev_pipelines').select('name, slug, lane').eq('id', deal.pipeline_id).maybeSingle(),
		(deal.product_ids ?? []).length ? db.from('rev_products').select('name, price_cents').in('id', deal.product_ids) : Promise.resolve({ data: [] }),
	]);
	return {
		deal: {
			title: deal.title,
			motion: deal.motion,
			stage: stage.data?.name,
			pipeline: pipeline.data?.name,
			lane: pipeline.data?.lane,
			quality: deal.quality_score,
			heat: deal.heat_score,
			tier: deal.mql_tier,
			routing: deal.routing,
			budget_band: deal.budget_band,
			timing: deal.timing,
			source: deal.source,
			campaign: deal.campaign,
			value_cents: (deal.est_mrr_cents ?? 0) + (deal.est_one_time_cents ?? 0),
			fit_signals: deal.fit_signals,
			ai_fit_summary: deal.ai_fit_summary,
			next_action: deal.next_action,
			no_show_count: deal.no_show_count,
			products_of_interest: ((products.data ?? []) as { name: string; price_cents: number | null }[]).map((p) => `${p.name}${p.price_cents ? ` ($${Math.round(p.price_cents / 100)})` : ''}`),
		},
		person: person.data,
		brand: brand.data,
		company: company.data,
		recent_activity: (acts.data ?? []).map((a: Record<string, unknown>) => ({ when: a.occurred_at, kind: a.kind, channel: a.channel, direction: a.direction, subject: a.subject, note: typeof a.body_md === 'string' ? a.body_md.slice(0, 300) : null, outcome: a.outcome, positive: a.is_positive })),
		prior_calls: calls.data ?? [],
	};
}

// ---------------------------------------------------------------- brief

export async function buildBrief(db: Db, dealId: string, opts: { callId?: string | null; forUserId?: string | null } = {}): Promise<{ id: string; body_md: string } | { error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { error: 'No text provider configured (ANTHROPIC_API_KEY or OPENAI_API_KEY). Admin → Providers.' };
	const facts = await dealFacts(db, dealId);
	const prompt = `Write the pre-call intel brief for the next call on this prospect. Facts (JSON):\n${JSON.stringify(facts, null, 1)}\n\nFormat as markdown with exactly these sections:\n## Who they are\n## The brand\n## Fit and heat\n## Prior touches\n## Likely objections (fear / greed / urgency)\n## Suggested product and package\n## Questions to ask\nKeep it under 400 words. Be concrete; if a fact is unknown say "unknown" rather than inventing it.`;
	const body = await generate(adapter, `You are the sales-intelligence analyst for ${OR_CONTEXT} Write for a busy rep who has 5 minutes before the call.`, prompt, 1200);
	const { data, error } = await db
		.from('rev_briefs')
		.insert({ deal_id: dealId, call_id: opts.callId ?? null, for_user_id: opts.forUserId ?? null, body_md: body, facts, analyzer: adapter.spec.id })
		.select('id')
		.single();
	if (error) return { error: error.message };
	await db.from('rev_activities').insert({ deal_id: dealId, kind: 'system', actor_kind: 'ai', subject: 'Pre-call brief generated', is_touch: false, meta: { brief_id: data.id } });
	return { id: data.id, body_md: body };
}

// ---------------------------------------------------------------- post-call

export interface CallAnalysis {
	summary_md: string;
	next_steps_md: string;
	follow_up_draft_md: string;
	suggested_stage_slug: string | null;
	action_items: { title: string; owner: 'rep' | 'prospect' | 'team'; due_days: number | null }[];
	score: number | null;
	criteria: { name: string; weight: number; score: number; note: string }[];
}

export async function analyzeCall(db: Db, callId: string): Promise<{ ok: true; analysis: CallAnalysis } | { ok: false; error: string }> {
	const adapter = textAdapter();
	if (!adapter) return { ok: false, error: 'No text provider configured (ANTHROPIC_API_KEY or OPENAI_API_KEY). Admin → Providers.' };
	const { data: call } = await db.from('rev_calls').select('*').eq('id', callId).maybeSingle();
	if (!call) return { ok: false, error: 'call not found' };
	let transcript: string | null = call.transcript_md;
	if (!transcript && call.session_call_id) {
		const { data: t } = await db.from('call_transcripts').select('content').eq('call_id', call.session_call_id).maybeSingle();
		transcript = (t as { content: string } | null)?.content ?? null;
	}
	if (!transcript) return { ok: false, error: 'No transcript on this call yet.' };
	const { data: rubric } = call.rubric_key ? await db.from('rev_call_rubrics').select('key, label, body_md, criteria').eq('key', call.rubric_key).maybeSingle() : { data: null };
	const facts = call.deal_id ? await dealFacts(db, call.deal_id) : null;
	const { data: stages } = facts && call.deal_id ? await db.from('rev_stages').select('slug, name').eq('pipeline_id', (await db.from('rev_deals').select('pipeline_id').eq('id', call.deal_id).single()).data!.pipeline_id).order('position') : { data: [] };

	const prompt = `Analyze this ${call.call_kind} call transcript.\n\nDEAL FACTS:\n${JSON.stringify(facts?.deal ?? {}, null, 1)}\nBRAND: ${JSON.stringify(facts?.brand ?? {}, null, 1)}\nPERSON: ${JSON.stringify(facts?.person ?? {}, null, 1)}\nPIPELINE STAGES (slugs): ${(stages ?? []).map((s: { slug: string; name: string }) => `${s.slug} = ${s.name}`).join(', ')}\n\n${rubric ? `RUBRIC (${rubric.label}):\n${rubric.body_md}\n` : ''}\nTRANSCRIPT:\n${transcript.slice(0, 60_000)}\n\nReturn ONLY a JSON object with keys:\n{"summary_md": "markdown, under 200 words", "next_steps_md": "markdown bullets", "follow_up_draft_md": "a short follow-up email the rep can send, markdown, in the rep's voice", "suggested_stage_slug": "one of the pipeline stage slugs or null", "action_items": [{"title": "...", "owner": "rep|prospect|team", "due_days": 2}], "score": 0-100 or null, "criteria": [{"name": "rubric criterion name", "weight": n, "score": 0-5, "note": "one line of evidence"}]}\nScore each rubric criterion 0-5 from evidence in the transcript; score = sum(score/5*weight). If no rubric, criteria = [] and score = null.`;
	const text = await generate(adapter, `You are the sales coach for ${OR_CONTEXT} Be specific and quote the transcript in notes.`, prompt, 2500);
	const parsed = extractJson<CallAnalysis>(text);
	if (!parsed) return { ok: false, error: 'The model did not return valid JSON.' };
	const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
	const score = criteria.length ? Math.round(criteria.reduce((n, c) => n + (Math.max(0, Math.min(5, Number(c.score) || 0)) / 5) * (Number(c.weight) || 0), 0) * 10) / 10 : parsed.score ?? null;
	const analysis: CallAnalysis = { ...parsed, criteria, score, action_items: Array.isArray(parsed.action_items) ? parsed.action_items.slice(0, 12) : [] };

	await db
		.from('rev_calls')
		.update({
			summary_md: analysis.summary_md ?? null,
			next_steps_md: analysis.next_steps_md ?? null,
			follow_up_draft_md: analysis.follow_up_draft_md ?? null,
			suggested_stage_slug: analysis.suggested_stage_slug ?? null,
			score: analysis.score,
			score_breakdown: { total: analysis.score, criteria: analysis.criteria, rubric: rubric?.key ?? null },
			analyzed_at: new Date().toISOString(),
			analyzer: adapter.spec.id,
			status: 'analyzed',
		})
		.eq('id', callId);
	// action items (suggested; the rep accepts them into tasks)
	await db.from('rev_call_action_items').delete().eq('call_id', callId).eq('status', 'suggested');
	if (analysis.action_items.length && call.deal_id) {
		await db.from('rev_call_action_items').insert(
			analysis.action_items.map((a) => ({
				call_id: callId,
				deal_id: call.deal_id,
				title: String(a.title).slice(0, 300),
				owner_id: a.owner === 'rep' ? call.owner_id : null,
				due_at: a.due_days != null ? new Date(Date.now() + Number(a.due_days) * 86_400_000).toISOString() : null,
			})),
		);
	}
	if (call.deal_id) {
		await db.from('rev_activities').insert({ deal_id: call.deal_id, person_id: call.person_id, kind: 'system', actor_kind: 'ai', subject: `Call analyzed${analysis.score != null ? ` · ${analysis.score}/100` : ''}`, body_md: analysis.summary_md?.slice(0, 2000) ?? null, is_touch: false, meta: { call_id: callId } });
		// bell the owner: action items waiting
		if (call.owner_id && analysis.action_items.length) {
			await db.from('notifications').upsert(
				{ user_id: call.owner_id, kind: 'revenue', title: `Post-call: ${analysis.action_items.length} action item${analysis.action_items.length === 1 ? '' : 's'}`, body: analysis.next_steps_md?.slice(0, 300) ?? null, href: `/prospects/deals/${call.deal_id}?tab=calls`, dedupe_key: `rev:postcall:${callId}` },
				{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
			);
		}
	}
	return { ok: true, analysis };
}

// ---------------------------------------------------------------- zoom (S2S) recording pull

async function zoomToken(): Promise<string | null> {
	const id = process.env.ZOOM_ACCOUNT_ID, cid = process.env.ZOOM_CLIENT_ID, sec = process.env.ZOOM_CLIENT_SECRET;
	if (!id || !cid || !sec) return null;
	const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(id)}`, {
		method: 'POST',
		headers: { authorization: `Basic ${Buffer.from(`${cid}:${sec}`).toString('base64')}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new Error(`zoom token ${res.status}`);
	return ((await res.json()) as { access_token: string }).access_token;
}

export function zoomConfigured(): boolean {
	return !!(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

/** Pull the recording + transcript for a Zoom meeting id onto a rev_calls row. */
export async function pullZoomRecording(db: Db, callId: string): Promise<{ ok: true; transcript: boolean } | { ok: false; error: string }> {
	const { data: call } = await db.from('rev_calls').select('id, external_id, source, transcript_md').eq('id', callId).maybeSingle();
	if (!call) return { ok: false, error: 'call not found' };
	if (call.source !== 'zoom' || !call.external_id) return { ok: false, error: 'Not a Zoom call with a meeting id.' };
	const token = await zoomToken();
	if (!token) return { ok: false, error: 'Zoom S2S not configured (ZOOM_ACCOUNT_ID / CLIENT_ID / CLIENT_SECRET).' };
	const h = { authorization: `Bearer ${token}` };
	const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(call.external_id)}/recordings`, { headers: h, signal: AbortSignal.timeout(20_000) });
	if (!res.ok) return { ok: false, error: `zoom recordings ${res.status}` };
	const rec = (await res.json()) as { share_url?: string; duration?: number; recording_files?: { file_type: string; download_url: string; recording_type?: string }[] };
	const files = rec.recording_files ?? [];
	const vtt = files.find((f) => f.file_type === 'TRANSCRIPT' || f.recording_type === 'audio_transcript');
	const media = files.find((f) => f.file_type === 'MP4') ?? files.find((f) => f.file_type === 'M4A');
	let transcript: string | null = null;
	if (vtt) {
		const t = await fetch(`${vtt.download_url}?access_token=${token}`, { signal: AbortSignal.timeout(60_000) });
		if (t.ok) transcript = vttToText(await t.text());
	}
	await db
		.from('rev_calls')
		.update({ recording_url: rec.share_url ?? media?.download_url ?? null, transcript_md: transcript ?? call.transcript_md, duration_sec: rec.duration ? rec.duration * 60 : undefined, status: transcript ? 'transcribed' : 'recorded' })
		.eq('id', callId);
	return { ok: true, transcript: !!transcript };
}

export function vttToText(vtt: string): string {
	return vtt
		.split(/\r?\n/)
		.filter((l) => l && !/^WEBVTT/.test(l) && !/^\d+$/.test(l) && !/-->/.test(l))
		.join('\n')
		.replace(/\n{2,}/g, '\n');
}

/** Cron: analyze transcribed calls, pull zoom recordings for scheduled zoom calls past their time, brief upcoming calls. */
export async function advanceCalls(db: Db): Promise<{ pulled: number; analyzed: number; briefed: number; errors: string[] }> {
	const out = { pulled: 0, analyzed: 0, briefed: 0, errors: [] as string[] };
	if (zoomConfigured()) {
		const { data: due } = await db.from('rev_calls').select('id').eq('source', 'zoom').eq('status', 'scheduled').not('external_id', 'is', null).lt('scheduled_at', new Date(Date.now() - 30 * 60_000).toISOString()).limit(10);
		for (const c of (due ?? []) as { id: string }[]) {
			const r = await pullZoomRecording(db, c.id);
			if (r.ok) out.pulled++;
			else out.errors.push(`${c.id}: ${r.error}`);
		}
	}
	const { data: ready } = await db.from('rev_calls').select('id').eq('status', 'transcribed').limit(5);
	for (const c of (ready ?? []) as { id: string }[]) {
		const r = await analyzeCall(db, c.id);
		if (r.ok) out.analyzed++;
		else out.errors.push(`${c.id}: ${r.error}`);
	}
	// briefs for calls in the next 24h that have none yet
	const { data: upcoming } = await db.from('rev_calls').select('id, deal_id, owner_id').eq('status', 'scheduled').not('deal_id', 'is', null).gt('scheduled_at', new Date().toISOString()).lt('scheduled_at', new Date(Date.now() + 24 * 3600_000).toISOString()).limit(5);
	for (const c of (upcoming ?? []) as { id: string; deal_id: string; owner_id: string | null }[]) {
		const { count } = await db.from('rev_briefs').select('id', { count: 'exact', head: true }).eq('call_id', c.id);
		if (count) continue;
		const r = await buildBrief(db, c.deal_id, { callId: c.id, forUserId: c.owner_id });
		if ('error' in r) {
			out.errors.push(`${c.id}: ${r.error}`);
			continue;
		}
		out.briefed++;
		if (c.owner_id) {
			await db.from('notifications').upsert(
				{ user_id: c.owner_id, kind: 'revenue', title: 'Pre-call brief ready', body: r.body_md.slice(0, 300), href: `/prospects/deals/${c.deal_id}?tab=calls`, dedupe_key: `rev:brief:${c.id}` },
				{ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
			);
			await db.from('rev_briefs').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
		}
	}
	return out;
}
