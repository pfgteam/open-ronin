import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError, MAX_SCAN } from '@/lib/mcp/tooling';
import { businessToday } from '@/lib/format';
import {
	FINANCIAL_CONFIDENCE, GROWTH_TREND, HARD_GATE, MANAGEMENT_DEPTH, NOTE_COLUMNS, NOTE_KINDS, OWNER_READINESS,
	RECOMMENDATION, RELATIONSHIP_WARMTH, RISK_SEVERITY, RISK_STATUS, SOURCING_CHANNEL, TARGET_COLUMNS, TARGET_STATUSES,
	TERMINAL_STATUSES, mapNote, mapTarget, sortForReadPath, type NoteRow, type TargetRow,
} from '@/lib/mcp/mappers/acquisitions';

// The `acquisitions` family (migration 0107): the shared home for the five
// acquisitions identities (BOT_ROSTER_SYNTHESIS Tier 1). Reads run with the
// service role like every other family; every write is a spine proposal
// (acquisitions:propose) that a human with the acquisitions capability
// applies from /the-work/acquisitions. No agent write lands in the table.

const LIMIT = z.number().int().min(1).max(200).default(50);
const UUID = z.string().uuid();

type Binding = { identity_slug: string | null; owner_profile_id: string | null };

async function boundIdentity(extra: { authInfo?: { extra?: unknown } }): Promise<string> {
	const consumerId = (extra.authInfo?.extra as { consumerId?: string } | undefined)?.consumerId;
	if (!consumerId) throw userError('No consumer on this request.');
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.from('mcp_consumers').select('identity_slug, owner_profile_id').eq('id', consumerId).maybeSingle<Binding>();
	if (error) throw new Error(`binding lookup: ${error.message}`);
	if (!data?.identity_slug) {
		throw userError('This consumer is not bound to a spine identity, so it cannot propose. Ask a Open Ronin admin to run mcp_provision_consumer (SPINE_HIRING_PLAN.md).');
	}
	return data.identity_slug;
}

async function propose(actionType: string, identity: string, reasoning: string, payload: Record<string, unknown>): Promise<string> {
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.rpc('spine_propose_action', {
		p_action_type: actionType,
		p_identity_slug: identity,
		p_skill_run_id: null,
		p_work_item_id: null,
		p_reasoning: reasoning,
		p_payload: payload,
	});
	if (error) {
		if (/is not enabled/.test(error.message)) throw userError(error.message);
		throw new Error(error.message);
	}
	return data as string;
}

async function requireTarget(id: string): Promise<TargetRow> {
	const supabase = createServiceRoleClient();
	const { data, error } = await supabase.from('acquisition_targets').select(TARGET_COLUMNS).eq('id', id).maybeSingle<TargetRow>();
	if (error) throw error;
	if (!data) throw userError(`No acquisition target with id ${id}.`);
	return data;
}

const PATCH_SCHEMA = z
	.object({
		company_name: z.string().min(1).max(200),
		website: z.string().max(500).nullable(),
		owner_name: z.string().max(200).nullable(),
		owner_title: z.string().max(200).nullable(),
		email: z.string().max(320).nullable(),
		phone: z.string().max(60).nullable(),
		linkedin_url: z.string().max(500).nullable(),
		agency_services: z.string().max(500).nullable(),
		employee_count: z.string().max(40).nullable(),
		founded_year: z.string().max(10).nullable(),
		est_revenue: z.string().max(40).nullable(),
		city: z.string().max(120).nullable(),
		state: z.string().max(120).nullable(),
		country: z.string().max(120).nullable(),
		owner_signal: z.string().max(2000).nullable(),
		status: z.enum(TARGET_STATUSES),
		fit_score: z.number().int().min(0).max(100).nullable(),
		notes: z.string().max(20000).nullable(),
		vertical: z.string().max(200).nullable(),
		notable_clients: z.string().max(2000).nullable(),
		est_ebitda: z.string().max(40).nullable(),
		financial_confidence: z.enum(FINANCIAL_CONFIDENCE).nullable(),
		retainer_mix_pct: z.number().min(0).max(100).nullable(),
		top3_concentration_pct: z.number().min(0).max(100).nullable(),
		growth_trend: z.enum(GROWTH_TREND).nullable(),
		management_depth: z.enum(MANAGEMENT_DEPTH).nullable(),
		owner_readiness: z.enum(OWNER_READINESS).nullable(),
		sourcing_channel: z.enum(SOURCING_CHANNEL).nullable(),
		relationship_warmth: z.enum(RELATIONSHIP_WARMTH).nullable(),
		last_touch_on: z.string().date().nullable(),
		next_action: z.string().max(500).nullable(),
		next_action_on: z.string().date().nullable(),
		hard_gate: z.enum(HARD_GATE).nullable(),
		scorecard_total: z.number().int().min(0).max(40).nullable(),
		score_drivers: z.string().max(2000).nullable(),
		recommendation: z.enum(RECOMMENDATION).nullable(),
		batna: z.string().max(5000).nullable(),
		deal_structure: z.string().max(5000).nullable(),
		deal_stage_notes: z.string().max(5000).nullable(),
	})
	.partial()
	.strict();

