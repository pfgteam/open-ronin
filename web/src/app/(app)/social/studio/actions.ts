'use server';

// Server actions for the Content Studio (WIP_BUILD_PLAN.md module 2).
//
// Every enqueue goes through enqueueContentJob (lib/providers/enqueue.ts) so
// the Zod validation, the cost estimate and the daily cap refusal read the
// same as the MCP generate_content tool. Jobs are inserted with the service
// role after the session is checked (0065: sessions may insert their own UI
// rows too, but the chain steps need parent ids the trigger sees at once).
// Run now / cancel / retry use the same service role path the cron uses.

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { enqueueContentJob } from '@/lib/providers/enqueue';
import { CONTENT_BUCKET, runJobNow } from '@/lib/providers/advance';
import { getAdapter } from '@/lib/providers/registry';
import type { ActionResult, Brief } from '@/lib/content-studio/shared';
import { AVATAR_PROVIDERS, LENGTHS, THUMBNAIL_PRESETS } from '@/lib/content-studio/shared';

const STUDIO = '/social/studio';
const WORK_BUCKET = 'work-item-attachments';

async function requireUser(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { ok: false, error: 'You are signed out. Sign in again and retry.' };
	return { ok: true, userId: user.id };
}

function refresh(...paths: string[]) {
	for (const p of new Set([STUDIO, `${STUDIO}/jobs`, ...paths])) revalidatePath(p);
}

// ---------------------------------------------------------------- briefs

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(''), z.undefined()]).transform((v) => (v ? v : null));

const briefSchema = z.object({
	clientId: optionalUuid,
	goal: z.string().trim().min(3).max(1000),
	platform: z.string().trim().min(1).max(60),
	length: z.string().trim().min(1).max(20),
	tone: z.string().trim().min(1).max(60),
	hookStyle: z.string().trim().min(1).max(60),
});

interface ClientContext {
	name: string;
	messageHouse: string;
	keywords: string[];
}

/**
 * The client's message house and approved claims (client_meta narrative
 * columns and client_keywords), trimmed so the prompt stays under the 4000
 * character system limit in schema.ts.
 */
async function clientContext(clientId: string | null): Promise<ClientContext | null> {
	if (!clientId) return null;
	const supabase = await createClient();
	const [{ data: client }, { data: meta }, { data: keywords }] = await Promise.all([
		supabase.from('clients_v2').select('display_name').eq('id', clientId).maybeSingle<{ display_name: string }>(),
		supabase
			.from('client_meta')
			.select('context_md, story_md, pr_goals_md')
			.eq('id', clientId)
			.maybeSingle<{ context_md: string | null; story_md: string | null; pr_goals_md: string | null }>(),
		supabase.from('client_keywords').select('keyword').eq('client_id', clientId).limit(25),
	]);
	if (!client) return null;
	const house = [meta?.context_md, meta?.story_md, meta?.pr_goals_md]
		.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
		.join('\n\n')
		.slice(0, 2400);
	return {
		name: client.display_name,
		messageHouse: house,
		keywords: ((keywords ?? []) as { keyword: string }[]).map((k) => k.keyword).filter(Boolean),
	};
}

function systemFor(ctx: ClientContext | null, role: string): string {
	const parts = [`You are a senior PR content writer at Open Ronin. ${role}`];
	if (ctx) {
		parts.push(`Client: ${ctx.name}.`);
		if (ctx.messageHouse) parts.push(`Message house and approved claims (use only claims found here; never invent facts or numbers):\n${ctx.messageHouse}`);
		if (ctx.keywords.length) parts.push(`Keywords to favour: ${ctx.keywords.join(', ')}.`);
	} else {
		parts.push('No client context was supplied; do not invent client facts, names or numbers.');
	}
	return parts.join('\n\n').slice(0, 4000);
}

function lengthLabel(v: string): string {
	return LENGTHS.find((l) => l.value === v)?.label ?? v;
}

