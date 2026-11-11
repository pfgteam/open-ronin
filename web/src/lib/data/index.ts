// Factory + barrel for the data layer.
// Usage:
//   import { getAdapter } from '@/lib/data';
//   const adapter = getAdapter();
//   const { rows } = await adapter.list(BASE_IDS.CLIENT_CENTRAL, 'Clients');

import type { DataAdapter } from './adapter';
import { AirtableAdapter } from './airtable';

let cached: DataAdapter | null = null;

export function getAdapter(): DataAdapter {
	if (cached) return cached;

	if (!process.env.AIRTABLE_PAT) {
		throw new Error('AIRTABLE_PAT is not set');
	}

	cached = new AirtableAdapter({
		pat: process.env.AIRTABLE_PAT,
		workspaceId: process.env.AIRTABLE_WORKSPACE_ID,
	});

	return cached;
}

// Optional Airtable bases, one env var per base (AIRTABLE_BASE_<KEY>).
// Unset bases resolve to '' and the pages that read them show their
// not-configured state. Native tables replace most of these over time.
export const BASE_IDS = {
	CLIENT_CENTRAL: process.env.AIRTABLE_BASE_CLIENT_CENTRAL ?? '',
	CLIENT_MEDIA: process.env.AIRTABLE_BASE_CLIENT_MEDIA ?? '',
	CLIENT_MEDIA_RELOADED: process.env.AIRTABLE_BASE_CLIENT_MEDIA_RELOADED ?? '',
	MEDIA_CONTACTS: process.env.AIRTABLE_BASE_MEDIA_CONTACTS ?? '',
	SALES_AND_CLIENTS: process.env.AIRTABLE_BASE_SALES_AND_CLIENTS ?? '',
	PROJECT_BEACON: process.env.AIRTABLE_BASE_PROJECT_BEACON ?? '',
	DELIVERY_PROJECT_MGMT: process.env.AIRTABLE_BASE_DELIVERY_PROJECT_MGMT ?? '',
	PROJECT_MANAGEMENT: process.env.AIRTABLE_BASE_PROJECT_MANAGEMENT ?? '',
	HR_DIRECTORY: process.env.AIRTABLE_BASE_HR_DIRECTORY ?? '',
	PERSONNEL_TRACKER: process.env.AIRTABLE_BASE_PERSONNEL_TRACKER ?? '',
	ONBOARDING: process.env.AIRTABLE_BASE_ONBOARDING ?? '',
	EMPLOYEE_ONBOARDING: process.env.AIRTABLE_BASE_EMPLOYEE_ONBOARDING ?? '',
	OR_PROCESSES: process.env.AIRTABLE_BASE_OR_PROCESSES ?? '',
	OR_CHECKLISTS: process.env.AIRTABLE_BASE_OR_CHECKLISTS ?? '',
	OP_FLOW_PRIORITIES: process.env.AIRTABLE_BASE_OP_FLOW_PRIORITIES ?? '',
	STRATEGIC_OPS: process.env.AIRTABLE_BASE_STRATEGIC_OPS ?? '',
	AWARENESS_DAYS: process.env.AIRTABLE_BASE_AWARENESS_DAYS ?? '',
	REVENUE: process.env.AIRTABLE_BASE_REVENUE ?? '',
	BIZ_NUMBERS: process.env.AIRTABLE_BASE_BIZ_NUMBERS ?? '',
	FINANCES: process.env.AIRTABLE_BASE_FINANCES ?? '',
	LEADGEN_DASHBOARD: process.env.AIRTABLE_BASE_LEADGEN_DASHBOARD ?? '',
	HUB: process.env.AIRTABLE_BASE_HUB ?? '',
	ABOUT_OR: process.env.AIRTABLE_BASE_ABOUT_OR ?? '',
	TEAM_RESOURCES: process.env.AIRTABLE_BASE_TEAM_RESOURCES ?? '',
	MASTER_DASHBOARD: process.env.AIRTABLE_BASE_MASTER_DASHBOARD ?? '',
	TEST_CLIENT_BASE: process.env.AIRTABLE_BASE_TEST_CLIENT_BASE ?? '',
} as const;

export type BaseId = (typeof BASE_IDS)[keyof typeof BASE_IDS];

export * from './adapter';
export { AirtableAdapter } from './airtable';
