// "Pending actions from Sessions" for the Home cockpit (Alex, 2026-09-14).
//
// Source: call_suggested_tasks (migration 0056) — tasks the AI proposed from a
// call analysis that nobody has accepted or dismissed yet. The spine's
// `call.suggest_task` action type (SPINE_BUILD_PLAN S3.3) is not landed; this
// table is the one real data source today, and it is what /team/sessions/[id]
// accepts/dismisses through decideSuggestedTask.
//
// "Assigned to that person OR their team" is resolved two ways, because the
// suggestion carries only a suggested_owner_email (an LLM guess) and the call
// carries attendee ids:
//   - the suggested owner email is the viewer's or a direct report's, or
//   - the viewer or a direct report attended the call.
// RLS (can_view_call) already restricts the read to calls the viewer may see.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SessionAction {
	id: string;
	callId: string;
	title: string;
	detail: string | null;
	suggestedOwnerEmail: string | null;
	/** Why it is in this viewer's list. */
	reason: 'you' | 'attended' | 'report' | 'report_attended';
	occurredAt: string | null;
	callType: string | null;
	clientName: string | null;
	/** Internal attendees of the call. decideSuggestedTask only accepts an
	 *  owner who is one of these or the viewer, so the inline owner picker
	 *  offers exactly that set. Empty when the call row is missing. */
	attendeeIds: string[];
	createdAt: string;
}

/** One call's pending suggestions, for the grouped From Sessions tab. */
export interface SessionActionGroup {
	callId: string;
	clientName: string | null;
	callType: string | null;
	occurredAt: string | null;
	attendeeIds: string[];
	actions: SessionAction[];
}

interface SuggestionRow {
	id: string;
	call_id: string;
	title: string;
	detail_md: string | null;
	suggested_owner_email: string | null;
	created_at: string;
}

interface CallRow {
	id: string;
	call_type: string | null;
	occurred_at: string | null;
	client_id: string | null;
	attendee_user_ids: string[] | null;
}

export interface SessionActionScope {
	viewerId: string;
	viewerEmail: string;
	reports: string[];
	reportEmails: string[];
}

/** Pure: which pending suggestions belong on this viewer's tab, and why. */
export function scopeSessionActions(
	suggestions: SuggestionRow[],
	calls: Map<string, CallRow>,
	clientNames: Map<string, string>,
	scope: SessionActionScope,
): SessionAction[] {
	const reportSet = new Set(scope.reports);
	const reportEmailSet = new Set(scope.reportEmails.map((e) => e.toLowerCase()));
	const out: SessionAction[] = [];
	for (const s of suggestions) {
		const call = calls.get(s.call_id);
		const email = (s.suggested_owner_email ?? '').toLowerCase();
		const attendees = call?.attendee_user_ids ?? [];
		let reason: SessionAction['reason'] | null = null;
		if (email && email === scope.viewerEmail) reason = 'you';
		else if (attendees.includes(scope.viewerId)) reason = 'attended';
		else if (email && reportEmailSet.has(email)) reason = 'report';
		else if (attendees.some((a) => reportSet.has(a))) reason = 'report_attended';
		if (!reason) continue;
		out.push({
			id: s.id,
			callId: s.call_id,
			title: s.title,
			detail: s.detail_md,
			suggestedOwnerEmail: s.suggested_owner_email,
			reason,
			occurredAt: call?.occurred_at ?? null,
			callType: call?.call_type ?? null,
			clientName: call?.client_id ? (clientNames.get(call.client_id) ?? null) : null,
			attendeeIds: attendees,
			createdAt: s.created_at,
		});
	}
	// Newest call first, then newest suggestion.
	out.sort((a, b) => {
		const ao = a.occurredAt ?? a.createdAt;
		const bo = b.occurredAt ?? b.createdAt;
		return ao < bo ? 1 : ao > bo ? -1 : 0;
	});
	return out;
}

/**
 * Pure: fold an already-scoped, already-sorted list into one group per call,
 * in the order the calls first appear (so newest call first), keeping each
 * group's suggestions in their list order. The tab renders one header per
 * group instead of repeating client · type · date on every row.
 */
export function groupSessionActions(actions: SessionAction[]): SessionActionGroup[] {
	const byCall = new Map<string, SessionActionGroup>();
	for (const a of actions) {
		let g = byCall.get(a.callId);
		if (!g) {
			g = {
				callId: a.callId,
				clientName: a.clientName,
				callType: a.callType,
				occurredAt: a.occurredAt,
				attendeeIds: a.attendeeIds,
				actions: [],
			};
			byCall.set(a.callId, g);
		}
		g.actions.push(a);
	}
	return [...byCall.values()];
}

export async function loadSessionActions(
	supabase: SupabaseClient,
	scope: SessionActionScope,
): Promise<SessionAction[]> {
	// Pending only; the index on (status) where status='pending' (0056) keeps
	// this cheap. Capped so a runaway ingest cannot turn Home into a wall.
	const { data: sugRows, error } = await supabase
		.from('call_suggested_tasks')
		.select('id, call_id, title, detail_md, suggested_owner_email, created_at')
		.eq('status', 'pending')
		.order('created_at', { ascending: false })
		.limit(300)
		.returns<SuggestionRow[]>();
	if (error || !sugRows || sugRows.length === 0) return [];

	const callIds = [...new Set(sugRows.map((s) => s.call_id))];
	const { data: callRows } = await supabase
		.from('calls')
		.select('id, call_type, occurred_at, client_id, attendee_user_ids')
		.in('id', callIds)
		.returns<CallRow[]>();
	const calls = new Map((callRows ?? []).map((c) => [c.id, c]));

	const clientIds = [...new Set((callRows ?? []).map((c) => c.client_id).filter((v): v is string => !!v))];
	const clientNames = new Map<string, string>();
	if (clientIds.length) {
		const { data: clientRows } = await supabase
			.from('clients_v2')
			.select('id, display_name')
			.in('id', clientIds)
			.returns<{ id: string; display_name: string | null }[]>();
		for (const c of clientRows ?? []) if (c.display_name) clientNames.set(c.id, c.display_name);
	}

	return scopeSessionActions(sugRows, calls, clientNames, scope);
}