export async function generateScript(provider: string, raw: Brief): Promise<ActionResult<{ jobId: string; costUsd: number }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = briefSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the brief.' };
	const b = parsed.data;
	const ctx = await clientContext(b.clientId);
	const prompt = [
		`Write a ${lengthLabel(b.length)} ${b.platform} script.`,
		`Goal: ${b.goal}`,
		`Tone: ${b.tone}. Open with a ${b.hookStyle.toLowerCase()} hook.`,
		'Format: HOOK, then the body in short spoken lines, then a one line CTA. Mark on-screen text in [brackets]. No preamble, no explanation after the script.',
	].join('\n');
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, {
		provider,
		input: { capability: 'generate_text', prompt, system: systemFor(ctx, 'You write scripts people read aloud on camera.'), maxTokens: 1500 },
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: b.clientId,
	});
	if (!res.ok) return { ok: false, error: res.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'studio.script', diff: { provider, platform: b.platform } });
	void runJobNow(db, res.jobId, 40_000).catch((e) => console.error('[content-studio] script run failed:', e));
	refresh(`${STUDIO}/scripts`);
	return { ok: true, jobId: res.jobId, costUsd: res.costUsd };
}

export async function generateHeadlines(provider: string, raw: Brief, count: number): Promise<ActionResult<{ jobId: string; costUsd: number }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = briefSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the brief.' };
	const n = Math.min(20, Math.max(10, Math.round(Number(count) || 12)));
	const b = parsed.data;
	const ctx = await clientContext(b.clientId);
	const prompt = [
		`Write ${n} headline and hook options for ${b.platform}.`,
		`Goal: ${b.goal}`,
		`Tone: ${b.tone}. Lean on the ${b.hookStyle.toLowerCase()} style but vary the angle.`,
		'Each under 120 characters. Return one per line, numbered, nothing else.',
	].join('\n');
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, {
		provider,
		input: { capability: 'generate_text', prompt, system: systemFor(ctx, 'You write scroll-stopping hooks and headlines.'), maxTokens: 1200 },
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: b.clientId,
	});
	if (!res.ok) return { ok: false, error: res.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'studio.headlines', diff: { provider, count: n } });
	void runJobNow(db, res.jobId, 40_000).catch((e) => console.error('[content-studio] headlines run failed:', e));
	refresh(`${STUDIO}/headlines`);
	return { ok: true, jobId: res.jobId, costUsd: res.costUsd };
}

// ---------------------------------------------------------------- hook library (0093)

export async function saveHook(hookText: string, clientId?: string | null): Promise<ActionResult<{ id: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const text = hookText.trim();
	if (text.length < 1 || text.length > 500) return { ok: false, error: 'A hook is 1 to 500 characters.' };
	const client = optionalUuid.safeParse(clientId ?? '');
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('hook_library')
		.insert({ hook_text: text, saved_by: me.userId, client_id: client.success ? client.data : null })
		.select('id')
		.single<{ id: string }>();
	if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the hook.' };
	refresh(`${STUDIO}/headlines`);
	return { ok: true, id: data.id };
}

export async function deleteHook(id: string): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const supabase = await createClient();
	const { error } = await supabase.from('hook_library').delete().eq('id', id);
	if (error) return { ok: false, error: error.message };
	refresh(`${STUDIO}/headlines`);
	return { ok: true };
}

// ---------------------------------------------------------------- images and thumbnails

const imageSchema = z.object({
	prompt: z.string().trim().min(3).max(3000),
	size: z.string().regex(/^\d{2,4}x\d{2,4}$/),
	style: z.string().trim().max(80).optional(),
	count: z.number().int().min(1).max(4).default(1),
	clientId: optionalUuid,
});

export async function generateImages(provider: string, raw: z.input<typeof imageSchema>): Promise<ActionResult<{ jobId: string; costUsd: number }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = imageSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the prompt.' };
	const { prompt, size, style, count, clientId } = parsed.data;
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, {
		provider,
		input: { capability: 'generate_image', prompt, size, count, style: style || undefined },
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId,
	});
	if (!res.ok) return { ok: false, error: res.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'studio.image', diff: { provider, size, count } });
	void runJobNow(db, res.jobId, 40_000).catch((e) => console.error('[content-studio] image run failed:', e));
	refresh(`${STUDIO}/images`, `${STUDIO}/thumbnails`);
	return { ok: true, jobId: res.jobId, costUsd: res.costUsd };
}