export function registerAcquisitionTools(server: McpServer): void {
	server.registerTool(
		'list_acquisition_targets',
		{
			title: 'List acquisition targets',
			description:
				'Acquisition pipeline targets (acquisition_targets, the rollup target list in the 28-column format). Defaults to open targets only (excludes acquired/passed/dead) sorted on Mary\'s read path: hard gate passed first, then scorecard descending, then soonest next action. Filter by status, hard_gate, recommendation, overdue next action, or a name/vertical search. Includes the firm owner contact fields; this family is gated to the acquisitions identities.',
			inputSchema: {
				status: z.enum(TARGET_STATUSES).optional(),
				include_terminal: z.boolean().default(false),
				hard_gate: z.enum(HARD_GATE).optional(),
				recommendation: z.enum(RECOMMENDATION).optional(),
				overdue_only: z.boolean().default(false),
				search: z.string().min(2).max(100).optional(),
				limit: LIMIT,
			},
		},
		async ({ status, include_terminal, hard_gate, recommendation, overdue_only, search, limit }, extra) =>
			audited('list_acquisition_targets', 'acquisitions:read', extra.authInfo, { status, include_terminal, hard_gate, recommendation, overdue_only, search, limit }, 'acquisition targets', async () => {
				const supabase = createServiceRoleClient();
				let query = supabase.from('acquisition_targets').select(TARGET_COLUMNS).limit(MAX_SCAN);
				if (status) query = query.eq('status', status);
				if (hard_gate) query = query.eq('hard_gate', hard_gate);
				if (recommendation) query = query.eq('recommendation', recommendation);
				if (search) query = query.or(`company_name.ilike.%${search.replace(/[%,()]/g, '')}%,vertical.ilike.%${search.replace(/[%,()]/g, '')}%`);
				const { data, error } = await query.returns<TargetRow[]>();
				if (error) throw error;
				const today = businessToday();
				let rows = data ?? [];
				if (!status && !include_terminal) rows = rows.filter((r) => !TERMINAL_STATUSES.has(r.status));
				if (overdue_only) rows = rows.filter((r) => !!r.next_action_on && r.next_action_on < today && !TERMINAL_STATUSES.has(r.status));
				rows = sortForReadPath(rows);
				const truncated = rows.length > limit || (data ?? []).length >= MAX_SCAN;
				const page = rows.slice(0, limit);
				const owners = await ownerLookup(page.map((r) => r.owner_profile_id));
				const mapped = page.map((r) => mapTarget(r, owners.get(r.owner_profile_id ?? '') ?? { name: null, email: null }, today));
				return { payload: { rows: mapped, count: rows.length, truncated }, rows: mapped.length };
			}),
	);

	server.registerTool(
		'get_acquisition_target',
		{
			title: 'Get one acquisition target',
			description: 'One target by id or target_ref (DG-2026-001) with its full 28-column record, deal-card fields, and its notes (research, risk register, decisions, negotiation, touches) newest first.',
			inputSchema: { id: UUID.optional(), target_ref: z.string().regex(/^DG-\d{4}-\d{3}$/).optional(), notes_limit: z.number().int().min(0).max(200).default(50) },
		},
		async ({ id, target_ref, notes_limit }, extra) =>
			audited('get_acquisition_target', 'acquisitions:read', extra.authInfo, { id, target_ref, notes_limit }, 'this target', async () => {
				if (!id && !target_ref) throw userError('Pass id or target_ref.');
				const supabase = createServiceRoleClient();
				const q = supabase.from('acquisition_targets').select(TARGET_COLUMNS);
				const { data, error } = await (id ? q.eq('id', id) : q.eq('target_ref', target_ref!)).maybeSingle<TargetRow>();
				if (error) throw error;
				if (!data) throw userError(`No acquisition target matches ${id ?? target_ref}.`);
				const [{ data: notes, error: nErr }, owners] = await Promise.all([
					supabase.from('acquisition_target_notes').select(NOTE_COLUMNS).eq('target_id', data.id).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(notes_limit).returns<NoteRow[]>(),
					ownerLookup([data.owner_profile_id]),
				]);
				if (nErr) throw nErr;
				const authors = await ownerLookup((notes ?? []).map((n) => n.author_id));
				const target = mapTarget(data, owners.get(data.owner_profile_id ?? '') ?? { name: null, email: null }, businessToday());
				const mappedNotes = (notes ?? []).map((n) => mapNote(n, authors.get(n.author_id ?? '')?.name ?? null));
				return { payload: { target, notes: mappedNotes, open_risks: mappedNotes.filter((n) => n.kind === 'risk' && n.risk_status !== 'closed').length }, rows: 1 + mappedNotes.length };
			}),
	);

	server.registerTool(
		'list_acquisition_notes',
		{
			title: 'List acquisition notes',
			description: 'Notes across targets: research, risk (register), decision (log), negotiation, touch, integration, general. Filter by target, kind, open risks only. Newest first.',
			inputSchema: {
				target_id: UUID.optional(),
				kind: z.enum(NOTE_KINDS).optional(),
				open_risks_only: z.boolean().default(false),
				limit: LIMIT,
			},
		},
		async ({ target_id, kind, open_risks_only, limit }, extra) =>
			audited('list_acquisition_notes', 'acquisitions:read', extra.authInfo, { target_id, kind, open_risks_only, limit }, 'acquisition notes', async () => {
				const supabase = createServiceRoleClient();
				let query = supabase.from('acquisition_target_notes').select(NOTE_COLUMNS).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(Math.min(limit + 1, MAX_SCAN));
				if (target_id) query = query.eq('target_id', target_id);
				if (kind) query = query.eq('kind', kind);
				if (open_risks_only) query = query.eq('kind', 'risk').in('risk_status', ['open', 'mitigating']);
				const { data, error } = await query.returns<NoteRow[]>();
				if (error) throw error;
				const rows = data ?? [];
				const truncated = rows.length > limit;
				const page = rows.slice(0, limit);
				const authors = await ownerLookup(page.map((n) => n.author_id));
				const mapped = page.map((n) => mapNote(n, authors.get(n.author_id ?? '')?.name ?? null));
				return { payload: { rows: mapped, count: mapped.length, truncated }, rows: mapped.length };
			}),
	);

	server.registerTool(
		'propose_acquisition_target_update',
		{
			title: 'Propose an update to an acquisition target',
			description:
				'Proposes a patch to one target (status, scorecard, hard gate, recommendation, next action, deal-card fields such as batna and deal_structure). Nothing is written until a person with the acquisitions capability approves it at /the-work/acquisitions. Returns the proposal id. Give a one-paragraph reasoning a reviewer can act on.',
			inputSchema: { target_id: UUID, patch: PATCH_SCHEMA, reasoning: z.string().min(10).max(4000) },
		},
		async ({ target_id, patch, reasoning }, extra) =>
			audited('propose_acquisition_target_update', 'acquisitions:propose', extra.authInfo, { target_id, patch, reasoning }, 'this proposal', async () => {
				if (Object.keys(patch).length === 0) throw userError('The patch is empty.');
				const identity = await boundIdentity(extra);
				await requireTarget(target_id);
				const actionId = await propose('acquisition_target.update', identity, reasoning, { target_id, patch });
				return { payload: { proposal_id: actionId, status: 'pending', review_url: '/the-work/acquisitions?tab=proposals' }, rows: 1 };
			}),
	);

	server.registerTool(
		'propose_acquisition_note',
		{
			title: 'Propose a note on an acquisition target',
			description:
				'Proposes one note: research finding, risk (with severity + risk_status), decision, negotiation note, touch (moves last_touch_on when applied), integration or general. Applied by a human; the note then carries your identity as its author.',
			inputSchema: {
				target_id: UUID,
				kind: z.enum(NOTE_KINDS),
				title: z.string().max(200).optional(),
				body_md: z.string().min(1).max(20000),
				severity: z.enum(RISK_SEVERITY).optional(),
				risk_status: z.enum(RISK_STATUS).optional(),
				occurred_on: z.string().date().optional(),
				reasoning: z.string().min(5).max(2000).default('Note proposed over MCP.'),
			},
		},
		async ({ target_id, kind, title, body_md, severity, risk_status, occurred_on, reasoning }, extra) =>
			audited('propose_acquisition_note', 'acquisitions:propose', extra.authInfo, { target_id, kind, title, severity, risk_status, occurred_on }, 'this proposal', async () => {
				if (kind !== 'risk' && (severity || risk_status)) throw userError('severity and risk_status are only valid when kind is risk.');
				if (kind === 'risk' && (!severity || !risk_status)) throw userError('A risk note needs severity and risk_status.');
				const identity = await boundIdentity(extra);
				await requireTarget(target_id);
				const actionId = await propose('acquisition_target_note.create', identity, reasoning, { target_id, kind, title: title ?? null, body_md, severity: severity ?? null, risk_status: risk_status ?? null, occurred_on: occurred_on ?? null });
				return { payload: { proposal_id: actionId, status: 'pending', review_url: '/the-work/acquisitions?tab=proposals' }, rows: 1 };
			}),
	);

	server.registerTool(
		'propose_acquisition_target',
		{
			title: 'Propose a new acquisition target',
			description: 'Proposes a new target row from a sourcing wave. company_name is required; any other patchable column may be set. A human approves before the row exists; the target_ref (DG-YYYY-NNN) is minted on approval.',
			inputSchema: { row: PATCH_SCHEMA.required({ company_name: true }), reasoning: z.string().min(10).max(4000) },
		},
		async ({ row, reasoning }, extra) =>
			audited('propose_acquisition_target', 'acquisitions:propose', extra.authInfo, { row, reasoning }, 'this proposal', async () => {
				const identity = await boundIdentity(extra);
				const supabase = createServiceRoleClient();
				const { data: dup } = await supabase.from('acquisition_targets').select('id, target_ref, status').ilike('company_name', row.company_name).limit(1).maybeSingle<{ id: string; target_ref: string | null; status: string }>();
				if (dup) throw userError(`A target named "${row.company_name}" already exists (${dup.target_ref ?? dup.id}, ${dup.status}). Propose an update to it instead.`);
				const actionId = await propose('acquisition_target.create', identity, reasoning, { row });
				return { payload: { proposal_id: actionId, status: 'pending', review_url: '/the-work/acquisitions?tab=proposals' }, rows: 1 };
			}),
	);
}

async function ownerLookup(ids: Array<string | null | undefined>): Promise<Map<string, { name: string | null; email: string | null }>> {
	const wanted = [...new Set(ids.filter((v): v is string => !!v))];
	if (wanted.length === 0) return new Map();
	const supabase = createServiceRoleClient();
	const { data } = await supabase.from('profiles').select('id, first_name, last_name, email').in('id', wanted).returns<{ id: string; first_name: string | null; last_name: string | null; email: string }[]>();
	return new Map((data ?? []).map((p) => [p.id, { name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email, email: p.email }]));
}
