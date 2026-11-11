// DataAdapter — abstract interface that hides the underlying data store.
//
// Why this matters:
//   - Today: Airtable backs every operational record.
//   - Tomorrow (4-8 weeks): Migrate to RDS Postgres without touching module pages.
//   - Every page goes through this interface; never call the Airtable SDK directly.
//
// Adapters live in ./airtable.ts (now) and ./postgres.ts (later).
// Use `getAdapter()` from ./index.ts to get the configured instance.

// ============================================================================
// Filtering & sorting
// ============================================================================

export interface SortClause {
	field: string;
	direction: 'asc' | 'desc';
}

export interface ListOptions {
	/**
	 * Raw filter expression. For Airtable this is a `filterByFormula` string
	 * (e.g. `AND({Status}="Active", {Tier}>2)`).
	 *
	 * When migrating to Postgres, the adapter will translate this into a WHERE
	 * clause or we'll introduce a richer structured filter type.
	 */
	filter?: string;
	sort?: SortClause[];
	pageSize?: number;
	/** Opaque pagination cursor returned from a prior list() call. */
	cursor?: string;
	/** Limit to these field names (Airtable: `fields[]`). */
	fields?: string[];
	/** Airtable view ID or name. */
	view?: string;
	/** Hard cap on total records fetched (Airtable: `maxRecords`). */
	maxRecords?: number;
	/**
	 * Bypass the server-side fetch cache for this call.
	 *
	 * Use when paginating through all pages: Airtable list iterators (`offset`)
	 * expire after a few minutes, and Next's data cache can serve a stale first
	 * page (stale-while-revalidate) whose offset is already dead — the next
	 * page then fails with 422 LIST_RECORDS_ITERATOR_NOT_AVAILABLE.
	 */
	noCache?: boolean;
}

export interface ListResult<T> {
	rows: DataRecord<T>[];
	/** Pass back into `list()` as `cursor` to fetch next page. */
	cursor?: string;
}

// ============================================================================
// Schema introspection
// ============================================================================

export type FieldType =
	| 'singleLineText'
	| 'multilineText'
	| 'richText'
	| 'email'
	| 'url'
	| 'phoneNumber'
	| 'number'
	| 'currency'
	| 'percent'
	| 'duration'
	| 'rating'
	| 'singleSelect'
	| 'multipleSelects'
	| 'date'
	| 'dateTime'
	| 'createdTime'
	| 'lastModifiedTime'
	| 'checkbox'
	| 'barcode'
	| 'multipleRecordLinks'
	| 'multipleAttachments'
	| 'formula'
	| 'lookup'
	| 'rollup'
	| 'count'
	| 'multipleLookupValues'
	| 'createdBy'
	| 'lastModifiedBy'
	| 'singleCollaborator'
	| 'multipleCollaborators'
	| 'autoNumber'
	| 'button';

export interface FieldSchema {
	id: string;
	name: string;
	type: FieldType;
	options?: Record<string, unknown>;
	description?: string;
}

export interface ViewSchema {
	id: string;
	name: string;
	type: string;
	visibleFieldIds?: string[];
}

export interface TableSchema {
	id: string;
	name: string;
	primaryFieldId: string;
	description?: string;
	fields: FieldSchema[];
	views: ViewSchema[];
}

export interface BaseInfo {
	id: string;
	name: string;
	permissionLevel?: string;
}

export interface BaseDetail {
	id: string;
	name: string;
	tables: TableSchema[];
}

// ============================================================================
// Records
// ============================================================================

export interface DataRecord<T = Record<string, unknown>> {
	id: string;
	fields: T;
	createdTime?: string;
}

// ============================================================================
// The interface
// ============================================================================

export interface DataAdapter {
	// Discovery
	listBases(): Promise<BaseInfo[]>;
	getBaseSchema(baseId: string): Promise<BaseDetail>;

	// Records
	list<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		opts?: ListOptions,
	): Promise<ListResult<T>>;

	get<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		recordId: string,
	): Promise<DataRecord<T> | null>;

	create<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		fields: Partial<T>,
	): Promise<DataRecord<T>>;

	update<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		recordId: string,
		fields: Partial<T>,
	): Promise<DataRecord<T>>;

	delete(baseId: string, tableIdOrName: string, recordId: string): Promise<void>;

	// Batches (Data Imports, module 4). Airtable takes ten records per
	// request; the adapter splits a longer list itself. Both are optional so
	// a future adapter can start with the single record methods.
	createMany?<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		records: Partial<T>[],
	): Promise<DataRecord<T>[]>;

	updateMany?<T = Record<string, unknown>>(
		baseId: string,
		tableIdOrName: string,
		records: { id: string; fields: Partial<T> }[],
	): Promise<DataRecord<T>[]>;
}

// ============================================================================
// Errors
// ============================================================================

export class DataAdapterError extends Error {
	constructor(
		message: string,
		public status: number,
		public details?: unknown,
	) {
		super(message);
		this.name = 'DataAdapterError';
	}
}
