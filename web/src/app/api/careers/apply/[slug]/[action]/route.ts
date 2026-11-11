// Candidate application API (0130). All routes are signed-out (candidates
// have no account): the session token from /start is the credential for
// /save, /upload, /submit, /followup. Service role inside; rate limited per
// ip; the SQL (hire_submit_application) does the dedupe and the signals.
//
//   POST /api/careers/apply/[slug]/start    { link_code?, consent_version } -> { token, config, position }
//   POST /api/careers/apply/[slug]/save     { token, answers, max_section }   -> { ok }
//   POST /api/careers/apply/[slug]/upload   multipart: token, kind, file     -> { path }
//   POST /api/careers/apply/[slug]/submit   { token, answers }               -> { application_id, honeypots }
//   POST /api/careers/apply/[slug]/followup { token, text }                  -> { ok }

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { loadOpenPosition } from '@/lib/hiring/server';
import { aiTextHeuristic, allQuestions, honeypotHits, isEmptyConfig, isVideoLink, toE164, validateSection, type AnswerMap, type ApplicationConfig } from '@/lib/hiring/application';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, number[]>();
function limited(ip: string, max: number): boolean {
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	list.push(now);
	hits.set(ip, list);
	return list.length > max;
}
function ipOf(request: Request) {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
function fingerprint(ip: string, ua: string) {
	return createHash('sha256').update(`${ip}|${ua}|${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 40);
}
function ipHash(ip: string) {
	return createHash('sha256').update(`${ip}:${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 32);
}
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const TOKEN_RE = /^[0-9a-f]{32}$/;
const ALLOWED_MIME: Record<string, string[]> = {
	resume: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	video: ['video/webm', 'video/mp4', 'video/quicktime'],
	portfolio: ['application/pdf', 'image/png', 'image/jpeg'],
	other: ['application/pdf', 'image/png', 'image/jpeg'],
};
const MAX_BYTES: Record<string, number> = { resume: 10 * 1024 * 1024, video: 100 * 1024 * 1024, portfolio: 10 * 1024 * 1024, other: 10 * 1024 * 1024 };

export async function POST(request: Request, ctx: { params: Promise<{ slug: string; action: string }> }) {
	const { slug, action } = await ctx.params;
	if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) return bad('Unknown role.', 404);
	const ip = ipOf(request);
	if (limited(ip, action === 'save' ? 400 : 40)) return bad('Too many requests. Try again in a few minutes.', 429);
	const svc = createServiceRoleClient();
	const position = await loadOpenPosition(svc, slug);
	if (!position) return bad('This role is not accepting applications.', 404);
	const ua = request.headers.get('user-agent') ?? '';

	if (action === 'start') {
		let b: Record<string, unknown> = {};
		try {
			b = (await request.json()) as Record<string, unknown>;
		} catch {
			/* empty body ok */
		}
		const linkCode = typeof b.link_code === 'string' && /^[a-z0-9][a-z0-9-]{3,40}$/.test(b.link_code) ? b.link_code : null;
		const [{ data: full }, { data: consentRow }, { data: defaultRow }] = await Promise.all([
			svc.from('hire_positions').select('application_config, consent_version').eq('id', position.id).maybeSingle(),
			svc.from('hire_settings').select('value').eq('key', 'consent').maybeSingle(),
			svc.from('hire_settings').select('value').eq('key', 'application_default').maybeSingle(),
		]);
		const row = full as { application_config: ApplicationConfig; consent_version: number } | null;
		const config = row && !isEmptyConfig(row.application_config) ? row.application_config : ((defaultRow as { value: ApplicationConfig } | null)?.value ?? { version: 2, sections: [] });
		const consent = ((consentRow as { value?: { version?: number; title?: string; body_md?: string } } | null)?.value ?? {}) as { version?: number; title?: string; body_md?: string };
		const { data: session, error } = await svc
			.from('hire_application_sessions')
			.insert({ position_id: position.id, fingerprint: fingerprint(ip, ua), ip_hash: ipHash(ip), user_agent: ua.slice(0, 300), link_code: linkCode, consent_version: consent.version ?? 1 })
			.select('token')
			.single();
		if (error) return bad('Could not start the application. Try again.', 500);
		return NextResponse.json({ token: (session as { token: string }).token, config, consent: { version: consent.version ?? 1, title: consent.title ?? 'Before you apply', body_md: consent.body_md ?? '' }, position: { title: position.title, slug: position.slug, brand: position.brand } });
	}

	if (action === 'upload') {
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return bad('Expected multipart form data.');
		}
		const token = String(form.get('token') ?? '');
		const kind = String(form.get('kind') ?? 'other');
		const file = form.get('file');
		if (!TOKEN_RE.test(token)) return bad('Invalid session.', 401);
		if (!(file instanceof File)) return bad('No file.');
		if (!ALLOWED_MIME[kind]) return bad('Unknown file kind.');
		if (!ALLOWED_MIME[kind].includes(file.type)) return bad(`Unsupported type ${file.type || '(unknown)'}. ${kind === 'resume' ? 'Upload a PDF or Word file.' : kind === 'video' ? 'Upload webm / mp4 / mov.' : 'PDF, PNG or JPEG.'}`);
		if (file.size > MAX_BYTES[kind]) return bad(`File too large (max ${Math.round(MAX_BYTES[kind] / 1048576)} MB).`);
		const { data: session } = await svc.from('hire_application_sessions').select('id, submitted_at').eq('token', token).eq('position_id', position.id).maybeSingle();
		if (!session) return bad('Invalid session.', 401);
		const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
		const path = `sessions/${token}/${kind}-${Date.now()}.${ext}`;
		const buf = Buffer.from(await file.arrayBuffer());
		const { error } = await svc.storage.from('hiring-uploads').upload(path, buf, { contentType: file.type, upsert: false });
		if (error) return bad(`Upload failed: ${error.message}`, 500);
		await svc.from('hire_application_files').insert({ kind, path, mime: file.type, size_bytes: file.size, original_name: file.name.slice(0, 200) });
		return NextResponse.json({ ok: true, path });
	}

	let b: Record<string, unknown>;
	try {
		b = (await request.json()) as Record<string, unknown>;
	} catch {
		return bad('Body must be JSON.');
	}
	const token = typeof b.token === 'string' ? b.token : '';
	if (!TOKEN_RE.test(token)) return bad('Invalid session.', 401);
	const { data: sessionRow } = await svc.from('hire_application_sessions').select('id, submitted_at, consent_version').eq('token', token).eq('position_id', position.id).maybeSingle();
	const session = sessionRow as { id: string; submitted_at: string | null; consent_version: number | null } | null;
	if (!session) return bad('Invalid session.', 401);

	if (action === 'save') {
		if (session.submitted_at) return NextResponse.json({ ok: true, submitted: true });
		const answers = (b.answers && typeof b.answers === 'object' ? b.answers : {}) as AnswerMap;
		const emailKey = typeof answers.email?.value === 'string' ? answers.email.value.trim().toLowerCase().slice(0, 200) : null;
		const patch: Record<string, unknown> = { answers, max_section: Math.max(0, Math.min(50, Number(b.max_section ?? 0) || 0)), last_active_at: new Date().toISOString() };
		if (emailKey && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailKey)) patch.email_key = emailKey;
		if (b.consented === true) patch.consented_at = new Date().toISOString();
		await svc.from('hire_application_sessions').update(patch).eq('id', session.id);
		return NextResponse.json({ ok: true });
	}

	if (action === 'followup') {
		const text = typeof b.text === 'string' ? b.text.trim().slice(0, 4000) : '';
		if (!text) return bad('Say something.');
		const { data } = await svc.rpc('hire_honeypot_followup', { p_session_token: token, p_text: text });
		return NextResponse.json({ ok: !!data });
	}

	if (action === 'submit') {
		if (session.submitted_at) {
			const { data: s } = await svc.from('hire_application_sessions').select('application_id').eq('id', session.id).maybeSingle();
			return NextResponse.json({ ok: true, already: true, application_id: (s as { application_id: string | null } | null)?.application_id });
		}
		const answers = (b.answers && typeof b.answers === 'object' ? b.answers : {}) as AnswerMap;
		const { data: full } = await svc.from('hire_positions').select('application_config').eq('id', position.id).maybeSingle();
		let config = (full as { application_config: ApplicationConfig } | null)?.application_config;
		if (!config || isEmptyConfig(config)) config = ((await svc.from('hire_settings').select('value').eq('key', 'application_default').maybeSingle()).data as { value: ApplicationConfig } | null)?.value ?? { version: 2, sections: [] };
		// server-side validation of every section
		for (const section of config.sections) {
			const errs = validateSection(section, answers);
			if (Object.keys(errs).length) return NextResponse.json({ error: 'Some answers are missing or invalid.', errors: errs, section: section.key }, { status: 422 });
		}
		// files referenced must belong to this session
		for (const q of allQuestions(config)) {
			if (q.type === 'file' && typeof answers[q.key]?.value === 'string' && !(answers[q.key].value as string).startsWith(`sessions/${token}/`)) return bad('File reference invalid.');
			if (q.type === 'video' && typeof answers[q.key]?.value === 'string') {
				const v = answers[q.key].value as string;
				if (!v.startsWith(`sessions/${token}/`) && !isVideoLink(v)) return NextResponse.json({ error: 'Video must be a recording or a Loom / YouTube / Vimeo / Drive link.', errors: { [q.key]: 'Record or paste a valid video link.' } }, { status: 422 });
			}
		}
		const str = (k: string) => (typeof answers[k]?.value === 'string' ? (answers[k].value as string).trim() : '');
		const videoAnswer = allQuestions(config).find((q) => q.type === 'video');
		const videoVal = videoAnswer ? str(videoAnswer.key) : '';
		const contact = {
			full_name: str('full_name'),
			email: str('email'),
			phone: str('phone'),
			phone_e164: toE164(str('phone')),
			linkedin_url: str('linkedin_url') || null,
			location_text: str('location_text') || null,
			country: str('country') || null,
			timezone: str('timezone') || null,
			current_role: str('current_role') || null,
			portfolio_urls: str('portfolio_urls')
				.split(/\s+/)
				.filter((u) => /^https?:\/\//.test(u))
				.slice(0, 10),
			video_url: videoVal && !videoVal.startsWith('sessions/') ? videoVal : null,
		};
		if (!contact.full_name || !contact.email) return bad('Name and email are required.');
		// local AI-text heuristic on long answers (H4 adds the model score)
		const flagged: string[] = [];
		for (const q of allQuestions(config)) {
			if ((q.type === 'long_text' || q.type === 'timed_text') && typeof answers[q.key]?.value === 'string') {
				const s = aiTextHeuristic(answers[q.key].value as string);
				if (s >= 0.7) flagged.push(q.key);
			}
		}
		const { data, error } = await svc.rpc('hire_submit_application', { p_session_token: token, p_contact: contact, p_answers: answers, p_meta: { utm: b.utm ?? {}, ai_text_flags: flagged } });
		if (error) return bad(error.message.includes('not accepting') ? 'This role is no longer accepting applications.' : error.message.replace(/^.*?:\s*/, ''), 409);
		const r = data as { application_id: string; already: boolean; honeypot_hits?: number };
		if (flagged.length && !r.already) {
			await svc.from('hire_applications').update({ ai_text_flags: flagged.length }).eq('id', r.application_id);
			for (const key of flagged) await svc.from('hire_application_answers').update({ ai_text_score: aiTextHeuristic(String(answers[key]?.value ?? '')), ai_text_note: 'heuristic: low burstiness / LLM tells' }).eq('application_id', r.application_id).eq('question_key', key);
		}
		return NextResponse.json({ ok: true, already: r.already, application_id: r.application_id, honeypots: honeypotHits(config, answers) });
	}

	return bad('Unknown action.', 404);
}