export async function editImage(provider: string, imagePath: string, prompt: string, size?: string): Promise<ActionResult<{ jobId: string; costUsd: number }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const p = prompt.trim();
	if (p.length < 3) return { ok: false, error: 'Describe the edit.' };
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, {
		provider,
		input: { capability: 'edit_image', prompt: p, imagePath, size: size && /^\d{2,4}x\d{2,4}$/.test(size) ? size : undefined },
		requestedBy: me.userId,
		requestedVia: 'ui',
	});
	if (!res.ok) return { ok: false, error: res.message };
	void runJobNow(db, res.jobId, 40_000).catch((e) => console.error('[content-studio] edit run failed:', e));
	refresh(`${STUDIO}/images`);
	return { ok: true, jobId: res.jobId, costUsd: res.costUsd };
}

const thumbnailSchema = z.object({
	title: z.string().trim().min(2).max(120),
	preset: z.string().trim().min(1).max(40),
	size: z.string().regex(/^\d{2,4}x\d{2,4}$/),
	subject: z.string().trim().max(500).optional(),
	clientId: optionalUuid,
	brand: z.object({ primaryColor: z.string().max(9), accentColor: z.string().max(9), name: z.string().max(120) }),
});

export async function generateThumbnail(provider: string, raw: z.input<typeof thumbnailSchema>): Promise<ActionResult<{ jobId: string; costUsd: number }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = thumbnailSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the title.' };
	const t = parsed.data;
	const preset = THUMBNAIL_PRESETS.find((p) => p.value === t.preset) ?? THUMBNAIL_PRESETS[0];
	const brandLine = preset.value === 'plain' ? '' : ` Brand palette: primary ${t.brand.primaryColor}, accent ${t.brand.accentColor} (${t.brand.name}).`;
	const prompt = `Thumbnail with the title text "${t.title}" rendered large and legible. ${preset.prompt}.${brandLine}${t.subject ? ` Subject: ${t.subject}.` : ''} No watermarks, no extra words beyond the title.`;
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, {
		provider,
		input: { capability: 'generate_image', prompt, size: t.size, count: 1, style: preset.value },
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: t.clientId,
	});
	if (!res.ok) return { ok: false, error: res.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'studio.thumbnail', diff: { provider, preset: preset.value, size: t.size } });
	void runJobNow(db, res.jobId, 40_000).catch((e) => console.error('[content-studio] thumbnail run failed:', e));
	refresh(`${STUDIO}/thumbnails`);
	return { ok: true, jobId: res.jobId, costUsd: res.costUsd };
}

// ---------------------------------------------------------------- video chain

const videoChainSchema = z.object({
	script: z.string().trim().min(10).max(8000),
	voiceProvider: z.string().trim().min(1),
	voiceId: z.string().trim().max(120).optional(),
	videoProvider: z.string().trim().min(1),
	aspect: z.enum(['16:9', '9:16', '1:1']),
	durationSeconds: z.number().int().min(1).max(60),
	scriptJobId: z.union([uuid, z.literal(''), z.undefined()]).transform((v) => (v ? v : null)),
	clientId: optionalUuid,
});

/**
 * Script -> voice -> video as three content_jobs rows linked by
 * parent_job_id. The script step is the Scripts page job when the person
 * picked one (its id becomes the voice job's parent); a typed script is
 * recorded as a done generate_text row so the chain always has three steps.
 * The video step is inserted queued with the voice job as its parent and
 * the 0065 advance loop takes both: avatar providers lipsync the script
 * directly and generative providers take the script as their prompt, so
 * the voice asset is a sibling deliverable rather than a hard input of the
 * video step. No new columns, no new engine.
 */
