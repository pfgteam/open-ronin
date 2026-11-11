// The client key (decision 13, rekey landed): every /clients URL is keyed by
// clients_v2.id. Airtable record ids (recXXX) are a legacy alias resolved
// through contracts.airtable_contract_id -> client_id and answered with a 308.
//
// Pure helpers only — no server imports — so client components, the MCP
// tools and the route tree can all share the vocabulary.

const AIRTABLE_REC = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAirtableRecordId(v: string | null | undefined): v is string {
	return typeof v === 'string' && AIRTABLE_REC.test(v);
}

export function isClientId(v: string | null | undefined): v is string {
	return typeof v === 'string' && UUID.test(v);
}

/** Minimal contract shape the key helpers need (a subset of public.contracts). */
export interface ContractKeyRow {
	id?: string;
	client_id: string;
	airtable_contract_id: string | null;
	status: string;
	starts_on?: string | null;
	ends_on?: string | null;
}

// Contract status ranking for "which contract speaks for this client":
// a live engagement beats a paused one beats a finished one; ties go to the
// most recent start. 17 clients hold two Contract Agreement rows (0040).
const STATUS_RANK: Record<string, number> = {
	active: 0,
	'30-day': 1,
	'60-day': 1,
	hold: 2,
	'post contract fulfillment': 3,
	internal: 4,
	unknown: 5,
	closed: 6,
};

function rank(status: string | null | undefined): number {
	return STATUS_RANK[(status ?? 'unknown').toLowerCase()] ?? 5;
}

/** Sort contracts so the one that best represents the client comes first. */
export function sortContractsByPrimacy<T extends ContractKeyRow>(rows: T[]): T[] {
	return [...rows].sort((a, b) => {
		const r = rank(a.status) - rank(b.status);
		if (r !== 0) return r;
		return (b.starts_on ?? '').localeCompare(a.starts_on ?? '');
	});
}

export function primaryContract<T extends ContractKeyRow>(rows: T[]): T | null {
	return sortContractsByPrimacy(rows)[0] ?? null;
}

/** airtable_contract_id -> client_id map from a contracts read. */
export function contractToClientMap(rows: ContractKeyRow[]): Map<string, string> {
	const m = new Map<string, string>();
	for (const r of rows) if (r.airtable_contract_id) m.set(r.airtable_contract_id, r.client_id);
	return m;
}

/**
 * Rewrite a legacy /clients/<recXXX>[/tail] path onto the client id, keeping
 * the tail and query string. Returns null when the path is not a legacy one.
 */
export function rekeyClientPath(pathname: string, search: string, clientId: string): string | null {
	const m = /^\/clients\/(rec[A-Za-z0-9]{14})(\/.*)?$/.exec(pathname);
	if (!m) return null;
	return `/clients/${clientId}${m[2] ?? ''}${search}`;
}
