// Which Airtable bases the BaseExplorer may show to a plain Data-module
// holder, and which ones need people-management standing.
//
// Why this exists: /data lists the WHOLE workspace (200+ bases) straight from
// listBases(), and /api/airtable/records passed baseId through untouched. So
// anyone an admin granted the Data module to could read HR Directory,
// Personnel Tracker and Employee Onboarding — payroll- and review-adjacent
// bases that the /data UI never intended to surface as browsable operations
// data. The Data module is a browsing grant, not an HR grant.
//
// Pure on purpose: imported by both a route handler and server components.

import { BASE_IDS } from './index';

/**
 * Bases that carry personnel data. Reading these requires the same standing as
 * `profile_sensitive` (people-manager / exec / admin) — see
 * `@/lib/people/permissions`. Holding the `data` module alone is not enough.
 */
export const SENSITIVE_BASE_IDS: ReadonlySet<string> = new Set<string>([
	BASE_IDS.HR_DIRECTORY,
	BASE_IDS.PERSONNEL_TRACKER,
	BASE_IDS.EMPLOYEE_ONBOARDING,
	BASE_IDS.FINANCES,
]);

/**
 * Per-publicist "Metrics & Milestones" bases — noise in the explorer, not
 * structural editing targets. This regex used to live inline in
 * src/app/data/page.tsx; it moved here so the listing and the pagination API
 * filter on the same rule.
 */
export const HIDDEN_BASE_RE = /metrics?\s*(?:&|and)\s*milestones?/i;

export function isSensitiveBase(baseId: string): boolean {
	return SENSITIVE_BASE_IDS.has(baseId);
}

/** Airtable ids are a fixed shape; anything else is a malformed request. */
export const AIRTABLE_BASE_ID_RE = /^app[A-Za-z0-9]{14}$/;
export const AIRTABLE_TABLE_ID_RE = /^tbl[A-Za-z0-9]{14}$/;