export async function startVideoChain(raw: z.input<typeof videoChainSchema>): Promise<ActionResult<{ scriptJobId: string; voiceJobId: string; videoJobId: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = videoChainSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the chain.' };
	const v = parsed.data;
	const voice = getAdapter(v.voiceProvider);
	const video = getAdapter(v.videoProvider);
	if (!voice?.spec.capabilities.includes('generate_voice')) return { ok: false, error: 'Pick a voice provider.' };
	const isAvatar = (AVATAR_PROVIDERS as readonly string[]).includes(v.videoProvider);
	if (!video || !video.spec.capabilities.includes(isAvatar ? 'lipsync_avatar' : 'generate_video')) return { ok: false, error: 'Pick a video provider.' };

	const db = createServiceRoleClient();

	// Step 1: the script job. Reuse the Scripts page job, or record the typed
	// script as a finished text row so the card shows three steps.
	let scriptJobId = v.scriptJobId;
	if (scriptJobId) {
		const { data: parent } = await db.from('content_jobs').select('id, requested_by').eq('id', scriptJobId).maybeSingle<{ id: string; requested_by: string | null }>();
		if (!parent || parent.requested_by !== me.userId) return { ok: false, error: 'That script job is not yours or no longer exists.' };
	} else {
		const { data, error } = await db
			.from('content_jobs')
			.insert({
				capability: 'generate_text',
				provider: v.voiceProvider === 'openai' ? 'openai' : 'anthropic',
				input: { capability: 'generate_text', prompt: '[typed in Video Studio]' },
				output: { assets: [], text: v.script, providerMeta: { source: 'typed' } },
				status: 'done',
				cost_usd: 0,
				requested_by: me.userId,
				requested_via: 'ui',
				client_id: v.clientId,
				finished_at: new Date().toISOString(),
			})
			.select('id')
			.single<{ id: string }>();
		if (error || !data) return { ok: false, error: error?.message ?? 'Could not record the script.' };
		scriptJobId = data.id;
	}

	// Step 2: voice.
	const voiceRes = await enqueueContentJob(db, {
		provider: v.voiceProvider,
		input: { capability: 'generate_voice', text: v.script.slice(0, 4000), voiceId: v.voiceId || undefined },
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: v.clientId,
		parentJobId: scriptJobId,
	});
	if (!voiceRes.ok) return { ok: false, error: voiceRes.message };

	// Step 3: video, parented to the voice step.
	const videoInput = isAvatar
		? { capability: 'lipsync_avatar' as const, script: v.script, voiceId: v.voiceId || undefined, aspect: v.aspect }
		: { capability: 'generate_video' as const, script: v.script, prompt: v.script.slice(0, 2000), durationSeconds: v.durationSeconds, aspect: v.aspect };
	const videoRes = await enqueueContentJob(db, {
		provider: v.videoProvider,
		input: videoInput,
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: v.clientId,
		parentJobId: voiceRes.jobId,
	});
	if (!videoRes.ok) {
		await db.from('content_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString(), error: `Video step refused: ${videoRes.message}` }).eq('id', voiceRes.jobId);
		return { ok: false, error: videoRes.message };
	}

	await recordAudit({
		actor_id: me.userId,
		entity_kind: 'supabase',
		entity_ref: `content_jobs/${videoRes.jobId}`,
		action: 'studio.video_chain',
		diff: { scriptJobId, voiceJobId: voiceRes.jobId, voice: v.voiceProvider, video: v.videoProvider, aspect: v.aspect },
	});
	// Kick the voice step now; the video step is advanced by the cron (and
	// by Run now on the card) because generative video takes minutes.
	void runJobNow(db, voiceRes.jobId, 40_000).catch((e) => console.error('[content-studio] voice run failed:', e));
	refresh(`${STUDIO}/video`);
	return { ok: true, scriptJobId, voiceJobId: voiceRes.jobId, videoJobId: videoRes.jobId };
}

// ---------------------------------------------------------------- clips

const clipSchema = z.object({
	provider: z.enum(['opusclip', 'descript']),
	videoUrl: z.string().url().max(2000),
	maxClips: z.number().int().min(1).max(20).default(5),
	instructions: z.string().trim().max(2000).optional(),
	sourceLabel: z.string().trim().max(200).optional(),
	clientId: optionalUuid,
});

export async function requestClips(raw: z.input<typeof clipSchema>): Promise<ActionResult<{ jobId: string; costUsd: number }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const parsed = clipSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the video link.' };
	const c = parsed.data;
	const input =
		c.provider === 'opusclip'
			? { capability: 'clip_video' as const, videoUrl: c.videoUrl, maxClips: c.maxClips }
			: { capability: 'edit_video' as const, videoUrl: c.videoUrl, instructions: c.instructions || `Cut ${c.maxClips} short clips with captions.` };
	const db = createServiceRoleClient();
	const res = await enqueueContentJob(db, { provider: c.provider, input, requestedBy: me.userId, requestedVia: 'ui', clientId: c.clientId });
	if (!res.ok) return { ok: false, error: res.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'studio.clips', diff: { provider: c.provider, source: c.sourceLabel ?? null } });
	void runJobNow(db, res.jobId, 20_000).catch((e) => console.error('[content-studio] clips run failed:', e));
	refresh(`${STUDIO}/clips`);
	return { ok: true, jobId: res.jobId, costUsd: res.costUsd };
}

