'use server';

// Server actions for /the-work/acquisitions (migration 0107). Thin: the
// capability gate (can_view_acquisitions, 0060: grant only, no admin floor)
// is enforced by RLS on the tables and re-checked inside
// acquisition_action_decide(); these validate shape, pass through, and
// surface the verdict. Writes by people go straight to the tables under RLS;
// writes by identities arrive as proposals and are applied here.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import {
	FINANCIAL_CONFIDENCE, GROWTH_TREND, HARD_GATE, MANAGEMENT_DEPTH, NOTE_KINDS, OWNER_READINESS, RECOMMENDATION,
	RELATIONSHIP_WARMTH, RISK_SEVERITY, RISK_STATUS, SOURCING_CHANNEL, TARGET_STATUSES,
} from '@/lib/mcp/mappers/acquisitions';

const ACQUISITIONS_PATH = '/the-work/acquisitions';

type Result = { ok: true } | { ok: false; error: string };

const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).or(z.literal('')).optional();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional();
const optNum = (min: number, max: number) => z.coerce.number().min(min).max(max).or(z.literal('')).optional();

const TargetInput = z.object({
	id: z.string().uuid(),
	status: z.enum(TARGET_STATUSES),
	vertical: z.string().trim().max(200).optional(),
	notable_clients: z.string().trim().max(2000).optional(),
	est_revenue: z.string().trim().max(40).optional(),
	est_ebitda: z.string().trim().max(40).optional(),
	financial_confidence: optEnum(FINANCIAL_CONFIDENCE),
	retainer_mix_pct: optNum(0, 100),
	top3_concentration_pct: optNum(0, 100),
	growth_trend: optEnum(GROWTH_TREND),
	management_depth: optEnum(MANAGEMENT_DEPTH),
	owner_readiness: optEnum(OWNER_READINESS),
	sourcing_channel: optEnum(SOURCING_CHANNEL),
	relationship_warmth: optEnum(RELATIONSHIP_WARMTH),
	next_action: z.string().trim().max(500).optional(),
	next_action_on: optDate,
	hard_gate: optEnum(HARD_GATE),
	scorecard_total: optNum(0, 40),
	score_drivers: z.string().trim().max(2000).optional(),
	recommendation: optEnum(RECOMMENDATION),
	batna: z.string().trim().max(5000).optional(),
	deal_structure: z.string().trim().max(5000).optional(),
	deal_stage_notes: z.string().trim().max(5000).optional(),
	notes: z.string().trim().max(20000).optional(),
});

function nullable(v: unknown): unknown {
	return v === '' || v === undefined ? null : v;
}

export async function updateAcquisitionTarget(formData: FormData): Promise<Result> {
	const user = await getAuthUser();
	if (!user) return { ok: false, error: 'Sign in first.' };
	const parsed = TargetInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { id, ...rest } = parsed.data;
	const patch = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, nullable(v)]));
	const supabase = await createClient();
	const { error, count } = await supabase.from('acquisition_targets').update(patch, { count: 'exact' }).eq('id', id);
	if (error) return { ok: false, error: error.message };
	if (!count) return { ok: false, error: 'Nothing updated: you may not hold the acquisitions capability.' };
	await recordAudit({ actor_id: user.id, entity_kind: 'supabase', entity_ref: `acquisition_targets/${id}`, action: 'update', diff: patch });
	revalidatePath(ACQUISITIONS_PATH);
	revalidatePath(`${ACQUISITIONS_PATH}/${id}`);
	return { ok: true };
}

const NoteInput = z
	.object({
		target_id: z.string().uuid(),
		kind: z.enum(NOTE_KINDS),
		title: z.string().trim().max(200).optional(),
		body_md: z.string().trim().min(1).max(20000),
		severity: optEnum(RISK_SEVERITY),
		risk_status: optEnum(RISK_STATUS),
		occurred_on: optDate,
	})
	.refine((v) => v.kind === 'risk' || (!v.severity && !v.risk_status), { message: 'Severity and risk status only apply to risk notes.' })
	.refine((v) => v.kind !== 'risk' || (v.severity && v.risk_status), { message: 'A risk note needs a severity and a status.' });

export async function addAcquisitionNote(formData: FormData): Promise<Result> {
	const user = await getAuthUser();
	if (!user) return { ok: false, error: 'Sign in first.' };
	const parsed = NoteInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();
	const { error } = await supabase.from('acquisition_target_notes').insert({
		target_id: d.target_id,
		kind: d.kind,
		title: nullable(d.title),
		body_md: d.body_md,
		severity: nullable(d.severity),
		risk_status: nullable(d.risk_status),
		occurred_on: d.occurred_on || undefined,
		author_id: user.id,
	});
	if (error) return { ok: false, error: /row-level security/.test(error.message) ? 'You do not hold the acquisitions capability.' : error.message };
	await recordAudit({ actor_id: user.id, entity_kind: 'supabase', entity_ref: `acquisition_targets/${d.target_id}`, action: 'create', diff: { note_kind: d.kind } });
	revalidatePath(`${ACQUISITIONS_PATH}/${d.target_id}`);
	return { ok: true };
}

const DecideInput = z.object({
	action_id: z.string().uuid(),
	decision: z.enum(['approved', 'rejected']),
	note: z.string().trim().max(2000).optional(),
});

export async function decideAcquisitionProposal(formData: FormData): Promise<Result> {
	const user = await getAuthUser();
	if (!user) return { ok: false, error: 'Sign in first.' };
	const parsed = DecideInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('acquisition_action_decide', {
		p_action_id: parsed.data.action_id,
		p_decision: parsed.data.decision,
		p_note: parsed.data.note || null,
	});
	if (error) return { ok: false, error: error.message.replace(/^acquisitions: /, '') };
	const res = (data ?? {}) as { status?: string; target_id?: string };
	await recordAudit({ actor_id: user.id, entity_kind: 'supabase', entity_ref: `spine.proposed_actions/${parsed.data.action_id}`, action: 'update', diff: { decision: parsed.data.decision, status: res.status } });
	revalidatePath(ACQUISITIONS_PATH);
	if (res.target_id) revalidatePath(`${ACQUISITIONS_PATH}/${res.target_id}`);
	return { ok: true };
}
