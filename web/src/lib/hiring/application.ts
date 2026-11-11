// Application builder vocabulary (0130, H3). No server imports: the public
// candidate form, the admin builder, the API routes and the SQL CHECK
// (hire_application_config_check) all agree on this shape.

export const SECTION_KINDS = ['consent', 'contact', 'screening', 'skills', 'challenge', 'video', 'resume', 'links', 'questionnaire', 'custom'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
	consent: 'Consent',
	contact: 'Contact',
	screening: 'Screening',
	skills: 'Skills self-rating',
	challenge: 'Timed challenge',
	video: 'Video',
	resume: 'Resume & files',
	links: 'Links',
	questionnaire: 'Questionnaire',
	custom: 'Custom',
};

export const QUESTION_TYPES = ['short_text', 'long_text', 'number', 'select', 'multi', 'boolean', 'rating_1_5', 'url', 'email', 'phone', 'date', 'file', 'video', 'timed_text', 'statement'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
	short_text: 'Short text',
	long_text: 'Long text',
	number: 'Number',
	select: 'Single choice',
	multi: 'Multiple choice',
	boolean: 'Yes / no (checkbox)',
	rating_1_5: 'Rating 1-5',
	url: 'URL',
	email: 'Email',
	phone: 'Phone',
	date: 'Date',
	file: 'File upload',
	video: 'Video (record or link)',
	timed_text: 'Timed text (no paste)',
	statement: 'Statement (no answer)',
};

export const PASTE_MODES = ['allow', 'track', 'block'] as const;
export type PasteMode = (typeof PASTE_MODES)[number];

export interface AppQuestion {
	key: string;
	type: QuestionType;
	label: string;
	help?: string;
	required?: boolean;
	paste?: PasteMode;
	options?: string[];
	min?: number;
	max?: number;
	max_chars?: number;
	time_limit_s?: number;
	honeypot?: boolean;
	honeypot_threshold?: number;
	weight?: number;
}

export interface AppSection {
	key: string;
	kind: SectionKind;
	title: string;
	intro_md?: string;
	questions: AppQuestion[];
}

export interface ApplicationConfig {
	version: number;
	sections: AppSection[];
}

/** Per-question behaviour captured in the browser and sent with the answer. */
export interface AnswerMeta {
	value: unknown;
	typed_chars?: number;
	pasted_chars?: number;
	paste_events?: number;
	blocked?: number;
	time_used_s?: number;
	started_at?: string;
	finished_at?: string;
}

export type AnswerMap = Record<string, AnswerMeta>;

const KEY_RE = /^[a-z][a-z0-9_]{0,60}$/;
const SECTION_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

/** Mirror of hire_application_config_check(): null = valid, else the reason. */
export function validateConfig(cfg: unknown): string | null {
	if (!cfg || typeof cfg !== 'object') return 'config must be an object';
	const c = cfg as ApplicationConfig;
	if (!Array.isArray(c.sections)) return 'config.sections must be an array';
	const seen = new Set<string>();
	for (const s of c.sections) {
		if (!SECTION_KEY_RE.test(s?.key ?? '')) return `section key invalid: ${s?.key ?? '(null)'}`;
		if (!SECTION_KINDS.includes(s.kind)) return `section kind invalid: ${s.kind ?? '(null)'}`;
		if (!Array.isArray(s.questions)) return `section ${s.key} needs questions[]`;
		for (const q of s.questions) {
			if (!KEY_RE.test(q?.key ?? '')) return `question key invalid: ${q?.key ?? '(null)'}`;
			if (seen.has(q.key)) return `duplicate question key: ${q.key}`;
			seen.add(q.key);
			if (!QUESTION_TYPES.includes(q.type)) return `question type invalid: ${q.key}`;
			if (q.paste && !PASTE_MODES.includes(q.paste)) return `question paste mode invalid: ${q.key}`;
			if (q.type === 'timed_text' && (q.time_limit_s ?? 0) < 30) return `timed question needs time_limit_s >= 30: ${q.key}`;
			if ((q.type === 'select' || q.type === 'multi') && !(q.options?.length ?? 0)) return `${q.key} needs options`;
		}
	}
	return null;
}

export function isEmptyConfig(cfg: unknown): boolean {
	const c = cfg as ApplicationConfig | null;
	return !c || !Array.isArray(c.sections) || c.sections.length === 0;
}

export function allQuestions(cfg: ApplicationConfig): (AppQuestion & { section_key: string; section_kind: SectionKind })[] {
	return cfg.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section_key: s.key, section_kind: s.kind })));
}

