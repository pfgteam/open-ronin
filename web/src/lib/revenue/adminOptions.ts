// Admin → Prospects (spec 2026-10-19-prospects-admin-design.md): the option
// lists, validators and mappings behind the structured inputs that replaced
// free text and raw JSON. Pure — no React, no Supabase — so every rule is
// tested. Valid sets come from the schema and the SQL that consumes them
// (cited per list); nothing here invents a value the backend cannot read.

import { BUDGET_BANDS, BUDGET_BAND_LABELS, FIT_SIGNAL_FIELDS } from './shared';

type Opt = { value: string; label: string };

/** rev_stages.required_fields — deal columns the stage guard (0121:558) checks; a non-column would fail every move. */
export const REQUIRED_FIELD_OPTIONS: Opt[] = [
	{ value: 'est_mrr_cents', label: 'Monthly value' },
	{ value: 'est_one_time_cents', label: 'One-time value' },
	{ value: 'owner_lg_id', label: 'Lead-gen owner' },
	{ value: 'owner_setter_id', label: 'Setter' },
	{ value: 'owner_closer_id', label: 'Closer' },
	{ value: 'product_ids', label: 'Products' },
	{ value: 'budget_band', label: 'Budget' },
	{ value: 'timing', label: 'Timing' },
	{ value: 'next_action_at', label: 'Next action date' },
	{ value: 'lost_reason', label: 'Lost reason' },
];

/** rev_dispositions.counts_as buckets read by rev_daily_metrics / heat (0124:146-152, 0122:282-289). 'dial' is never read. */
export const COUNTS_AS_OPTIONS: Opt[] = [
	{ value: 'answer', label: 'Answer' },
	{ value: 'conversation', label: 'Conversation' },
	{ value: 'set', label: 'Set' },
	{ value: 'show', label: 'Show' },
	{ value: 'no_show', label: 'No-show' },
	{ value: 'offer', label: 'Offer' },
	{ value: 'close', label: 'Close' },
];
export const LEGACY_COUNTS_AS = ['dial'];

export type IntakeKeyGroup = { group: string; keys: Opt[] };

/** Keys rev_intake / rev_map_payload understand (0121:848, 0122:643-704). */
export const INTAKE_KEY_GROUPS: IntakeKeyGroup[] = [
	{
		group: 'Person',
		keys: [
			{ value: 'display_name', label: 'Full name' },
			{ value: 'first_name', label: 'First name' },
			{ value: 'last_name', label: 'Last name' },
			{ value: 'email', label: 'Email' },
			{ value: 'phone', label: 'Phone' },
			{ value: 'title', label: 'Job title' },
			{ value: 'linkedin_url', label: 'LinkedIn URL' },
			{ value: 'instagram', label: 'Instagram' },
			{ value: 'location', label: 'Location' },
			{ value: 'notes', label: 'Notes' },
			{ value: 'person_role', label: 'Role at the brand' },
		],
	},
	{
		group: 'Brand',
		keys: [
			{ value: 'brand_name', label: 'Brand name' },
			{ value: 'brand_website', label: 'Brand website' },
			{ value: 'website', label: 'Website' },
			{ value: 'company_name', label: 'Company name' },
			{ value: 'company_website', label: 'Company website' },
			{ value: 'industry', label: 'Industry' },
			{ value: 'vertical', label: 'Vertical' },
		],
	},
	{
		group: 'Deal',
		keys: [
			{ value: 'pipeline', label: 'Pipeline' },
			{ value: 'stage', label: 'Stage' },
			{ value: 'source', label: 'Source' },
			{ value: 'channel', label: 'Channel' },
			{ value: 'campaign', label: 'Campaign' },
			{ value: 'motion', label: 'Motion' },
			{ value: 'owner_email', label: 'Owner email' },
			{ value: 'est_mrr_cents', label: 'Monthly value (cents)' },
			{ value: 'est_one_time_cents', label: 'One-time value (cents)' },
			{ value: 'product_slugs', label: 'Products' },
		],
	},
	{
		group: 'Fit signals',
		keys: [
			...FIT_SIGNAL_FIELDS.map((f) => ({ value: `fit.${f.key}`, label: f.label })),
			{ value: 'fit.budget_band', label: 'Budget band' },
			{ value: 'fit.timing', label: 'Timing' },
		],
	},
	{
		group: 'Activity',
		keys: [
			{ value: 'activity.is_positive', label: 'Positive reply' },
			{ value: 'activity.body_md', label: 'Message / notes' },
			{ value: 'activity.subject', label: 'Subject' },
		],
	},
];

