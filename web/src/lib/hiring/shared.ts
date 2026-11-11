// Hiring module (Talent Engine, 0128+) vocabulary. No server imports: the
// client forms, the server readers and the actions all read from here so
// labels and allowlists never drift from the SQL CHECKs.

export const HIRING_PATH = '/hiring';
export const HIRING_ADMIN_PATH = '/admin/hiring';

export const HIRE_BRANDS = ['main', 'premium', 'beacon'] as const;
export type HireBrand = (typeof HIRE_BRANDS)[number];
export const HIRE_BRAND_LABELS: Record<HireBrand, string> = { main: 'Main', premium: 'Premium', beacon: 'Beacon' };

export const POSITION_STATUSES = ['draft', 'pending_approval', 'approved', 'open', 'paused', 'closed', 'filled'] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];
export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
	draft: 'Draft',
	pending_approval: 'Awaiting approval',
	approved: 'Approved',
	open: 'Open',
	paused: 'Paused',
	closed: 'Closed',
	filled: 'Filled',
};
export const POSITION_STATUS_COLORS: Record<PositionStatus, 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'> = {
	draft: 'default',
	pending_approval: 'warning',
	approved: 'primary',
	open: 'success',
	paused: 'warning',
	closed: 'default',
	filled: 'accent',
};

/** Manual transitions the UI offers from each status (the SQL guard decides). */
export const POSITION_NEXT: Record<PositionStatus, PositionStatus[]> = {
	draft: [],
	pending_approval: [],
	approved: ['open'],
	open: ['paused', 'closed', 'filled'],
	paused: ['open', 'closed'],
	closed: ['open'],
	filled: [],
};

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
	full_time: 'Full-time',
	part_time: 'Part-time',
	contractor: 'Contractor (1099)',
	intern: 'Intern',
};

