// What the shared log form posts to logActivity (spec 2026-10-20 §4.2–4.3).
// Self → Sales and the deal page use the same form; the deal page passes
// `extended` for a subject and an inbound flag. The next action is sent only
// when the rep changed it, so a plain log keeps the deal's due time.

export type LogKind = 'call' | 'sms' | 'email' | 'dm' | 'meeting' | 'note';

export interface LogState {
	kind: LogKind;
	outcome: string | null;
	note: string;
	subject: string;
	inbound: boolean;
	positive: boolean;
	next: string;
	when: Date | null;
	clearNext: boolean;
}

export interface LogContext {
	dealId: string;
	personId: string | null;
	originalNext: string | null;
	extended: boolean;
}

const nextEdited = (s: LogState, originalNext: string | null) => s.next.trim() !== (originalNext ?? '').trim();

function direction(s: LogState, extended: boolean): 'inbound' | 'outbound' | 'internal' {
	if (s.kind === 'note') return 'internal';
	if (s.kind === 'meeting') return 'inbound';
	return extended && s.inbound ? 'inbound' : 'outbound';
}

export function buildLogFields(s: LogState, ctx: LogContext): Record<string, string> {
	const f: Record<string, string> = { deal_id: ctx.dealId };
	if (ctx.personId) f.person_id = ctx.personId;
	f.kind = s.kind;
	f.direction = direction(s, ctx.extended);
	if (s.outcome) f.disposition_id = s.outcome;
	if (ctx.extended && s.subject.trim()) f.subject = s.subject.trim();
	if (s.note.trim()) f.body_md = s.note.trim();
	if (s.positive) f.is_positive = 'yes';
	if (s.clearNext) {
		f.clear_next = 'yes';
		return f;
	}
	if (s.next.trim() && nextEdited(s, ctx.originalNext)) f.next_action = s.next.trim();
	if (s.when) f.next_action_at = s.when.toISOString();
	return f;
}

/** The row patch that matches what the server stored (Self's queue patches locally). */
export function patchAfterLog(s: LogState, prev: { next_action: string | null; next_action_at: string | null }): { next_action?: string | null; next_action_at?: string | null } {
	if (s.clearNext) return { next_action: null, next_action_at: null };
	const out: { next_action?: string | null; next_action_at?: string | null } = {};
	if (s.next.trim() && nextEdited(s, prev.next_action)) out.next_action = s.next.trim();
	if (s.when) out.next_action_at = s.when.toISOString();
	return out;
}
