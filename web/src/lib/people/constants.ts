// Shared people-module constants.
//
// These lived as `export const` inside the 'use server' action files, which
// Next 15 rejects at build time ("a use server file can only export async
// functions") — that's what broke the first production build of the people
// slice (PR #10, 2026-08-19). Runtime values exported from server-action
// files must live in a plain module like this one; the action files and the
// pages both import from here.

export const SCOPES = ['all', 'team', 'direct_reports_only'] as const;

// DEPARTMENTS removed 19/08/2026: departments are canon in the tags table
// (/admin/tags) — profiles.department_tag_id (0033). The legacy hardcoded
// list survives only in /admin/users until that screen is unified too.

export const EMPLOYMENT_STATUSES = [
	'Active',
	'On Leave',
	'Contractor',
	'Offboarding',
	'Former',
] as const;

// 'pap' removed 18/08/2026: the PAP doc's single home is
// profile_sensitive.pap_doc_url (sensitive visibility). profile_docs holds
// docs a DIRECT manager may see (4R job descriptions and misc).
export const DOC_KINDS = ['4r', 'other'] as const;

export const PAY_STRUCTURES = ['salary', 'hourly', 'contract', 'commission'] as const;
export const REVIEW_CYCLES = ['annual', 'semi-annual', 'quarterly', 'none'] as const;
export const PAP_STATUSES = [
	'not_on_pap',
	'active',
	'probation',
	'completed',
	'separated',
] as const;
export const CURRENCIES = ['USD', 'BRL', 'PHP', 'EUR'] as const;

/** Metric sources (metrics.source / metric_definitions.source). */
export const METRIC_SOURCES = ['manual', 'the_work', 'beacon', 'airtable_sync', 'ghl', 'metricool'] as const;

/** Bonus formula families from the Definitions and Calcs sheet. */
export const BONUS_TYPES = ['pay_per', 'threshold_80_100', 'mom_pct', 'avg_time_tiered'] as const;
