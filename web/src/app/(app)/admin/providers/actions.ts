'use server';

// Server actions for /admin/providers.
//
//   testProvider   runs the cheapest real call for the provider (a short
//                  sentence, one small image, a two second clip) as a real
//                  content_jobs row so the cap, the bucket and content_assets
//                  are exercised end to end. Video and avatar vendors get a
//                  key verification instead, because their smallest job
//                  costs real money and takes minutes.
//   setCap         changes a content_caps row; the 0065 trigger audits it.
//   runNow         advances the queue once, the Lead Scraper pattern.
//   cancelJob      cancels a queued job.
//
// Admin only, checked here and by RLS.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { advanceContentJobs, CONTENT_BUCKET, runJobNow } from '@/lib/providers/advance';
import { enqueueContentJob } from '@/lib/providers/enqueue';
import { cheapestTestInput, getAdapter } from '@/lib/providers/registry';
import type { Capability } from '@/lib/providers/types';

const PATH = '/admin/providers';

async function requireAdmin(): Promise<{ actorId: string }> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error('You are signed out. Sign in again and retry.');
	const { data: me } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
	if (!me || !me.is_active || !['admin', 'exec'].includes(me.role)) throw new Error('Only exec and admin accounts can use this page.');
	return { actorId: user.id };
}

export interface TestResult {
	ok: boolean;
	kind: 'verified' | 'text' | 'image' | 'audio' | 'stock' | 'error';
	detail: string;
	/** Signed URL for the produced asset, valid a few minutes. */
	url?: string;
	jobId?: string;
	costUsd?: number;
}

export async function testProvider(providerId: string): Promise<TestResult> {
	const { actorId } = await requireAdmin();
	const adapter = getAdapter(providerId);
	if (!adapter) return { ok: false, kind: 'error', detail: 'Unknown provider.' };
	if (!adapter.isConfigured()) {
		return { ok: false, kind: 'error', detail: `Ready, key not set. Add ${adapter.spec.envKeys.join(' and ')} in Vercel.` };
	}

	// Cheapest real call available for this adapter; otherwise verify the key.
	const order: Capability[] = ['generate_text', 'search_stock', 'generate_voice', 'generate_image'];
	const capability = order.find((c) => adapter.spec.capabilities.includes(c));
	const input = capability ? cheapestTestInput(capability) : null;

	if (!input) {
		if (!adapter.verify) return { ok: false, kind: 'error', detail: 'This provider has no cheap test call.' };
		try {
			const v = await adapter.verify();
			await recordAudit({ actor_id: actorId, entity_kind: 'supabase', entity_ref: `providers/${providerId}`, action: 'provider.verify', diff: v });
			return { ok: v.ok, kind: v.ok ? 'verified' : 'error', detail: v.ok ? `Key verified: ${v.detail}. No job was run; this vendor bills real money per render.` : v.detail };
		} catch (e) {
			return { ok: false, kind: 'error', detail: e instanceof Error ? e.message : String(e) };
		}
	}

	const db = createServiceRoleClient();
	const queued = await enqueueContentJob(db, { provider: providerId, input, requestedBy: actorId, requestedVia: 'ui' });
	if (!queued.ok) return { ok: false, kind: 'error', detail: queued.message };

	await recordAudit({ actor_id: actorId, entity_kind: 'supabase', entity_ref: `content_jobs/${queued.jobId}`, action: 'provider.test', diff: { provider: providerId, capability } });

	const done = await runJobNow(db, queued.jobId, 45_000);
	revalidatePath(PATH);
	if (done.status !== 'done') {
		return { ok: false, kind: 'error', detail: done.error ?? `Job is ${done.status}; the cron will finish it.`, jobId: queued.jobId };
	}
	const out = done.output;
	const first = out?.assets?.[0];
	let url: string | undefined;
	if (first?.path) {
		const { data } = await db.storage.from(CONTENT_BUCKET).createSignedUrl(first.path, 300);
		url = data?.signedUrl ?? undefined;
	}
	if (capability === 'generate_text') return { ok: true, kind: 'text', detail: (out?.text ?? '').slice(0, 300), jobId: queued.jobId, costUsd: queued.costUsd };
	if (capability === 'search_stock') {
		const results = (out?.providerMeta?.results as { image?: string; credit?: string }[] | undefined) ?? [];
		return { ok: true, kind: 'stock', detail: results[0]?.credit ? `Photo by ${results[0].credit}` : `${results.length} results`, url: results[0]?.image, jobId: queued.jobId, costUsd: 0 };
	}
	if (capability === 'generate_voice') return { ok: true, kind: 'audio', detail: 'Audio rendered.', url, jobId: queued.jobId, costUsd: queued.costUsd };
	return { ok: true, kind: 'image', detail: 'Image rendered and stored in the content bucket.', url, jobId: queued.jobId, costUsd: queued.costUsd };
}

const CapInput = z.object({
	scope: z.enum(['role', 'consumer']),
	key: z.string().trim().min(1).max(60),
	dailyUsd: z.coerce.number().min(0).max(10000),
});

export async function setCap(formData: FormData): Promise<void> {
	await requireAdmin();
	const parsed = CapInput.safeParse({ scope: formData.get('scope'), key: formData.get('key'), dailyUsd: formData.get('daily_usd') });
	if (!parsed.success) throw new Error('Invalid cap.');
	// The session client: RLS allows admin updates and the trigger audits with auth.uid().
	const supabase = await createClient();
	const { error } = await supabase
		.from('content_caps')
		.upsert({ scope: parsed.data.scope, key: parsed.data.key, daily_usd: parsed.data.dailyUsd }, { onConflict: 'scope,key' });
	if (error) throw new Error(`Could not save the cap: ${error.message}`);
	revalidatePath(PATH);
}

export async function runNow(): Promise<void> {
	await requireAdmin();
	await advanceContentJobs(createServiceRoleClient());
	revalidatePath(PATH);
}

export async function cancelJob(formData: FormData): Promise<void> {
	const { actorId } = await requireAdmin();
	const id = z.string().uuid().parse(formData.get('id'));
	const db = createServiceRoleClient();
	await db.from('content_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).in('status', ['queued', 'submitted', 'running']);
	await recordAudit({ actor_id: actorId, entity_kind: 'supabase', entity_ref: `content_jobs/${id}`, action: 'content_job.cancel' });
	revalidatePath(PATH);
}
