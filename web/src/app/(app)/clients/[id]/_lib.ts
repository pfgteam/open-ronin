// Shared helpers for the /clients/[id]/* route tree.
//
// The route param is clients_v2.id (decision 13 rekey). The Airtable Contract
// Agreement record is still the source for the rich per-contract fields, so
// getClientContext() resolves client -> contracts -> primary contract ->
// Airtable record. React `cache()` dedupes within a render pass, so the
// layout and every tab can call it without doubling the fetches.
//
// Legacy /clients/<recXXX> URLs (old notification hrefs, bookmarks) answer
// with a 308 to the client id — see requireClient().

import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { getAdapter, BASE_IDS, type DataRecord } from '@/lib/data';
import type { HealthValue } from '@/lib/clients/status';
import { isAirtableRecordId } from '@/lib/clients/key';
import { clientIdForAirtableContract, getClientWithContracts, type ClientWithContracts } from '@/lib/clients/server';

// ----- Contract Agreement (the client record itself) -----

interface Collaborator {
	id: string;
	email?: string;
	name?: string;
}

// Airtable's REST API returns multipleRecordLinks fields as string[] of
// record ids — NOT objects. The old `LinkedRef {id,name}` typing made every
// `.map((r) => r.id)` yield undefined, so Campaigns/Tracking/Strategy always
// rendered empty (18/08 QA audit). Use `resolveLinkNames` when display names
// are needed.
type LinkedIds = string[];

export interface ContractFields {
	Client?: string;
	'Client Status'?: string;
	Industry?: string;
	Packages?: string[];
	'Per Month'?: number;
	'Acct Lead'?: Collaborator;
	'Media Specialist'?: Collaborator;
	'Acct Man-SMM'?: Collaborator;
	SMAM?: Collaborator;
	Closer?: Collaborator[];
	'Success Partner'?: Collaborator[];
	'Content Team Assignee'?: Collaborator[];
	// Airtable percent field — a number like 0.85, NOT the word "High".
	'Client Health'?: HealthValue;
	'Kickoff(Service Start)'?: string;
	'1st Payment'?: string;
	'SOW Date(Signup)'?: string;
	'End of Service'?: string;
	'SOW End Date'?: string;
	'POC Email'?: string;
	'Email Address'?: string;
	'Billing Email'?: string;
	'Billing PoC'?: string;
	'Lead Source'?: string;
	'Reason For Leaving'?: string;
	'Google Analytics'?: boolean;
	'Beacon Deliverables'?: LinkedIds;
	'Current Assignments'?: LinkedIds;
	'Beacon Monthly copy'?: LinkedIds;
	'Client Weekly'?: LinkedIds;
	'Client Onboarding'?: LinkedIds;
	'12 Week Goals'?: LinkedIds;
	'Media Opps'?: LinkedIds;
	'Open Ronin Client Goals copy'?: LinkedIds;
	Payments?: LinkedIds;
	'Imported table'?: LinkedIds;
	'Live Links'?: number;
	'Podcasts Secured'?: number;
	'Influencers Secured'?: number;
	'Media Opp Rollup (from Media Opps)'?: unknown;
}

export interface ClientContext extends ClientWithContracts {
	/** clients_v2.id — the route key. */
	clientId: string;
	/** Primary contract's Airtable record id (join key for client_meta, brands, health_scores…). */
	airtableId: string | null;
	/** The Airtable Contract Agreement record for the primary contract; null when Airtable has no such row (or is down). */
	contract: DataRecord<ContractFields> | null;
	/** contract?.fields with an empty-object fallback so tabs never null-check every field. */
	fields: ContractFields;
	/** Display name: clients_v2 first, Airtable second. */
	name: string;
}

/**
 * Resolve a /clients/[id] param to the client bundle. Accepts a clients_v2.id;
 * a legacy Airtable record id is resolved through contracts so the LAYOUT can
 * still render while the PAGE issues the 308 (requireClient). Null = unknown.
 */
export const getClientContext = cache(async (idOrRec: string): Promise<ClientContext | null> => {
	const clientId = isAirtableRecordId(idOrRec) ? await clientIdForAirtableContract(idOrRec) : idOrRec;
	if (!clientId) return null;
	const bundle = await getClientWithContracts(clientId);
	if (!bundle) return null;
	const airtableId = bundle.primary?.airtable_contract_id ?? null;
	let contract: DataRecord<ContractFields> | null = null;
	if (airtableId) {
		try {
			contract = await getAdapter().get<ContractFields>(BASE_IDS.CLIENT_CENTRAL, 'Contract Agreement', airtableId);
		} catch {
			// Airtable down or record gone: the page still renders from the mirror.
			contract = null;
		}
	}
	const fields = contract?.fields ?? {};
	return {
		...bundle,
		clientId,
		airtableId,
		contract,
		fields,
		name: bundle.client.display_name || fields.Client || '(unnamed client)',
	};
});

