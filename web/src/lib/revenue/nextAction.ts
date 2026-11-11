// Which next-action fields a log writes (spec 2026-10-20 §4.2). Logging used to
// write `next_action_at: null` whenever no time was picked, so every log that
// did not touch the picker silently wiped the deal's due time. Now an absent
// field is left alone, and only an explicit "No next step" clears both.

export type NextActionWrite = { next_action?: string | null; next_action_at?: string | null };

export function nextActionWrite(input: { next_action?: string | null; next_action_at?: string | null; clear?: boolean }): NextActionWrite | null {
	if (input.clear) return { next_action: null, next_action_at: null };
	const out: NextActionWrite = {};
	if (input.next_action) out.next_action = input.next_action;
	if (input.next_action_at) {
		const t = new Date(input.next_action_at);
		if (!Number.isNaN(t.getTime())) out.next_action_at = t.toISOString();
	}
	return Object.keys(out).length ? out : null;
}
