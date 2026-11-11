// One place to turn a database error into a sentence a publicist can act on.
//
// WHY: 53 server actions returned `error: error.message` straight to the UI,
// so a toast could read `new row violates row-level security policy for
// table "form_submissions"` or `duplicate key value violates unique
// constraint "tags_slug_key"`. The repo already names this as a past bug —
// see the comment in the-work/[id]/CommentsPanel.tsx — and admin/users
// states the rule: "errors always carry a correction hint (honest-feedback
// rule)". Three actions already translated by hand (avatarActions,
// lead-scraper, admin/brand); this generalises them so the next one is free.
//
// The raw message is NEVER dropped — it goes to the server log, where the
// person who can act on it will look. Only the UI copy is rewritten.

/** The shape both supabase-js and PostgREST errors share. */
export interface DbErrorLike {
	message?: string;
	code?: string;
	details?: string | null;
	hint?: string | null;
}

/**
 * Postgres SQLSTATE -> what the person should understand and do.
 *
 * Deliberately short and non-technical: the reader is a publicist or an
 * account lead, not a DBA. Each line says what happened AND what to try,
 * because an error with no next step is just noise.
 */
const BY_CODE: Record<string, string> = {
	// 23505 unique_violation
	'23505': 'That already exists — pick a different name or value.',
	// 23503 foreign_key_violation
	'23503': 'Something this links to was removed. Refresh the page and try again.',
	// 23514 check_violation
	'23514': "That value isn't one of the allowed options.",
	// 23502 not_null_violation
	'23502': 'A required field is missing.',
	// 42501 insufficient_privilege — also how RLS refusals usually arrive
	'42501': "You don't have permission to make this change.",
	// 22P02 invalid_text_representation (e.g. a malformed uuid or number)
	'22P02': "One of the values isn't in the right format.",
	// 22001 string_data_right_truncation
	'22001': 'One of the values is too long.',
	// 40001 serialization_failure / 40P01 deadlock_detected
	'40001': 'Someone else was editing this at the same time. Try again.',
	'40P01': 'Someone else was editing this at the same time. Try again.',
	// PGRST116 — PostgREST: no rows where exactly one was expected
	PGRST116: "That record no longer exists — it may have been deleted.",
	// 42P01 undefined_table / 42703 undefined_column — a migration gap, not
	// something the reader can fix, so point at who can.
	'42P01': 'This feature is not set up yet. Ask Ops to finish enabling it.',
	'42703': 'This feature is not set up yet. Ask Ops to finish enabling it.',
};

/** Last resort — still tells the reader what to do next. */
export const GENERIC_DB_ERROR =
	"Couldn't save that. Try again, and tell Ops if it keeps happening.";

/**
 * A user-facing sentence for a database error.
 *
 * Pass `action` to make the copy specific: explainDbError(e, 'save the tag')
 * -> "You don't have permission to make this change." stays as-is, but the
 * fallback becomes "Couldn't save the tag. Try again, …".
 */
export function explainDbError(error: unknown, action?: string): string {
	const e = (error ?? {}) as DbErrorLike;

	if (e.code && BY_CODE[e.code]) return BY_CODE[e.code];

	// RLS refusals do not always carry 42501 — supabase-js often surfaces
	// them as a plain message. This is the shape avatarActions matched by
	// hand before this module existed.
	const msg = typeof e.message === 'string' ? e.message : '';
	if (msg.includes('row-level security')) return BY_CODE['42501'];
	if (msg.includes('violates unique constraint')) return BY_CODE['23505'];
	if (msg.includes('violates foreign key constraint')) return BY_CODE['23503'];
	if (msg.includes('violates check constraint')) return BY_CODE['23514'];
	// A dropped column or table reads as a schema-cache miss through PostgREST.
	if (msg.includes('schema cache')) return BY_CODE['42P01'];

	return action
		? `Couldn't ${action}. Try again, and tell Ops if it keeps happening.`
		: GENERIC_DB_ERROR;
}

/**
 * Translate for the UI and log the raw error for whoever has to debug it.
 * `context` should name the operation, e.g. 'tags.rename'.
 */
export function explainAndLog(error: unknown, context: string, action?: string): string {
	const e = (error ?? {}) as DbErrorLike;
	console.error(`[${context}]`, e.code ?? '', e.message ?? error, e.details ?? '');
	return explainDbError(error, action);
}
