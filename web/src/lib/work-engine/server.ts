// Work Engine server reader. Session client so RLS decides who sees what:
// managers (can_manage_work_engine) see everything, others see their own runs
// and the ones their reviewer group owns. Constants live in ./shared.

import { createClient } from '@/lib/supabase/server';
import { isWorkDomain, isWorkStatus, type WorkDomain, type WorkEngineSummaryRow, type WorkRunRow, type WorkStatus } from './shared';

export * from './shared';

export interface WorkRunFilters {
	domain?: WorkDomain | null;
	status?: WorkStatus | 'waiting' | 'open' | null;
	requestedBy?: string | null;
	clientId?: string | null;
	limit?: number;
}

export interface WorkEngineRead {
	runs: WorkRunRow[];
	summary: WorkEngineSummaryRow[];
	/** Requester and approver display names keyed by profile id. */
	names: Map<string, string>;
	/** Client display names keyed by clients_v2 id. */
	clients: Map<string, string>;
	/** Null when 0099 is applied; otherwise the Postgres error so the page can say so. */
	unavailable: string | null;
}

export function parseFilters(params: Record<string, string | string[] | undefined>): WorkRunFilters {
	const one = (k: string) => (Array.isArray(params[k]) ? params[k]?.[0] : params[k]) ?? null;
	const domain = one('domain');
	const status = one('status');
	return {
		domain: isWorkDomain(domain) ? domain : null,
		status: status === 'waiting' || status === 'open' ? status : isWorkStatus(status) ? status : null,
		requestedBy: one('requester'),
		clientId: one('client'),
	};
}

export async function readWorkEngine(filters: WorkRunFilters): Promise<WorkEngineRead> {
	const supabase = await createClient();
	const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);

	let query = supabase.from('work_runs').select('*');
	if (filters.domain) query = query.eq('domain', filters.domain);
	if (filters.status === 'waiting') query = query.eq('status', 'waiting_approval');
	else if (filters.status === 'open') query = query.in('status', ['queued', 'running', 'waiting_approval', 'approved']);
	else if (filters.status) query = query.eq('status', filters.status);
	if (filters.requestedBy) query = query.eq('requested_by', filters.requestedBy);
	if (filters.clientId) query = query.eq('client_id', filters.clientId);
	// Waiting-on-someone is a queue: oldest first. Everything else: newest first.
	const oldestFirst = filters.status === 'waiting' || filters.status === 'waiting_approval';
	query = query.order('created_at', { ascending: oldestFirst }).limit(limit);

	const [runsRes, summaryRes] = await Promise.all([query, supabase.from('work_engine_summary').select('*')]);
	if (runsRes.error) {
		return { runs: [], summary: [], names: new Map(), clients: new Map(), unavailable: runsRes.error.message };
	}
	const runs = (runsRes.data ?? []) as WorkRunRow[];
	const summary = (summaryRes.data ?? []) as WorkEngineSummaryRow[];

	const profileIds = new Set<string>();
	const clientIds = new Set<string>();
	for (const r of runs) {
		if (r.requested_by) profileIds.add(r.requested_by);
		if (r.approved_by) profileIds.add(r.approved_by);
		if (r.client_id) clientIds.add(r.client_id);
	}
	const [profilesRes, clientsRes] = await Promise.all([
		profileIds.size
			? supabase.from('profiles').select('id, first_name, last_name, email').in('id', [...profileIds])
			: Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; email: string }[] }),
		clientIds.size
			? supabase.from('clients_v2').select('id, display_name').in('id', [...clientIds])
			: Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
	]);
	const names = new Map(
		(profilesRes.data ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email]),
	);
	const clients = new Map((clientsRes.data ?? []).map((c) => [c.id, c.display_name]));
	return { runs, summary, names, clients, unavailable: null };
}
