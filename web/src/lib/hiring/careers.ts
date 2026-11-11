// Careers + posting vocabulary (0129, H2). No server imports.

import type { BrandProfile, EmploymentType, FourRText, HireBrand, LocationType } from './shared';
import { renderPosting } from './shared';

export const CAREERS_PATH = '/careers';

export interface BoardRow {
	key: string;
	label: string;
	kind: 'auto' | 'manual' | 'adapter';
	enabled: boolean;
	sort: number;
	post_url: string | null;
	format_hint: string | null;
	max_chars: number | null;
	cost_note: string | null;
	default_days: number;
	regions: string[];
	config: Record<string, unknown>;
}

export const POSTING_STATUSES = ['planned', 'posted', 'live', 'expired', 'closed'] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];
export const POSTING_STATUS_LABELS: Record<PostingStatus, string> = { planned: 'Planned', posted: 'Posted', live: 'Live', expired: 'Expired', closed: 'Closed' };
export const POSTING_STATUS_COLORS: Record<PostingStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = { planned: 'default', posted: 'primary', live: 'success', expired: 'warning', closed: 'default' };

export interface PostingRow {
	id: string;
	position_id: string;
	board_key: string;
	status: PostingStatus;
	formatted_text: string | null;
	formatted_by: string | null;
	live_url: string | null;
	external_id: string | null;
	posted_at: string | null;
	expires_at: string | null;
	closed_at: string | null;
	cost_cents: number | null;
	notes: string | null;
	updated_at: string;
}

export interface LinkRow {
	code: string;
	position_id: string;
	source: string;
	board_key: string | null;
	referrer_user_id: string | null;
	label: string | null;
	hits: number;
	last_hit_at: string | null;
	is_active: boolean;
}

/** The public position shape the careers page, JSON-LD and feed read. */
export interface PublicPosition extends FourRText {
	id: string;
	slug: string;
	title: string;
	brand: HireBrand;
	department_label: string | null;
	employment_type: EmploymentType;
	location_type: LocationType;
	location_text: string | null;
	timezone_note: string | null;
	compensation_statement: string | null;
	show_pay_range: boolean;
	about_us_override_md: string | null;
	opened_at: string | null;
	updated_at: string;
	pay_range_min_cents?: number | null;
	pay_range_max_cents?: number | null;
}

export function applyUrl(appUrl: string, slug: string, code?: string | null): string {
	return code ? `${appUrl}/careers/go/${code}` : `${appUrl}/careers/${slug}`;
}

const EMPLOYMENT_SCHEMA: Record<EmploymentType, string> = { full_time: 'FULL_TIME', part_time: 'PART_TIME', contractor: 'CONTRACTOR', intern: 'INTERN' };

/**
 * schema.org JobPosting for Google Jobs (round 3: free reach). validThrough =
 * opened + 60 days (refreshed on every render while the role is open).
 * Salary only when the role opted in (show_pay_range) and a range exists.
 */
export function jobPostingJsonLd(p: PublicPosition, brand: BrandProfile | null, appUrl: string): Record<string, unknown> {
	const opened = p.opened_at ? new Date(p.opened_at) : new Date(p.updated_at);
	const valid = new Date(Math.max(Date.now(), opened.getTime()) + 60 * 86_400_000);
	const org = { '@type': 'Organization', name: brand?.label ?? 'Open Ronin', sameAs: brand?.website ?? 'https://example.com' };
	const out: Record<string, unknown> = {
		'@context': 'https://schema.org/',
		'@type': 'JobPosting',
		title: p.title,
		description: mdToHtmlLite(renderPosting({ title: p.title, compensation_statement: p.compensation_statement, about_us_override_md: p.about_us_override_md, role_md: p.role_md, responsibilities_md: p.responsibilities_md, results_md: p.results_md, requirements_md: p.requirements_md }, brand).replace(/^# .*\n+/, '')),
		identifier: { '@type': 'PropertyValue', name: org.name, value: p.slug },
		datePosted: opened.toISOString().slice(0, 10),
		validThrough: valid.toISOString(),
		employmentType: EMPLOYMENT_SCHEMA[p.employment_type],
		hiringOrganization: org,
		directApply: true,
		url: applyUrl(appUrl, p.slug),
	};
	if (p.location_type === 'remote') {
		out.jobLocationType = 'TELECOMMUTE';
		out.applicantLocationRequirements = { '@type': 'Country', name: p.location_text || 'Worldwide' };
	} else {
		out.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: p.location_text || 'HQ', addressRegion: 'TN', addressCountry: 'US' } };
	}
	if (p.show_pay_range && p.pay_range_min_cents && p.pay_range_max_cents) {
		out.baseSalary = { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: p.pay_range_min_cents / 100, maxValue: p.pay_range_max_cents / 100, unitText: 'MONTH' } };
	}
	return out;
}