/** Contact fields the submit RPC reads from the answers (keys fixed by the default config). */
export const CONTACT_KEYS = ['full_name', 'email', 'phone', 'location_text', 'country', 'timezone', 'linkedin_url', 'current_role', 'portfolio_urls', 'video_url'] as const;

/** Loose E.164: strip everything but digits and a leading +; require 8-15 digits. */
export function toE164(raw: string | null | undefined, defaultCountry = '1'): string | null {
	if (!raw) return null;
	const digits = raw.replace(/[^\d+]/g, '');
	if (!digits) return null;
	let d = digits.startsWith('+') ? digits.slice(1) : digits;
	d = d.replace(/\D/g, '');
	if (!digits.startsWith('+') && d.length === 10) d = defaultCountry + d;
	if (d.length < 8 || d.length > 15) return null;
	return `+${d}`;
}

/** Validates one answer against its question; returns an error string or null. */
export function validateAnswer(q: AppQuestion, meta: AnswerMeta | undefined): string | null {
	const v = meta?.value;
	const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (q.type === 'boolean' && v !== true && q.required);
	if (q.type === 'statement') return null;
	if (q.required && empty) return q.type === 'boolean' ? 'Please confirm.' : 'Required.';
	if (empty) return null;
	switch (q.type) {
		case 'email':
			return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v)) ? null : 'Enter a valid email.';
		case 'phone':
			return toE164(String(v)) ? null : 'Enter a phone number with country code (e.g. +1 615 555 0100).';
		case 'url':
			return /^https?:\/\/\S+\.\S+/.test(String(v)) ? null : 'Enter a full URL starting with https://';
		case 'number': {
			const n = Number(v);
			if (!Number.isFinite(n)) return 'Enter a number.';
			if (q.min != null && n < q.min) return `Minimum ${q.min}.`;
			if (q.max != null && n > q.max) return `Maximum ${q.max}.`;
			return null;
		}
		case 'rating_1_5': {
			const n = Number(v);
			return n >= 1 && n <= 5 ? null : 'Pick 1 to 5.';
		}
		case 'select':
			return q.options?.includes(String(v)) ? null : 'Pick one of the options.';
		case 'multi':
			return Array.isArray(v) && v.every((x) => q.options?.includes(String(x))) ? null : 'Pick from the options.';
		case 'short_text':
		case 'long_text':
		case 'timed_text': {
			const s = String(v);
			if (q.max_chars && s.length > q.max_chars) return `Keep it under ${q.max_chars} characters.`;
			return null;
		}
		case 'file':
			return typeof v === 'string' && v.length > 0 ? null : 'Upload a file.';
		case 'video':
			return typeof v === 'string' && v.length > 0 ? null : 'Record a video or paste a link.';
		default:
			return null;
	}
}

/** Validates a whole section; returns { key: error }. */
export function validateSection(section: AppSection, answers: AnswerMap): Record<string, string> {
	const out: Record<string, string> = {};
	for (const q of section.questions) {
		const e = validateAnswer(q, answers[q.key]);
		if (e) out[q.key] = e;
	}
	return out;
}

/** Video link check: Loom / YouTube / Vimeo / Google Drive / direct mp4-webm. */
export function isVideoLink(s: string): boolean {
	return /^https?:\/\/(www\.)?(loom\.com\/share\/|youtu\.be\/|youtube\.com\/(watch\?v=|shorts\/)|vimeo\.com\/|drive\.google\.com\/file\/d\/)/.test(s) || /\.(mp4|webm|mov)(\?|$)/i.test(s);
}

/**
 * Builds a role's application from the default config + an AI/admin draft:
 * screening questions replace the default screening section's role-specific
 * ones (the knockout basics stay), skills + honeypots replace the skills
 * section (honeypots shuffled in so they read like any other skill),
 * challenges replace the challenge section. Scoring categories ride on the
 * config for H4 (`scoring`).
 */