/** Upload a source video into the content bucket and return a 24 hour signed URL for the vendor. */
export async function uploadSourceVideo(formData: FormData): Promise<ActionResult<{ url: string; path: string; name: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const file = formData.get('file');
	if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Pick a video file.' };
	if (file.size > 500 * 1024 * 1024) return { ok: false, error: 'Videos over 500 MB are not supported here; paste a link instead.' };
	const safe = file.name.replace(/[^\w.\-]+/g, '_');
	const path = `uploads/${me.userId}/${randomUUID()}-${safe}`;
	const supabase = await createClient();
	const { error } = await supabase.storage.from(CONTENT_BUCKET).upload(path, file, { contentType: file.type || 'video/mp4' });
	if (error) return { ok: false, error: error.message };
	const db = createServiceRoleClient();
	const { data } = await db.storage.from(CONTENT_BUCKET).createSignedUrl(path, 24 * 3600);
	if (!data?.signedUrl) return { ok: false, error: 'Uploaded, but could not sign a link for the vendor.' };
	return { ok: true, url: data.signedUrl, path, name: file.name };
}

// ---------------------------------------------------------------- jobs

export async function runNowAction(jobId: string): Promise<ActionResult<{ status: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const id = uuid.safeParse(jobId);
	if (!id.success) return { ok: false, error: 'Bad job id.' };
	const db = createServiceRoleClient();
	const res = await runJobNow(db, id.data, 40_000);
	refresh();
	if (res.status === 'missing') return { ok: false, error: 'Job not found.' };
	return { ok: true, status: res.status };
}