/**
 * Page-level guard. `tail` is the tab's own path suffix ('' | '/health' | …)
 * so a legacy /clients/<rec>/health lands on /clients/<uuid>/health with a
 * 308. Only PAGES call this (the layout uses getClientContext) so exactly one
 * redirect is thrown per request.
 */
export async function requireClient(id: string, tail = ''): Promise<ClientContext> {
	if (isAirtableRecordId(id)) {
		const clientId = await clientIdForAirtableContract(id);
		if (!clientId) notFound();
		permanentRedirect(`/clients/${clientId}${tail}`);
	}
	const ctx = await getClientContext(id);
	if (!ctx) notFound();
	return ctx;
}

// ----- Linked record batch fetch -----

/**
 * Resolve a list of linked record IDs (from a multipleRecordLinks field) to full
 * records in their target table. Airtable's filterByFormula supports OR with
 * RECORD_ID() equality; we batch into chunks of 50 to stay under URL limits.
 */
export async function listByIds<T = Record<string, unknown>>(
	baseId: string,
	tableId: string,
	recordIds: string[],
	opts: { fields?: string[] } = {},
): Promise<DataRecord<T>[]> {
	if (!recordIds.length) return [];
	const chunks: string[][] = [];
	for (let i = 0; i < recordIds.length; i += 50) {
		chunks.push(recordIds.slice(i, i + 50));
	}
	const out: DataRecord<T>[] = [];
	const adapter = getAdapter();
	for (const chunk of chunks) {
		const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
		try {
			const r = await adapter.list<T>(baseId, tableId, {
				filter: formula,
				pageSize: 100,
				fields: opts.fields,
			});
			out.push(...r.rows);
		} catch {
			// chunk failed — continue; partial data is better than nothing in a detail view
		}
	}
	return out;
}

/**
 * Resolve linked-record ids to their primary-field display names.
 * Returns a Map<recordId, name>. Missing/failed ids are simply absent.
 */
export async function resolveLinkNames(
	baseId: string,
	tableId: string,
	recordIds: string[],
	primaryField: string,
): Promise<Map<string, string>> {
	const unique = [...new Set(recordIds.filter(Boolean))];
	const map = new Map<string, string>();
	if (!unique.length) return map;
	const rows = await listByIds<Record<string, unknown>>(baseId, tableId, unique, {
		fields: [primaryField],
	});
	for (const r of rows) {
		const v = r.fields[primaryField];
		if (typeof v === 'string' && v) map.set(r.id, v);
	}
	return map;
}

// ----- Cross-base lookup: find Client Media records by client name -----
// Joined by string since Airtable can't cross-link bases.

export async function findClientMetricsByName(clientName: string) {
	if (!clientName) return [];
	const escaped = clientName.replace(/"/g, '\\"');
	// Match against either the Brand Name field or the Client Name link's primary field
	const formula = `OR(
		FIND("${escaped}", {Brand Name}) > 0,
		FIND("${escaped}", ARRAYJOIN({Client Name})) > 0
	)`.replace(/\s+/g, ' ');
	try {
		const r = await getAdapter().list(BASE_IDS.CLIENT_MEDIA, 'Client Metrics', {
			filter: formula,
			pageSize: 50,
		});
		return r.rows;
	} catch {
		return [];
	}
}

export async function findRecentPlacementsByContractName(clientName: string, days = 90) {
	if (!clientName) return [];
	const escaped = clientName.replace(/"/g, '\\"');
	const sinceIso = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
	const formula = `AND(
		FIND("${escaped}", ARRAYJOIN({Client})) > 0,
		OR(
			IS_AFTER({Live Date}, "${sinceIso}"),
			IS_AFTER({Date Secured}, "${sinceIso}")
		)
	)`.replace(/\s+/g, ' ');
	try {
		const r = await getAdapter().list(BASE_IDS.CLIENT_MEDIA, 'Media Opportunities', {
			filter: formula,
			pageSize: 50,
			sort: [{ field: 'Date Secured', direction: 'desc' }],
		});
		return r.rows;
	} catch {
		return [];
	}
}

// ----- Status colors moved to @/lib/clients/status (shared with the list) --
export {
	statusColor,
	healthColor,
	healthBand,
	formatHealth,
	hasHealth,
} from '@/lib/clients/status';

