// AirtableAdapter — implements DataAdapter against the Airtable REST API.
//
// Uses fetch directly (no `airtable` SDK) — smaller bundle, works in Edge runtime,
// no extra dependencies. Reference: https://airtable.com/developers/web/api/

import {
	DataAdapterError,
	type BaseDetail,
	type BaseInfo,
	type DataAdapter,
	type DataRecord,
	type ListOptions,
	type ListResult,
	type TableSchema,
} from './adapter';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

interface AirtableConfig {
	pat: string;
	/**
	 * If set, listBases() filters to this workspace.
	 * (Airtable's `/meta/bases` returns all bases the PAT has access to;
	 * we filter client-side because the API has no workspace scope param.)
	 */
	workspaceId?: string;
}

export class AirtableAdapter implements DataAdapter {
	private pat: string;
	private workspaceId?: string;

	constructor(config: AirtableConfig) {
		if (!config.pat) throw new Error('AirtableAdapter requires a PAT');
		this.pat = config.pat;
		this.workspaceId = config.workspaceId;
	}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		let res = await this.rawFetch(path, init);

		// Airtable allows 5 req/s per base — list pages fan out enough to hit
		// 429 under normal use. Retry once after Retry-After (default 1s)
		// instead of surfacing a raw red 429 banner / crashed detail layout.
		if (res.status === 429) {
			const retryAfter = Number(res.headers.get('Retry-After')) || 1;
			await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
			res = await this.rawFetch(path, init);
		}

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			let detail: unknown = body;
			try {
				detail = JSON.parse(body);
			} catch {
				// keep as text
			}
			throw new DataAdapterError(
				`Airtable ${res.status} ${res.statusText} at ${path}`,
				res.status,
				detail,
			);
		}

		return res.json() as Promise<T>;
	}

	private rawFetch(path: string, init?: RequestInit): Promise<Response> {
		return fetch(`${AIRTABLE_API_BASE}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.pat}`,
				'Content-Type': 'application/json',
				...((init?.headers as Record<string, string>) ?? {}),
			},
			// Server-side cache: 60s TTL unless the caller opts out with
			// `cache: 'no-store'` (setting both `cache` and `next.revalidate`
			// is invalid in Next 15).
			...(init?.cache ? {} : { next: { revalidate: 60 } }),
		});
	}

	// ----- Discovery -----

	async listBases(): Promise<BaseInfo[]> {
		const out: BaseInfo[] = [];
		let offset: string | undefined;

		do {
			const qs = offset ? `?offset=${encodeURIComponent(offset)}` : '';
			const data = await this.request<{
				bases: { id: string; name: string; permissionLevel: string }[];
				offset?: string;
			}>(`/meta/bases${qs}`);

			for (const b of data.bases) {
				out.push({
					id: b.id,
					name: b.name,
					permissionLevel: b.permissionLevel,
				});
			}

			offset = data.offset;
		} while (offset);

		// Workspace filtering is client-side; the Airtable API doesn't expose
		// a workspace filter on /meta/bases. For now we return all bases the PAT
		// can see — if the PAT is workspace-scoped (which it is per setup),
		// only Open Ronin bases come back anyway.
		return out;
	}

	async getBaseSchema(baseId: string): Promise<BaseDetail> {
		// Fetch table list (schema) + base name from the listBases cache.
		const [schemaData, allBases] = await Promise.all([
			this.request<{ tables: TableSchema[] }>(`/meta/bases/${baseId}/tables`),
			this.listBases(),
		]);

		const baseName = allBases.find((b) => b.id === baseId)?.name ?? baseId;

		return {
			id: baseId,
			name: baseName,
			tables: schemaData.tables,
		};
	}

	// ----- Records -----

	async list<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		opts: ListOptions = {},
	): Promise<ListResult<T>> {
		const params = new URLSearchParams();
		if (opts.filter) params.set('filterByFormula', opts.filter);
		if (opts.pageSize) params.set('pageSize', String(Math.min(opts.pageSize, 100)));
		if (opts.cursor) params.set('offset', opts.cursor);
		if (opts.view) params.set('view', opts.view);
		if (opts.maxRecords) params.set('maxRecords', String(opts.maxRecords));
		if (opts.fields?.length) {
			opts.fields.forEach((f) => params.append('fields[]', f));
		}
		if (opts.sort?.length) {
			opts.sort.forEach((s, i) => {
				params.set(`sort[${i}][field]`, s.field);
				params.set(`sort[${i}][direction]`, s.direction);
			});
		}

		const qs = params.toString();
		const path = `/${baseId}/${encodeURIComponent(tableIdOrName)}${qs ? '?' + qs : ''}`;

		// Never cache offset-bearing requests — Airtable iterators are
		// short-lived, so a cached page (or a page fetched with a stale cached
		// offset) breaks pagination with LIST_RECORDS_ITERATOR_NOT_AVAILABLE.
		const noStore = opts.noCache || opts.cursor;

		const data = await this.request<{
			records: { id: string; fields: T; createdTime: string }[];
			offset?: string;
		}>(path, noStore ? { cache: 'no-store' } : undefined);

		return {
			rows: data.records as DataRecord<T>[],
			cursor: data.offset,
		};
	}

	async get<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		recordId: string,
	): Promise<DataRecord<T> | null> {
		try {
			const data = await this.request<{
				id: string;
				fields: T;
				createdTime: string;
			}>(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`);
			return data as DataRecord<T>;
		} catch (e) {
			if (e instanceof DataAdapterError && e.status === 404) return null;
			throw e;
		}
	}

	async create<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		fields: Partial<T>,
	): Promise<DataRecord<T>> {
		const data = await this.request<{
			records: { id: string; fields: T; createdTime: string }[];
		}>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
			method: 'POST',
			body: JSON.stringify({ records: [{ fields }], typecast: true }),
			cache: 'no-store',
		});
		return data.records[0] as DataRecord<T>;
	}

	async update<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		recordId: string,
		fields: Partial<T>,
	): Promise<DataRecord<T>> {
		const data = await this.request<{
			id: string;
			fields: T;
			createdTime: string;
		}>(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`, {
			method: 'PATCH',
			body: JSON.stringify({ fields, typecast: true }),
			cache: 'no-store',
		});
		return data as DataRecord<T>;
	}

	async createMany<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		records: Partial<T>[],
	): Promise<DataRecord<T>[]> {
		const out: DataRecord<T>[] = [];
		for (let i = 0; i < records.length; i += 10) {
			const slice = records.slice(i, i + 10);
			const data = await this.request<{
				records: { id: string; fields: T; createdTime: string }[];
			}>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
				method: 'POST',
				body: JSON.stringify({ records: slice.map((fields) => ({ fields })), typecast: true }),
				cache: 'no-store',
			});
			out.push(...(data.records as DataRecord<T>[]));
		}
		return out;
	}

	async updateMany<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		records: { id: string; fields: Partial<T> }[],
	): Promise<DataRecord<T>[]> {
		const out: DataRecord<T>[] = [];
		for (let i = 0; i < records.length; i += 10) {
			const slice = records.slice(i, i + 10);
			const data = await this.request<{
				records: { id: string; fields: T; createdTime: string }[];
			}>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
				method: 'PATCH',
				body: JSON.stringify({ records: slice, typecast: true }),
				cache: 'no-store',
			});
			out.push(...(data.records as DataRecord<T>[]));
		}
		return out;
	}

	async delete(baseId: string, tableIdOrName: string, recordId: string): Promise<void> {
		await this.request(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`, {
			method: 'DELETE',
			cache: 'no-store',
		});
	}
}