const KNOWN_KEYS = new Set(INTAKE_KEY_GROUPS.flatMap((g) => g.keys.map((k) => k.value)));

export function isIntakeKey(k: string): boolean {
	if (k === 'external_id' || KNOWN_KEYS.has(k)) return true;
	return /^(activity|meta)\.[a-z][a-z0-9_]*$/.test(k);
}

/** Everything rev_daily_metrics emits (0124:145-204) plus metrics derived in the app (metrics.ts DERIVED_METRICS). */
export const TRACKED_METRICS: Opt[] = [
	{ value: 'dials', label: 'Dials' },
	{ value: 'answers', label: 'Answers' },
	{ value: 'conversations', label: 'Conversations' },
	{ value: 'sets', label: 'Sets' },
	{ value: 'shows', label: 'Shows' },
	{ value: 'no_shows', label: 'No-shows' },
	{ value: 'follow_ups', label: 'Follow-ups' },
	{ value: 'dms', label: 'DMs' },
	{ value: 'sends', label: 'Sends' },
	{ value: 'emails_sent', label: 'Emails' },
	{ value: 'replies', label: 'Replies' },
	{ value: 'positive_replies', label: 'Positive replies' },
	{ value: 'meetings', label: 'Meetings' },
	{ value: 'new_leads', label: 'New leads' },
	{ value: 'handoffs', label: 'Hand-offs' },
	{ value: 'discovery_booked', label: 'Discovery booked' },
	{ value: 'discovery_taken', label: 'Discovery taken' },
	{ value: 'sales_booked', label: 'Sales calls booked' },
	{ value: 'sales_taken', label: 'Sales calls taken' },
	{ value: 'offers', label: 'Offers' },
	{ value: 'offers_sent', label: 'Offers sent' },
	{ value: 'contracts_sent', label: 'Contracts sent' },
	{ value: 'agreements_signed', label: 'Agreements signed' },
	{ value: 'closes', label: 'Closes' },
	{ value: 'won', label: 'Won' },
];

/** ghl_cutover keys that change behaviour (ghlSync.ts:116,235,304); the rest are informational. */
export const CUTOVER_SWITCHES = ['push_prospects', 'accept_ghl_stage_changes'] as const;

export type AdminSection = 'pipelines' | 'catalog' | 'scoring' | 'integrations' | 'team' | 'duplicates';
export const ADMIN_SECTIONS: { key: AdminSection; label: string; description: string }[] = [
	{ key: 'pipelines', label: 'Pipelines', description: 'Stages, SLAs, hand-offs and call outcomes' },
	{ key: 'catalog', label: 'Catalog', description: 'Products and prices' },
	{ key: 'scoring', label: 'Scoring & routing', description: 'Quality and Heat, MQL forms, call rubrics' },
	{ key: 'integrations', label: 'Integrations', description: 'GoHighLevel, connectors, Lead Scraper' },
	{ key: 'team', label: 'Team & targets', description: 'Lanes, daily targets, queue priorities' },
	{ key: 'duplicates', label: 'Duplicates', description: 'People to merge or dismiss' },
];

const TAB_SECTION: Record<string, AdminSection> = {
	pipelines: 'pipelines',
	dispositions: 'pipelines',
	products: 'catalog',
	templates: 'catalog',
	scoring: 'scoring',
	forms: 'scoring',
	rubrics: 'scoring',
	connectors: 'integrations',
	ghl: 'integrations',
	team: 'team',
	duplicates: 'duplicates',
};

/** Old /admin/prospects?tab= links → the section that now holds that content. */
export function sectionForTab(tab: string | undefined): AdminSection {
	return (tab && TAB_SECTION[tab]) || 'pipelines';
}

/** rev_budget_tier (0122:153): tier N = BUDGET_BANDS[N-1]. */
export function tierOptions(): Opt[] {
	return BUDGET_BANDS.map((b, i) => ({ value: String(i + 1), label: `Tier ${i + 1} · ${BUDGET_BAND_LABELS[b]}` }));
}