/** Tiny markdown → HTML (headings, bullets, paragraphs, bold) for descriptions and feeds. */
export function mdToHtmlLite(md: string): string {
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	const lines = md.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const l = lines[i];
		if (/^##\s/.test(l)) out.push(`<h3>${inline(l.slice(3))}</h3>`);
		else if (/^#\s/.test(l)) out.push(`<h2>${inline(l.slice(2))}</h2>`);
		else if (/^\s*[-*]\s/.test(l)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s/, ''))}</li>`);
			out.push(`<ul>${items.join('')}</ul>`);
			continue;
		} else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
		i++;
	}
	return out.join('\n');
}

/**
 * Indeed-style XML feed the aggregators (Jooble, Adzuna, Talent.com,
 * Careerjet) accept. One <job> per open role; description is HTML in CDATA.
 */
export function jobsFeedXml(positions: PublicPosition[], brands: BrandProfile[], appUrl: string): string {
	const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
	const jobs = positions
		.map((p) => {
			const brand = brands.find((b) => b.brand === p.brand) ?? null;
			const body = mdToHtmlLite(renderPosting({ title: p.title, compensation_statement: p.compensation_statement, about_us_override_md: p.about_us_override_md, role_md: p.role_md, responsibilities_md: p.responsibilities_md, results_md: p.results_md, requirements_md: p.requirements_md }, brand).replace(/^# .*\n+/, ''));
			const date = new Date(p.opened_at ?? p.updated_at).toUTCString();
			return [
				'  <job>',
				`    <title>${cdata(p.title)}</title>`,
				`    <date>${cdata(date)}</date>`,
				`    <referencenumber>${cdata(p.slug)}</referencenumber>`,
				`    <url>${cdata(applyUrl(appUrl, p.slug, `${p.slug}-xml`))}</url>`,
				`    <company>${cdata(brand?.label ?? 'Open Ronin')}</company>`,
				`    <city>${cdata(p.location_type === 'remote' ? 'Remote' : p.location_text || 'HQ')}</city>`,
				`    <state>${cdata(p.location_type === 'remote' ? '' : 'TN')}</state>`,
				`    <country>${cdata(p.location_type === 'remote' ? (p.location_text || 'Worldwide') : 'US')}</country>`,
				`    <description>${cdata(body)}</description>`,
				`    <jobtype>${cdata(p.employment_type.replace('_', '-'))}</jobtype>`,
				`    <category>${cdata(p.department_label ?? '')}</category>`,
				p.show_pay_range && p.pay_range_min_cents && p.pay_range_max_cents ? `    <salary>${cdata(`$${p.pay_range_min_cents / 100}-$${p.pay_range_max_cents / 100} per month`)}</salary>` : '',
				p.compensation_statement ? `    <compensation>${cdata(p.compensation_statement)}</compensation>` : '',
				'  </job>',
			]
				.filter(Boolean)
				.join('\n');
		})
		.join('\n');
	return `<?xml version="1.0" encoding="utf-8"?>\n<source>\n  <publisher>Open Ronin</publisher>\n  <publisherurl>${appUrl}/careers</publisherurl>\n  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${jobs}\n</source>\n`;
}

/** Deterministic board link code: <slug>-<board>. */
export function boardLinkCode(slug: string, boardKey: string): string {
	return `${slug.slice(0, 30)}-${boardKey.replace(/_/g, '')}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 44);
}

/**
 * Template post text per board when no AI provider is configured: the 4R in
 * the LinkedIn order, trimmed to the board's max, with the tracked link at
 * the end. The AI path (lib/hiring/ai.ts) rewrites in the board's format_hint.
 */
export function templatePostText(p: PublicPosition, brand: BrandProfile | null, board: BoardRow, applyLink: string): string {
	const about = (p.about_us_override_md || brand?.about_us_md || '').split('\n\n')[0] ?? '';
	const bullets = (s: string, n: number) =>
		s
			.split('\n')
			.filter((l) => l.trim().startsWith('- '))
			.slice(0, n)
			.map((l) => `• ${l.replace(/^\s*-\s*/, '').replace(/\*\*/g, '')}`)
			.join('\n');
	const parts = [
		`${p.title} — ${brand?.label ?? 'Open Ronin'}${p.location_type === 'remote' ? ' (Remote)' : p.location_text ? ` (${p.location_text})` : ''}`,
		p.compensation_statement ? `Compensation: ${p.compensation_statement}` : '',
		about,
		`The role\n${p.role_md.replace(/\*\*/g, '').trim()}`,
		`What you'll do\n${bullets(p.responsibilities_md, board.key === 'linkedin' ? 7 : 12)}`,
		`What success looks like\n${bullets(p.results_md, 6)}`,
		`What we're looking for\n${bullets(p.requirements_md, 10)}`,
		board.key === 'onlinejobs' ? `Hours: ${p.employment_type === 'full_time' ? 'Full time (40h/wk)' : p.employment_type.replace('_', ' ')}${p.timezone_note ? ` · ${p.timezone_note}` : ''}` : '',
		`Apply: ${applyLink}`,
	].filter(Boolean);
	let text = parts.join('\n\n');
	if (board.max_chars && text.length > board.max_chars) {
		const tail = `\n\nApply: ${applyLink}`;
		text = text.slice(0, board.max_chars - tail.length - 1).replace(/\s+\S*$/, '') + '…' + tail;
	}
	return text;
}
