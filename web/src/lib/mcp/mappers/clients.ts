// Pure allowlist mappers for the clients:read tools. Anything not named here
// does not leave the server — that is the whole security model of v1.
type Rec = { id: string; fields: Record<string, unknown> };

export type ClientRow = {
	/** clients_v2.id — the /clients/[id] route key since the rekey. Null when the contracts mirror has not seen this Airtable row. */
	client_id: string | null;
	airtable_contract_id: string;
	client: string | null;
	client_status: string | null;
	industry: string | null;
	packages: string | null;
	acct_lead: string | null;
	media_specialist: string | null;
	client_health: number | string | null;
	end_of_service: string | null;
	url: string | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Airtable `Packages` is a multi-select → `string[]`, not a bare string (see
 * ClientsTable.tsx:37, clients/[id]/_lib.ts:27). Join multiple values with
 * ' + ' — the app convention for a package combo (cf. contracts.package,
 * 0040:51) — but still tolerate a bare string for hand-typed data.
 */
const strList = (v: unknown): string | null => {
	if (typeof v === 'string') return v;
	if (Array.isArray(v)) {
		const parts = v.filter((x): x is string => typeof x === 'string');
		return parts.length ? parts.join(' + ') : null;
	}
	return null;
};

/**
 * Airtable collaborator field → display name ONLY. The raw value is
 * `{ id, email?, name? }` (or an array of those); the email is a staff
 * member's and must not leave. A bare string is tolerated for hand-typed data.
 */
const collaboratorName = (v: unknown): string | null => {
	const one = Array.isArray(v) ? v[0] : v;
	if (typeof one === 'string') return one;
	if (one && typeof one === 'object' && 'name' in one) return str((one as { name?: unknown }).name);
	return null;
};

/** `clientId` is the clients_v2.id the contracts mirror holds for this Airtable row (null = not mirrored yet). */
export function mapClientRow(rec: Rec, clientId: string | null = null): ClientRow {
	const f = rec.fields;
	return {
		client_id: clientId,
		airtable_contract_id: rec.id,
		client: str(f['Client']),
		client_status: str(f['Client Status']),
		industry: str(f['Industry']),
		packages: strList(f['Packages']),
		acct_lead: collaboratorName(f['Acct Lead']),
		media_specialist: collaboratorName(f['Media Specialist']),
		client_health: typeof f['Client Health'] === 'number' ? (f['Client Health'] as number) : str(f['Client Health']),
		end_of_service: str(f['End of Service']),
		url: clientId ? `/clients/${clientId}` : null,
	};
}

const ACTIVE = new Set(['active', '30-day', '60-day']);
const ALIASES: Record<string, string> = { 'post-contract': 'post contract fulfillment' };

export function parseStatusFilter(status?: string): (raw: string | undefined) => boolean {
	const s = (status ?? 'active').toLowerCase();
	if (s === 'all') return () => true;
	if (s === 'active') return (raw) => ACTIVE.has((raw ?? '').toLowerCase());
	const want = ALIASES[s] ?? s;
	return (raw) => (raw ?? '').toLowerCase() === want;
}
