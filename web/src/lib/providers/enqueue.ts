// Enqueue a content job: one function for the UI server actions, the MCP
// generate_content tool and future skills, so the Zod validation, the cost
// estimate and the way a cap refusal is worded are identical everywhere.
//
// The database is the authority on the cap (0065 trigger). This helper only
// carries its message back verbatim so a person or an agent can read it.

import type { createServiceRoleClient } from '@/lib/supabase/server';
import { parseContentJobInput } from './schema';
import { estimateCost, getAdapter } from './registry';
import type { ContentJobInput } from './types';

type Db = ReturnType<typeof createServiceRoleClient>;

export interface EnqueueRequest {
	provider: string;
	input: unknown;
	requestedBy: string | null;
	requestedVia: 'ui' | 'mcp' | 'skill';
	consumerSlug?: string | null;
	clientId?: string | null;
	workItemId?: string | null;
	parentJobId?: string | null;
}

export type EnqueueResult = { ok: true; jobId: string; costUsd: number; input: ContentJobInput } | { ok: false; refused: 'cap' | 'input' | 'provider' | 'db'; message: string };

/** The trigger raises P0001 with a sentence that starts this way. */
export const CAP_MESSAGE_PREFIX = 'Daily content budget reached';

export function isCapRefusal(message: string): boolean {
	return message.includes(CAP_MESSAGE_PREFIX);
}

export async function enqueueContentJob(db: Db, req: EnqueueRequest): Promise<EnqueueResult> {
	let input: ContentJobInput;
	try {
		input = parseContentJobInput(req.input);
	} catch (e) {
		const issue = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues?.[0];
		return { ok: false, refused: 'input', message: issue ? `Invalid input at ${issue.path.join('.') || 'root'}: ${issue.message}` : 'Invalid input.' };
	}
	const adapter = getAdapter(req.provider);
	if (!adapter) return { ok: false, refused: 'provider', message: `Unknown provider '${req.provider}'.` };
	if (!adapter.spec.capabilities.includes(input.capability)) {
		return { ok: false, refused: 'provider', message: `${adapter.spec.label} does not offer ${input.capability}.` };
	}
	if (!adapter.isConfigured()) {
		return { ok: false, refused: 'provider', message: `${adapter.spec.label} is ready but its key is not set (${adapter.spec.envKeys.join(', ')}).` };
	}
	const costUsd = estimateCost(req.provider, input);
	const { data, error } = await db
		.from('content_jobs')
		.insert({
			capability: input.capability,
			provider: req.provider,
			input,
			cost_usd: costUsd,
			requested_by: req.requestedBy,
			requested_via: req.requestedVia,
			consumer_slug: req.consumerSlug ?? null,
			client_id: req.clientId ?? null,
			work_item_id: req.workItemId ?? null,
			parent_job_id: req.parentJobId ?? null,
		})
		.select('id')
		.single<{ id: string }>();
	if (error) {
		if (isCapRefusal(error.message)) return { ok: false, refused: 'cap', message: error.message };
		return { ok: false, refused: 'db', message: error.message };
	}
	return { ok: true, jobId: data.id, costUsd, input };
}
