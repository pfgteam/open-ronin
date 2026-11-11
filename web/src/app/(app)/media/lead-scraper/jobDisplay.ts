// Display helpers shared by the page, the run bar and the All-runs popover.
//
// These lived inside page.tsx when the page was one file. The Apollo layout
// splits it into a rail and a results column, and the run bar plus its
// popover both need the same chip label, status tone and narrowing warnings —
// so they move here rather than being passed down or duplicated.
//
// Everything in this file is a pure function of a job row: it must stay
// importable from both server and client components (AllRunsPopover is
// 'use client').

export interface JobRow {
	id: string;
	status: string;
	/** 'lead' | 'media' | 'acquisition' (0060). */
	kind: string;
	max_results: number;
	params: Record<string, unknown>;
	preset: string;
	found: number;
	imported: number;
	duplicates: number;
	error: string | null;
	created_at: string;
	finished_at: string | null;
}

/** Statuses the state machine still has work for. Drives the auto-refresh and
 *  whether Cancel is offered. */
export const ACTIVE_STATUSES = ['queued', 'running', 'importing'] as const;

export function isActive(status: string): boolean {
	return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export const STATUS_TONE: Record<string, string> = {
	queued: 'bg-slate-400',
	running: 'bg-primary-500',
	importing: 'bg-primary-500',
	done: 'bg-green-500',
	failed: 'bg-red-500',
	cancelled: 'bg-slate-300 dark:bg-slate-600',
};

/** Apify returns actionable errors — most often "approve this Actor's
 *  permissions" — with a console URL inside the JSON body. Surfacing it as a
 *  link beats a truncated tooltip the operator cannot click. */
export function actionableUrl(error: string | null): string | null {
	const m = error?.match(/https:[/][/]console[.]apify[.]com[/][^\s"]+/);
	return m ? m[0] : null;
}

/** Title-case the actor's lowercase enum values for display. */
export const label = (v: string) => v.replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** True when the job is a pasted exhibitor list rather than a filtered B2B
 *  search — its whole targeting is a URL, so it reads differently everywhere. */
export function isTradeShow(params: Record<string, unknown>): boolean {
	return typeof params.url === 'string';
}

/** True for the acquisition preset (0060). Decided by the job's kind, which
 *  the database CHECKs, not by sniffing params. */
export function isAcquisition(job: Pick<JobRow, 'kind' | 'preset'>): boolean {
	return job.kind === 'acquisition' || job.preset === 'agency_owners';
}

/** The media preset name (0102) or null for lead/acquisition runs. */
export function mediaPreset(job: Pick<JobRow, 'preset'>): 'news_journalists' | 'email_waterfall' | 'outlet_crawl' | null {
	return job.preset === 'news_journalists' || job.preset === 'email_waterfall' || job.preset === 'outlet_crawl' ? job.preset : null;
}

/** Readback of a media job's params (NewsJournalistsParams,
 *  EmailWaterfallParams or OutletCrawlParams). */
function describeMediaParams(params: Record<string, unknown>): string | null {
	const arr = (k: string) => (Array.isArray(params[k]) ? (params[k] as unknown[]) : []);
	if (arr('queries').length) {
		const q = arr('queries').filter((x): x is string => typeof x === 'string');
		const parts = [q.join(' or ')];
		if (typeof params.freshnessDays === 'number') parts.push(`last ${params.freshnessDays}d`);
		if (typeof params.country === 'string') parts.push(params.country);
		return parts.join(' · ');
	}
	if (arr('people').length) {
		const n = arr('people').length;
		const first = arr('people')[0] as { firstName?: string; lastName?: string } | undefined;
		return `emails for ${n} ${n === 1 ? 'person' : 'people'}${first?.firstName ? ` (${first.firstName} ${first.lastName ?? ''}…)` : ''}`;
	}
	if (arr('websites').length) {
		const w = arr('websites').filter((x): x is string => typeof x === 'string');
		return `crawl ${w.length} ${w.length === 1 ? 'outlet' : 'outlets'}: ${w.slice(0, 3).join(', ')}${w.length > 3 ? '…' : ''}`;
	}
	return null;
}

/** Readback of an acquisition job's filters (AcquisitionParams shape). */
function describeAcquisitionParams(params: Record<string, unknown>): string {
	const arr = (k: string) => (Array.isArray(params[k]) ? (params[k] as string[]) : []);
	const parts: string[] = ['agency owners'];
	if (arr('services').length) parts.push(arr('services').join(' or '));
	const min = typeof params.employeeMin === 'number' ? params.employeeMin : undefined;
	const max = typeof params.employeeMax === 'number' ? params.employeeMax : undefined;
	if (min !== undefined || max !== undefined) parts.push(`${min ?? '1'}–${max ?? 'any'} staff`);
	if (arr('location').length) parts.push(`in ${arr('location').map(label).join(' or ')}`);
	if (arr('city').length) parts.push(`city ${arr('city').join(' or ')}`);
	if (typeof params.minYears === 'number' && params.minYears > 0) parts.push(`${params.minYears}+ yrs`);
	return parts.join(' · ');
}

/** Human-readable readback of a stored job's filters. When a run returns two
 *  leads, the reason has to be visible without opening the database. This is
 *  also the run chip's label. */
export function describeParams(params: Record<string, unknown>): string {
	// Trade-show jobs have no filters — the URL is the whole query.
	if (typeof params.url === 'string') {
		try {
			const u = new URL(params.url);
			return `${u.host.replace(/^www\./, '')}${u.pathname}`;
		} catch {
			return String(params.url);
		}
	}
	// Acquisition params carry keys no lead job writes.
	if ('services' in params || 'employeeMin' in params || 'titles' in params || 'minYears' in params) {
		return describeAcquisitionParams(params);
	}
	// Media params (0102): beats, people or websites.
	const media = describeMediaParams(params);
	if (media) return media;
	const arr = (k: string) => (Array.isArray(params[k]) ? (params[k] as string[]) : []);
	const parts: string[] = [];
	const push = (k: string, prefix = '') => {
		const v = arr(k);
		if (v.length) parts.push(`${prefix}${v.map(label).join(' or ')}`);
	};
	push('seniority');
	push('functionArea', 'in ');
	push('industry', 'at ');
	push('size', 'sized ');
	push('location', 'in ');
	if (arr('city').length) parts.push(`city ${arr('city').join(' or ')}`);
	if (arr('jobTitle').length) parts.push(`titled ${arr('jobTitle').join(' or ')}`);
	if (arr('keywords').length) parts.push(`keywords ${arr('keywords').join(' or ')}`);
	if (params.minRevenue || params.maxRevenue) {
		parts.push(`revenue ${params.minRevenue ?? 'any'}–${params.maxRevenue ?? 'any'}`);
	}
	return parts.join(' · ') || 'no filters';
}

/** A short chip label — the full sentence goes in the title attribute. */
export function shortLabel(params: Record<string, unknown>, max = 42): string {
	const full = describeParams(params);
	return full.length > max ? `${full.slice(0, max - 1).trimEnd()}…` : full;
}

/** Combinations that quietly collapse a result set to almost nothing. Shown as
 *  a warning, never a block — the operator may know something we do not. */
export function narrowingWarnings(params: Record<string, unknown>): string[] {
	if (typeof params.url === 'string') return [];
	const arr = (k: string) => (Array.isArray(params[k]) ? (params[k] as string[]) : []);
	const out: string[] = [];
	const founders = arr('seniority').some((s) => s === 'founder' || s === 'owner');
	if (founders && arr('functionArea').length) {
		out.push('Founder/Owner combined with a Function — founders are rarely tagged with one, so this pair excludes most of them.');
	}
	if (params.minRevenue || params.maxRevenue) {
		out.push('Revenue bounds drop every company whose revenue is unknown, which is a large share of the database.');
	}
	const single = ['seniority', 'industry', 'size', 'location'].filter((k) => arr(k).length === 1);
	if (single.length >= 3) {
		out.push(`${single.length} filters carry a single value each and combine with AND — widen the ones you do not care about.`);
	}
	return out;
}
