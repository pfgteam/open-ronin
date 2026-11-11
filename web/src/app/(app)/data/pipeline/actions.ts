'use server';

// Server actions for the native rule builder on /data/pipeline.
// Zod on the form, can_manage_automations() via RLS as the real guard,
// the 0101 triggers validate steps/allowlists, recordAudit on writes.
// Run now + advance share lib/automations/engine with the cron route.

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { StepsSchema, TriggerConfigSchema } from '@/lib/automations/shared';
import { advanceAutomations } from '@/lib/automations/engine';

const PATH = '/data/pipeline';

function back(error?: string): never {
	revalidatePath(PATH);
	revalidatePath('/admin/work-engine');
	redirect(error ? `${PATH}?error=${encodeURIComponent(error)}` : PATH);
}

const RuleInput = z.object({
	name: z.string().trim().min(2).max(120),
	slug: z
		.string()
		.trim()
		.regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'slug: lowercase letters, digits and dashes'),
	description_md: z.string().trim().max(4000).optional(),
	trigger: z.string(),
	steps: z.string(),
	requires_approval: z.coerce.boolean().default(false),
	approver_group: z.string().trim().max(80).optional(),
	daily_run_cap: z.coerce.number().int().min(1).max(10000).default(100),
});

function parseJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		back(`${label} is not valid JSON.`);
	}
}

export async function saveRule(formData: FormData): Promise<void> {
	const parsed = RuleInput.safeParse({
		name: formData.get('name'),
		slug: formData.get('slug'),
		description_md: formData.get('description_md') || undefined,
		trigger: formData.get('trigger') ?? '{}',
		steps: formData.get('steps') ?? '[]',
		requires_approval: formData.get('requires_approval') === 'on',
		approver_group: formData.get('approver_group') || undefined,
		daily_run_cap: formData.get('daily_run_cap') || 100,
	});
	if (!parsed.success) back(parsed.error.issues[0]?.message ?? 'Invalid rule.');
	const trigger = TriggerConfigSchema.safeParse(parseJson(parsed.data.trigger, 'Trigger'));
	if (!trigger.success) back(`Trigger: ${trigger.error.issues[0]?.message ?? 'invalid'}`);
	const steps = StepsSchema.safeParse(parseJson(parsed.data.steps, 'Steps'));
	if (!steps.success) back(`Steps: ${steps.error.issues[0]?.path.join('.') ?? ''} ${steps.error.issues[0]?.message ?? 'invalid'}`);

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) back('Not signed in.');

	const { kind, ...triggerConfig } = trigger.data;
	const id = formData.get('id');
	const row = {
		name: parsed.data.name,
		slug: parsed.data.slug,
		description_md: parsed.data.description_md ?? null,
		trigger_kind: kind,
		trigger_config: triggerConfig,
		steps: steps.data,
		requires_approval: parsed.data.requires_approval,
		approver_group: parsed.data.requires_approval ? parsed.data.approver_group || null : null,
		daily_run_cap: parsed.data.daily_run_cap,
	};
	const res =
		typeof id === 'string' && id
			? await supabase.from('automation_rules').update(row).eq('id', id).select('id').maybeSingle()
			: await supabase.from('automation_rules').insert(row).select('id').maybeSingle();
	if (res.error) back(res.error.message);
	if (!res.data) back('Nothing saved — only people who can manage automations may edit rules.');

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: `automation_rules/${res.data.id}`,
		action: typeof id === 'string' && id ? 'automation_rule.update' : 'automation_rule.create',
		diff: { slug: parsed.data.slug, trigger_kind: kind, steps: steps.data.length },
	});
	back();
}

export async function setRuleEnabled(formData: FormData): Promise<void> {
	const id = z.string().uuid().parse(formData.get('id'));
	const enabled = formData.get('enabled') === 'true';
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) back('Not signed in.');
	const { data, error } = await supabase
		.from('automation_rules')
		.update({ enabled, ...(enabled ? {} : { next_run_at: null }) })
		.eq('id', id)
		.select('id');
	if (error) back(error.message);
	if (!data?.length) back('Nothing changed — only people who can manage automations may enable rules.');
	await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `automation_rules/${id}`, action: enabled ? 'automation_rule.enable' : 'automation_rule.disable' });
	back();
}

export async function deleteRule(formData: FormData): Promise<void> {
	const id = z.string().uuid().parse(formData.get('id'));
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) back('Not signed in.');
	const { data, error } = await supabase.from('automation_rules').delete().eq('id', id).select('id');
	if (error) back(error.message);
	if (!data?.length) back('Nothing deleted.');
	await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `automation_rules/${id}`, action: 'automation_rule.delete' });
	back();
}

/** Queue a run through the RPC (the 0101 guards apply), then advance the engine once so it moves on localhost. */
export async function runRuleNow(formData: FormData): Promise<void> {
	const id = z.string().uuid().parse(formData.get('id'));
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) back('Not signed in.');
	const { data: run, error } = await supabase.rpc('automation_rule_run_now', { p_rule_id: id, p_payload: {} });
	if (error) back(error.message.includes('AUTOMATION_RUN_CAP') ? 'This rule has hit its daily run cap.' : error.message);
	await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `automation_runs/${(run as { id?: string } | null)?.id ?? ''}`, action: 'automation_rule.run_now' });
	// The RPC already proved can_manage_automations(); advancing is what the
	// cron does anyway, just sooner.
	await advanceAutomations(createServiceRoleClient()).catch(() => null);
	back();
}