export const LOCATION_TYPES = ['remote', 'hybrid', 'onsite'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

export interface PayLevelRow {
	slug: string;
	label: string;
	sort: number;
	steps: number;
	base_pct: number;
	review_weeks: number;
	position_track: string | null;
	is_active: boolean;
	notes: string | null;
}

export interface PayProgression {
	start_per_multiplier: number;
	first_step_factor: number;
	step_factor: number;
	target_over_base: number;
	multiplier_min: number;
	multiplier_max: number;
}

export const DEFAULT_PROGRESSION: PayProgression = {
	start_per_multiplier: 100,
	first_step_factor: 1.05,
	step_factor: 1.04,
	target_over_base: 1.2,
	multiplier_min: 6,
	multiplier_max: 38,
};

export interface PayFigures {
	monthly_target_cents: number;
	monthly_base_cents: number;
	monthly_performance_cents: number;
	annual_target_cents: number;
	global_step: number;
}

/**
 * Mirror of `hire_pay_target()` (0128) so the builder can show figures live
 * while the admin picks multiplier x level x step. The SQL function is the
 * source of truth at save time (the comp trigger recomputes).
 */
export function payTarget(multiplier: number, level: string, step: number, levels: readonly PayLevelRow[], cfg: PayProgression = DEFAULT_PROGRESSION): PayFigures | null {
	const row = levels.find((l) => l.slug === level);
	if (!row || !Number.isFinite(multiplier) || multiplier <= 0) return null;
	if (step < 1 || step > row.steps) return null;
	const below = levels.filter((l) => l.is_active && l.sort < row.sort).reduce((n, l) => n + l.steps, 0);
	const idx = below + (step - 1);
	const start = multiplier * cfg.start_per_multiplier;
	const monthly = Math.round(start * cfg.first_step_factor * Math.pow(cfg.step_factor, idx));
	const base = Math.round((monthly * row.base_pct) / 100);
	return {
		monthly_target_cents: monthly * 100,
		monthly_base_cents: base * 100,
		monthly_performance_cents: (monthly - base) * 100,
		annual_target_cents: monthly * 1200,
		global_step: idx,
	};
}

export function usd(cents: number | null | undefined): string {
	if (cents == null) return '—';
	return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Position slug from a title: lower, dashes, trimmed, max 60. */
export function slugify(title: string): string {
	const s = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/g, '');
	return /^[a-z0-9]/.test(s) ? s : `role-${s}`.slice(0, 60);
}

// ---------------------------------------------------------------- 4R text

export interface FourRText {
	position_label: string;
	department: string | null;
	reports_to: string | null;
	role_md: string;
	responsibilities_md: string;
	results_md: string;
	requirements_md: string;
}

const SECTION_HEADS: Record<keyof Pick<FourRText, 'role_md' | 'responsibilities_md' | 'results_md' | 'requirements_md'>, RegExp> = {
	role_md: /^\s*(?:#+\s*)?(?:\d+\.\s*)?role\s*:?\s*$/i,
	responsibilities_md: /^\s*(?:#+\s*)?(?:\d+\.\s*)?responsibilities\s*:?\s*$/i,
	results_md: /^\s*(?:#+\s*)?(?:\d+\.\s*)?results\s*:?\s*$/i,
	requirements_md: /^\s*(?:#+\s*)?(?:\d+\.\s*)?requirements\s*:?\s*$/i,
};
const STOP_HEADS = /^\s*(?:#+\s*)?(?:remuneration(?:\s*&\s*rewards)?|about us|compensation|benefits|pay|schedule|how to apply)\s*:?\s*$/i;

/**
 * Parses a 4R document exported as plain text (Google Docs → txt, or a
 * paste) into the four sections. Handles the Open Ronin layout: "Position:" and
 * "Reports to:" lines, an "About Us" block (dropped), then Role /
 * Responsibilities / Results / Requirements, and a trailing Remuneration
 * block (dropped, it is the offer, not the job). Bullets ("*", "•", "-",
 * "○") normalise to "- ". Personal names in the Position / Reports to lines
 * are left to the reviewer: the importer shows them before saving.
 */
export function parseFourRText(raw: string): FourRText {
	const lines = raw.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n');
	const out: FourRText = { position_label: '', department: null, reports_to: null, role_md: '', responsibilities_md: '', results_md: '', requirements_md: '' };
	let current: keyof typeof SECTION_HEADS | null = null;
	const buf: Record<string, string[]> = { role_md: [], responsibilities_md: [], results_md: [], requirements_md: [] };
	for (const line of lines) {
		const t = line.trim();
		const pos = /^position\s*:\s*(.+)$/i.exec(t);
		if (pos && !out.position_label) {
			out.position_label = pos[1].trim();
			continue;
		}
		const rep = /^reports?\s+to\s*:\s*(.+)$/i.exec(t);
		if (rep && !out.reports_to) {
			out.reports_to = rep[1].trim();
			continue;
		}
		const dep = /^department\s*:\s*(.+)$/i.exec(t);
		if (dep && !out.department) {
			out.department = dep[1].trim();
			continue;
		}
		let matched = false;
		for (const key of Object.keys(SECTION_HEADS) as (keyof typeof SECTION_HEADS)[]) {
			if (SECTION_HEADS[key].test(t)) {
				current = key;
				matched = true;
				break;
			}
		}
		if (matched) continue;
		if (STOP_HEADS.test(t)) {
			current = null;
			continue;
		}
		if (!current) continue;
		if (!t) {
			if (buf[current].length && buf[current][buf[current].length - 1] !== '') buf[current].push('');
			continue;
		}
		if (/^_{5,}$/.test(t)) continue;
		const bullet = /^(?:[*•○▪\-–]|\d+[.)])\s+(.*)$/.exec(t);
		buf[current].push(bullet ? `- ${bullet[1].trim()}` : t);
	}
	for (const key of Object.keys(buf) as (keyof typeof SECTION_HEADS)[]) {
		out[key] = buf[key].join('\n').replace(/\n{3,}/g, '\n\n').trim();
	}
	return out;
}

/** A parsed 4R is usable when the four sections all have text. */
export function fourRComplete(t: Pick<FourRText, 'role_md' | 'responsibilities_md' | 'results_md' | 'requirements_md'>): boolean {
	return [t.role_md, t.responsibilities_md, t.results_md, t.requirements_md].every((s) => s.trim().length > 0);
}

/** Template slug from a Drive doc name: "4R - Media Specialist.docx" → media-specialist. */
export function templateSlugFromDocName(name: string): string {
	return slugify(
		name
			.replace(/\.docx?$/i, '')
			.replace(/^4r\s*[-–:]?\s*/i, '')
			.replace(/\((?:for review(?: and approval)?|new|\d)\)/gi, '')
			.replace(/\s*[-–]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*$/, (m) => (/(specialist|manager|assistant|coordinator|designer|developer|lead|analyst|writer|publicist|intern|executive|director|operator|seo|qa|ea)$/i.test(m) ? m : ''))
			.trim(),
	);
}

// ---------------------------------------------------------------- posting

export interface BrandProfile {
	brand: HireBrand;
	label: string;
	about_us_md: string;
	remuneration_md: string;
	careers_intro_md: string;
	website: string | null;
}

/**
 * The posting body in Alex's LinkedIn order (round 3): Compensation line →
 * About Us → Role → Responsibilities → Results → Requirements, then the
 * brand's Remuneration & Rewards block. Markdown.
 */
export function renderPosting(p: { title: string; compensation_statement: string | null; about_us_override_md: string | null } & Pick<FourRText, 'role_md' | 'responsibilities_md' | 'results_md' | 'requirements_md'>, brand: BrandProfile | null): string {
	const parts: string[] = [`# ${p.title}`];
	if (p.compensation_statement?.trim()) parts.push(`**Compensation:** ${p.compensation_statement.trim()}`);
	const about = p.about_us_override_md?.trim() || brand?.about_us_md?.trim();
	if (about) parts.push(`## About Us\n\n${about}`);
	if (p.role_md.trim()) parts.push(`## Role\n\n${p.role_md.trim()}`);
	if (p.responsibilities_md.trim()) parts.push(`## Responsibilities\n\n${p.responsibilities_md.trim()}`);
	if (p.results_md.trim()) parts.push(`## Results\n\n${p.results_md.trim()}`);
	if (p.requirements_md.trim()) parts.push(`## Requirements\n\n${p.requirements_md.trim()}`);
	if (brand?.remuneration_md?.trim()) parts.push(`## Remuneration & Rewards\n\n${brand.remuneration_md.trim()}`);
	return parts.join('\n\n');
}

// ---------------------------------------------------------------- request

/** staff_requests.payload for kind position_request (0128). */
export interface PositionRequestPayload {
	role_title: string;
	brand?: HireBrand;
	department?: string | null;
	employment_type?: EmploymentType;
	headcount?: number;
	hiring_manager_id?: string | null;
	target_start_on?: string | null;
	pay_level?: string | null;
	pay_multiplier?: string | null;
	posting_budget_usd?: string | null;
	position_id?: string | null;
}

export function positionRequestSummary(p: PositionRequestPayload, levels: readonly PayLevelRow[] = []): string {
	const parts = [
		`${p.headcount ?? 1}× ${p.role_title}`,
		p.brand ? HIRE_BRAND_LABELS[p.brand] : null,
		p.employment_type ? EMPLOYMENT_TYPE_LABELS[p.employment_type] : null,
		p.department || null,
	];
	if (p.pay_level && p.pay_multiplier) {
		const f = payTarget(Number(p.pay_multiplier), p.pay_level, 1, levels);
		parts.push(f ? `${p.pay_level} × ${p.pay_multiplier} = ${usd(f.monthly_target_cents)}/mo (${usd(f.annual_target_cents)}/yr)` : `${p.pay_level} × ${p.pay_multiplier}`);
	}
	if (p.posting_budget_usd) parts.push(`posting $${p.posting_budget_usd}`);
	if (p.target_start_on) parts.push(`from ${p.target_start_on}`);
	return parts.filter(Boolean).join(' · ');
}