export async function cancelJobAction(jobId: string): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const id = uuid.safeParse(jobId);
	if (!id.success) return { ok: false, error: 'Bad job id.' };
	const db = createServiceRoleClient();
	const { error } = await db
		.from('content_jobs')
		.update({ status: 'cancelled', finished_at: new Date().toISOString() })
		.eq('id', id.data)
		.in('status', ['queued', 'submitted', 'running']);
	if (error) return { ok: false, error: error.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${id.data}`, action: 'content_job.cancel' });
	refresh();
	return { ok: true };
}

/** Retry = a fresh row with the same provider and input, parented like the original. */
export async function retryJobAction(jobId: string): Promise<ActionResult<{ jobId: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const id = uuid.safeParse(jobId);
	if (!id.success) return { ok: false, error: 'Bad job id.' };
	const db = createServiceRoleClient();
	const { data: job } = await db
		.from('content_jobs')
		.select('provider, input, client_id, work_item_id, parent_job_id, status')
		.eq('id', id.data)
		.maybeSingle<{ provider: string; input: unknown; client_id: string | null; work_item_id: string | null; parent_job_id: string | null; status: string }>();
	if (!job) return { ok: false, error: 'Job not found.' };
	if (job.status !== 'failed' && job.status !== 'cancelled') return { ok: false, error: 'Only failed or cancelled jobs can be retried.' };
	const res = await enqueueContentJob(db, {
		provider: job.provider,
		input: job.input,
		requestedBy: me.userId,
		requestedVia: 'ui',
		clientId: job.client_id,
		workItemId: job.work_item_id,
		parentJobId: job.parent_job_id,
	});
	if (!res.ok) return { ok: false, error: res.message };
	await recordAudit({ actor_id: me.userId, entity_kind: 'supabase', entity_ref: `content_jobs/${res.jobId}`, action: 'content_job.retry', diff: { of: id.data } });
	void runJobNow(db, res.jobId, 30_000).catch((e) => console.error('[content-studio] retry run failed:', e));
	refresh();
	return { ok: true, jobId: res.jobId };
}

// ---------------------------------------------------------------- attach to a task (0022)

/**
 * Copy a content asset into the work-item-attachments bucket and record the
 * 0022 row, so the task's Attachments panel lists it like any upload. The
 * copy keeps the studio bucket private and lets the attachment outlive a
 * later cleanup of content_assets.
 */
export async function attachAssetToWorkItem(assetId: string, workItemId: string): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const a = uuid.safeParse(assetId);
	const w = uuid.safeParse(workItemId);
	if (!a.success || !w.success) return { ok: false, error: 'Pick a task.' };
	const supabase = await createClient();
	// Session read: RLS proves the viewer may see this asset.
	const { data: asset } = await supabase
		.from('content_assets')
		.select('storage_path, mime, bytes, label')
		.eq('id', a.data)
		.maybeSingle<{ storage_path: string; mime: string; bytes: number | null; label: string | null }>();
	if (!asset) return { ok: false, error: 'Asset not found.' };
	const fileName = asset.label?.trim() || asset.storage_path.split('/').pop() || 'asset';
	const dest = `${w.data}/${randomUUID()}-${fileName.replace(/[^\w.\-]+/g, '_')}`;
	const db = createServiceRoleClient();
	const { error: copyError } = await db.storage.from(CONTENT_BUCKET).copy(asset.storage_path, dest, { destinationBucket: WORK_BUCKET });
	if (copyError) return { ok: false, error: `Could not copy the file: ${copyError.message}` };
	const { error } = await supabase.from('work_item_attachments').insert({
		work_item_id: w.data,
		storage_path: dest,
		file_name: fileName,
		file_size: asset.bytes,
		content_type: asset.mime,
		uploaded_by: me.userId,
	});
	if (error) {
		await db.storage.from(WORK_BUCKET).remove([dest]);
		return { ok: false, error: error.message };
	}
	revalidatePath(`/the-work/${w.data}`);
	return { ok: true };
}

/** Attach a script (text) to a task as a .txt file, same 0022 path. */
export async function attachTextToWorkItem(workItemId: string, title: string, text: string): Promise<ActionResult> {
	const me = await requireUser();
	if (!me.ok) return me;
	const w = uuid.safeParse(workItemId);
	if (!w.success) return { ok: false, error: 'Pick a task.' };
	const body = text.trim();
	if (!body) return { ok: false, error: 'Nothing to attach.' };
	const fileName = `${(title.trim() || 'script').replace(/[^\w.\- ]+/g, '').slice(0, 60) || 'script'}.txt`;
	const dest = `${w.data}/${randomUUID()}-${fileName.replace(/\s+/g, '_')}`;
	const supabase = await createClient();
	const bytes = new TextEncoder().encode(body);
	const { error: upErr } = await supabase.storage.from(WORK_BUCKET).upload(dest, bytes, { contentType: 'text/plain; charset=utf-8' });
	if (upErr) return { ok: false, error: upErr.message };
	const { error } = await supabase.from('work_item_attachments').insert({
		work_item_id: w.data,
		storage_path: dest,
		file_name: fileName,
		file_size: bytes.byteLength,
		content_type: 'text/plain',
		uploaded_by: me.userId,
	});
	if (error) {
		await supabase.storage.from(WORK_BUCKET).remove([dest]);
		return { ok: false, error: error.message };
	}
	revalidatePath(`/the-work/${w.data}`);
	return { ok: true };
}

/** Create a task in The Work with the script attached, in one step. */
export async function createTaskWithScript(name: string, clientId: string | null, text: string): Promise<ActionResult<{ workItemId: string }>> {
	const me = await requireUser();
	if (!me.ok) return me;
	const taskName = name.trim().slice(0, 200);
	if (!taskName) return { ok: false, error: 'Give the task a name.' };
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('projects')
		.insert({ name: taskName, kind: clientId ? 'client' : 'internal', status: 'planned', owner_id: me.userId, created_by: me.userId, description_md: 'Created from the Content Studio.' })
		.select('id')
		.single<{ id: string }>();
	if (error || !data) return { ok: false, error: error?.message ?? 'Could not create the task.' };
	const attached = await attachTextToWorkItem(data.id, taskName, text);
	if (!attached.ok) return attached;
	revalidatePath('/the-work');
	return { ok: true, workItemId: data.id };
}
