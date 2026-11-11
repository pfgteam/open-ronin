'use server';

// Server actions for /admin/bots. Two writes, both through 0112 security
// definer functions that re-check is_admin() first line (RLS has no write
// policies on these tables, so a direct insert would affect zero rows and
// report success — the function raises instead).
//
//   saveBot          bot_profile_upsert: store desired config + enqueue a
//                    provisioning request the fleet bridge applies. Does NOT
//                    touch the host itself (Vercel cannot); the row is
//                    'pending' until the bridge acks it.
//   setBotScopes     bot_set_consumer_scopes: MCP scopes on the bot's live
//                    consumer. This one IS immediate: mcp_consumers is
//                    Open Ronin-side state the MCP route reads on every call.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { SCOPES } from '@/lib/mcp/scopes';
import { BOT_NAME_RE, GRANTABLE_PRIVILEGED_TOOLSETS, TOOL_PROGRESS_MODES, toOps, type BotDesired } from '@/lib/bots/shared';

type Result = { ok: true; op?: string } | { ok: false; error: string };

const DesiredSchema = z.object({
	model: z.object({ provider: z.string().max(60).optional(), default: z.string().max(120).optional() }).optional(),
	tts: z.object({ provider: z.string().max(40).optional() }).optional(),
	terminal: z.object({ backend: z.string().max(40).optional() }).optional(),
	tools: z
		.object({
			toolsets: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(60).optional(),
			// Only the three grantable privileged toolsets may pass here — computer_use is never
			// accepted from this panel (toOps() would strip it anyway; refuse it earlier too).
			privileged_grants: z.array(z.enum(GRANTABLE_PRIVILEGED_TOOLSETS)).max(GRANTABLE_PRIVILEGED_TOOLSETS.length).optional(),
			justification: z.string().trim().max(600).optional(),
		})
		.refine((t) => !t.privileged_grants?.length || !!t.justification?.trim(), {
			message: 'A justification is required to grant a privileged toolset (code_execution, terminal, browser).',
		})
		.optional(),
	telemetry: z
		.object({ shared_metrics: z.object({ enabled: z.boolean().optional(), send: z.boolean().optional() }).optional() })
		.optional(),
	agent: z
		.object({
			max_turns: z.number().int().min(1).max(2000).optional(),
			tool_progress: z.enum(TOOL_PROGRESS_MODES).optional(),
			compression_threshold: z.number().min(0.5).max(0.95).optional(),
		})
		.optional(),
});

const SaveInput = z.object({
	name: z.string().regex(BOT_NAME_RE, 'lowercase letters, numbers, - or _, up to 64 characters'),
	displayName: z.string().trim().max(80).optional().default(''),
	role: z.string().trim().max(600).optional().default(''),
	soulMd: z.string().max(20000).optional(),
	desired: DesiredSchema,
});

type Gate = { supabase: Awaited<ReturnType<typeof createClient>>; actorId: string } | { error: string };

async function requireAdmin(): Promise<Gate> {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { error: 'You are signed out. Sign in again and retry.' };
	const { data: me } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
	if (!me || !me.is_active || !['admin', 'exec'].includes(me.role)) {
		return { error: 'Only exec and admin accounts can manage bots.' };
	}
	return { supabase, actorId: user.id };
}

export async function saveBot(input: {
	name: string;
	displayName?: string;
	role?: string;
	soulMd?: string;
	desired: BotDesired;
}): Promise<Result> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };
	const parsed = SaveInput.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid bot.' };
	const { name, displayName, role, soulMd, desired } = parsed.data;
	if (!desired.model?.provider || !desired.model?.default) return { ok: false, error: 'Provider and model are required.' };

	const ops = toOps(desired);
	const { data, error } = await gate.supabase.rpc('bot_profile_upsert', {
		p_name: name,
		p_display_name: displayName || null,
		p_role: role || null,
		p_desired: desired,
		p_ops: ops,
		p_soul_md: soulMd?.trim() ? soulMd : null,
	});
	if (error) {
		const notApplied = /bot_profile_upsert|does not exist|schema cache/i.test(error.message);
		return { ok: false, error: notApplied ? 'Migration 0112 (bot profiles) is not applied yet.' : error.message };
	}
	const op = (data as { op?: string } | null)?.op;
	await recordAudit({
		actor_id: gate.actorId,
		entity_kind: 'supabase',
		entity_ref: `bot_profiles/${name}`,
		action: op === 'create' ? 'bot.create_requested' : 'bot.update_requested',
		diff: { desired, ops: ops.map((o) => o.key) },
	});
	revalidatePath('/admin/bots');
	return { ok: true, op };
}

const ScopesInput = z.object({
	slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
	scopes: z.array(z.enum(SCOPES)).max(SCOPES.length),
});

export async function setBotScopes(input: { slug: string; scopes: string[] }): Promise<Result> {
	const gate = await requireAdmin();
	if ('error' in gate) return { ok: false, error: gate.error };
	const parsed = ScopesInput.safeParse(input);
	if (!parsed.success) return { ok: false, error: 'Unknown scope.' };
	const { slug, scopes } = parsed.data;

	const { error } = await gate.supabase.rpc('bot_set_consumer_scopes', { p_slug: slug, p_scopes: scopes });
	if (error) {
		if (/does not exist|schema cache/i.test(error.message)) return { ok: false, error: 'Migration 0112 (bot profiles) is not applied yet.' };
		if (/ceiling/i.test(error.message)) return { ok: false, error: `Refused by the identity scope ceiling: ${error.message}` };
		return { ok: false, error: error.message };
	}
	await recordAudit({
		actor_id: gate.actorId,
		entity_kind: 'mcp',
		entity_ref: `mcp_consumers/${slug}`,
		action: 'bot.scopes_set',
		diff: { scopes },
	});
	revalidatePath('/admin/bots');
	revalidatePath('/admin/identities');
	return { ok: true };
}