export function mergeDraftIntoConfig(
	base: ApplicationConfig,
	draft: { screening?: { key: string; type: string; label: string; required?: boolean; options?: string[] }[]; skills?: { key: string; label: string }[]; honeypots?: { key: string; label: string }[]; challenges?: { key: string; label: string; time_limit_s?: number }[]; scoring?: { key: string; label: string; description?: string; weight: number }[] },
	seed = 7,
): ApplicationConfig & { scoring?: { key: string; label: string; description?: string; weight: number }[] } {
	const sections = base.sections.map((s) => ({ ...s, questions: [...s.questions] }));
	const used = new Set(sections.flatMap((s) => s.questions.map((q) => q.key)));
	const uniq = (k: string) => {
		let key = k;
		let i = 2;
		while (used.has(key)) key = `${k}_${i++}`;
		used.add(key);
		return key;
	};
	if (draft.screening?.length) {
		const s = sections.find((x) => x.kind === 'screening');
		if (s) {
			const keep = s.questions.filter((q) => ['years_experience', 'hours_ok', 'dedicated', 'start_within', 'comp_expectation', 'why_us'].includes(q.key));
			const add = draft.screening
				.filter((q) => !keep.some((k) => k.key === q.key))
				.map((q) => ({ key: uniq(q.key), type: (q.type as QuestionType) ?? 'short_text', label: q.label, required: q.required ?? true, paste: (q.type === 'long_text' ? 'track' : 'allow') as PasteMode, options: q.options, max_chars: q.type === 'long_text' ? 1500 : 200 }));
			s.questions = [...keep, ...add];
		}
	}
	if (draft.skills?.length || draft.honeypots?.length) {
		const s = sections.find((x) => x.kind === 'skills');
		if (s) {
			for (const q of s.questions) used.delete(q.key);
			const real = (draft.skills ?? []).map((k) => ({ key: uniq(k.key), type: 'rating_1_5' as QuestionType, label: k.label, required: true, paste: 'allow' as PasteMode }));
			const fake = (draft.honeypots ?? []).map((k) => ({ key: uniq(k.key), type: 'rating_1_5' as QuestionType, label: k.label, required: true, paste: 'allow' as PasteMode, honeypot: true, honeypot_threshold: 3 }));
			// deterministic interleave: a honeypot after every ~2-3 real skills
			const out: AppQuestion[] = [];
			let fi = 0;
			real.forEach((q, i) => {
				out.push(q);
				if (fi < fake.length && (i + seed) % 3 === 1) out.push(fake[fi++]);
			});
			while (fi < fake.length) out.splice(Math.max(1, out.length - 1), 0, fake[fi++]);
			s.questions = out.length ? out : s.questions;
		}
	}
	if (draft.challenges?.length) {
		const s = sections.find((x) => x.kind === 'challenge');
		if (s) {
			for (const q of s.questions) used.delete(q.key);
			s.questions = draft.challenges.map((c) => ({ key: uniq(c.key), type: 'timed_text' as QuestionType, label: c.label, required: true, paste: 'block' as PasteMode, time_limit_s: Math.max(30, c.time_limit_s ?? 180), max_chars: 2000 }));
		}
	}
	return { ...base, version: 2, sections, ...(draft.scoring?.length ? { scoring: draft.scoring } : {}) };
}

/** Honeypot hits in a submitted answer set, per the config. */
export function honeypotHits(cfg: ApplicationConfig, answers: AnswerMap): { key: string; label: string; value: number }[] {
	return allQuestions(cfg)
		.filter((q) => q.honeypot && q.type === 'rating_1_5')
		.map((q) => ({ key: q.key, label: q.label, value: Number(answers[q.key]?.value ?? 0) }))
		.filter((h) => h.value >= 3);
}

/**
 * Cheap, local AI-text heuristic (H4 adds the model-based score). Looks at
 * burstiness, vocabulary and the usual LLM tells. Returns 0..1 likelihood.
 */
export function aiTextHeuristic(text: string): number {
	const t = text.trim();
	if (t.length < 200) return 0;
	const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
	if (sentences.length < 3) return 0;
	const lens = sentences.map((s) => s.split(/\s+/).length);
	const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
	const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
	const burstiness = mean ? sd / mean : 0; // humans ~0.5+, LLMs ~0.2-0.35
	const words = t.toLowerCase().match(/[a-z']+/g) ?? [];
	const uniq = new Set(words).size / Math.max(1, words.length);
	const tells = (t.match(/\b(delve|leverage|robust|seamless|furthermore|moreover|additionally|in today's|it is important to note|as an? (?:ai|language model)|holistic|synerg|utilize|comprehensive|dynamic|fast-paced environment|i am (?:passionate|excited) about)\b/gi) ?? []).length;
	const contractions = (t.match(/\b\w+'(?:t|s|re|ve|ll|d|m)\b/gi) ?? []).length;
	const typos = (t.match(/\s{2,}|\b(teh|recieve|definately|seperate|occured)\b/gi) ?? []).length;
	let score = 0.3;
	if (burstiness < 0.3) score += 0.25;
	else if (burstiness > 0.55) score -= 0.15;
	score += Math.min(0.3, tells * 0.06);
	if (uniq > 0.75 && words.length > 120) score += 0.1;
	if (contractions === 0 && words.length > 80) score += 0.1;
	else if (contractions >= 3) score -= 0.1;
	if (typos > 0) score -= 0.1;
	return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}