export function isKnownPipeline(slug: string | null | undefined, activeSlugs: string[]): boolean {
	return !!slug && activeSlugs.includes(slug);
}

export function isValidDomain(d: string): boolean {
	return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(d.trim());
}

export function isHttpUrl(u: string): boolean {
	try {
		const p = new URL(u.trim());
		return p.protocol === 'https:' || p.protocol === 'http:';
	} catch {
		return false;
	}
}

export type ScoringKind = 'number' | 'list';

export function scoringKind(value: unknown): ScoringKind {
	return Array.isArray(value) ? 'list' : 'number';
}

/** One rev_scoring_config value. Numbers never turn into arrays (rev_cfg_num would silently fall back to its default). */
export function parseScoringValue(kind: ScoringKind, raw: unknown): { ok: true; value: number | string[] } | { ok: false; error: string } {
	if (kind === 'list') {
		if (!Array.isArray(raw)) return { ok: false, error: 'Expected a list.' };
		return { ok: true, value: raw.map((x) => String(x).trim()).filter(Boolean) };
	}
	const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
	const n = Number(s);
	if (s === '' || !Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
	return { ok: true, value: n };
}

/** ghl_settings values. The opportunity suffix keeps its leading space ("Deal · Open Ronin"). */
export function normalizeGhlSetting(key: string, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
	if (key === 'opportunity_name_suffix') return { ok: true, value: raw };
	if (key === 'push_min_stage_slugs') {
		try {
			const v = JSON.parse(raw) as unknown;
			if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && /^[a-z0-9-]+$/.test(x))) return { ok: false, error: 'Pick stages from the list.' };
			return { ok: true, value: v };
		} catch {
			return { ok: false, error: 'Pick stages from the list.' };
		}
	}
	const v = raw.trim();
	if (key === 'app_base_url' && !isHttpUrl(v)) return { ok: false, error: 'Enter a full https:// URL.' };
	return { ok: true, value: v };
}

/** KeyValueRows → the JSON object the backend stores. Blank rows are ignored; a key without a value or a repeated key is an error. */
export function serializeRows(rows: { key: string; value: string }[]): { ok: true; map: Record<string, string> } | { ok: false; error: string } {
	const map: Record<string, string> = {};
	for (const r of rows) {
		const k = r.key.trim();
		const v = r.value.trim();
		if (!k && !v) continue;
		if (!k || !v) return { ok: false, error: `Every row needs both sides${k ? ` (${k})` : ''}.` };
		if (k in map) return { ok: false, error: `"${k}" is mapped twice.` };
		map[k] = v;
	}
	return { ok: true, map };
}

/** Rubric criteria preview — same regex as callActions.parseRubricCriteria (the server parse stays authoritative). */
export function parseCriteria(body: string): { criteria: { name: string; weight: number }[]; total: number } {
	const criteria: { name: string; weight: number }[] = [];
	const re = /^-\s+\*\*(.+?)\*\*\s*\((\d+(?:\.\d+)?)\)/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) criteria.push({ name: m[1].trim(), weight: Number(m[2]) });
	return { criteria, total: Math.round(criteria.reduce((n, c) => n + c.weight, 0) * 100) / 100 };
}

/** rev_scoring_config keys that hold string lists; every other key is a number (rev_cfg_num). Declared, so a weight the old bug stored as an array can be repaired. */
export const SCORING_LIST_KEYS = ['industry_fit', 'free_email_domains'];
export function scoringKindForKey(key: string): ScoringKind {
	return SCORING_LIST_KEYS.includes(key) ? 'list' : 'number';
}

export type RescoreState = { processed: number; failed: number; firstError: string | null; finished: boolean };
/** Fold one Rescore page into the running totals (progress counts every processed deal, failures included). */
export function rescoreProgress(prev: RescoreState | undefined, page: { done: number; failed: number; firstError: string | null; finished: boolean }): RescoreState {
	const p = prev ?? { processed: 0, failed: 0, firstError: null, finished: false };
	return { processed: p.processed + page.done + page.failed, failed: p.failed + page.failed, firstError: p.firstError ?? page.firstError, finished: page.finished };
}
