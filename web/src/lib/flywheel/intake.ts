// Conversational intake (F2): pure helpers shared by the internal panel,
// the client portal (F5) and the actions. No server imports.

export interface IntakeQuestion {
	key: string;
	ask: string;
	type: 'text' | 'url' | 'email' | 'long' | 'list' | 'multi';
	required?: boolean;
	min?: number;
	options?: string[];
}

export const ACCESS_OPTION_LABELS: Record<string, string> = {
	gbp: 'Google Business Profile',
	search_console: 'Google Search Console',
	analytics: 'Google Analytics',
	site_backend: 'Website backend (or a developer contact)',
};

/** Picks the next unanswered script question. The "conversation" is the script with light acknowledgement; no model call. */
export function nextIntakeQuestion(script: IntakeQuestion[], answers: Record<string, unknown>): IntakeQuestion | null {
	for (const q of script) {
		if (!(q.key in answers)) return q;
	}
	return null;
}

/** Validates one answer against its question: returns the normalised value or an error. */
export function normaliseAnswer(q: IntakeQuestion, raw: string | string[]): { ok: true; value: unknown } | { ok: false; error: string } {
	if (q.type === 'list' || q.type === 'multi') {
		const items = (Array.isArray(raw) ? raw : raw.split(/\r?\n|,/)).map((s) => s.trim()).filter(Boolean);
		if (q.type === 'multi' && q.options) {
			const bad = items.filter((i) => !q.options!.includes(i));
			if (bad.length) return { ok: false, error: `Unknown option: ${bad.join(', ')}` };
		}
		if (q.required && items.length === 0) return { ok: false, error: 'Please give at least one.' };
		if (q.min && items.length < q.min) return { ok: false, error: `Please give at least ${q.min}.` };
		return { ok: true, value: items };
	}
	const text = (Array.isArray(raw) ? raw.join(' ') : raw).trim();
	if (q.required && !text) return { ok: false, error: 'This one is required.' };
	if (q.type === 'url' && text && !/^https?:\/\/\S+$/i.test(text)) return { ok: false, error: 'Please paste a full URL starting with https://' };
	if (q.type === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { ok: false, error: 'That does not look like an email.' };
	return { ok: true, value: text || null };
}

/** Script answers → the fw_apply_intake() payload shape (drops empties). */
export function answersToIntake(answers: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(answers)) {
		if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
		out[k] = v;
	}
	return out;
}

/** Progress 0-100 over the required questions. */
export function intakeProgress(script: IntakeQuestion[], answers: Record<string, unknown>): number {
	const req = script.filter((q) => q.required);
	if (req.length === 0) return 100;
	const done = req.filter((q) => q.key in answers && answers[q.key] != null && answers[q.key] !== '' && !(Array.isArray(answers[q.key]) && (answers[q.key] as unknown[]).length === 0)).length;
	return Math.round((done / req.length) * 100);
}

/** A short, human acknowledgement for the chat transcript. */
export function acknowledge(q: IntakeQuestion, value: unknown): string {
	if (Array.isArray(value)) return value.length === 0 ? 'Skipped for now.' : `Got ${value.length} — thank you.`;
	if (value == null || value === '') return 'Skipped for now.';
	if (q.type === 'long') return 'Thank you, that helps.';
	return 'Noted.';
}
