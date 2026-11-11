// Airtable → import batch: pulls a whole Airtable table into the imports
// bucket as a CSV so the ordinary wizard (target, map, dry run, commit)
// takes it from there. Pure helpers here; the server action in
// app/(app)/data/imports/actions.ts owns the batch row and the bucket.
//
// Why a pull instead of an upload: the Media Opportunities seed (0116,
// AIRTABLE_SUNSET_PLAN 2.2) is ~42k rows across two linked tables, and the
// app's AIRTABLE_PAT is a Vercel Sensitive var nobody can read outside the
// deployment. Pulling server-side keeps the PAT where it is and gives the
// import an exact record id per row (the natural key) that a hand export
// would have to be told to include.
//
// Resumable: Airtable serves 100 rows a page at 5 req/s, so a full pull is
// a few hundred requests. Each action call pulls up to PAGES_PER_CALL pages,
// appends the rows to a staging JSON in the bucket, and returns the cursor;
// the client loops. Airtable's list iterator expires after a few minutes,
// which is longer than the gap between two calls.

import type { DataAdapter, DataRecord } from '@/lib/data/adapter';
import { toCsv } from './parse';

/** Pages of 100 per server action call: ~5 s at Airtable's rate limit. */
export const PAGES_PER_CALL = 20;

/** Client Media / Media Opportunities pull (the 0116 seed). */
export const MEDIA_OPPS_SOURCE = {
	baseId: process.env.AIRTABLE_BASE_CLIENT_MEDIA ?? '',
	table: process.env.AIRTABLE_OPPS_TABLE ?? '',
	tableName: 'Media Opportunities',
	/** The Client link points here (Client Metrics), whose name lives in the Contoso formula. */
	linkTable: process.env.AIRTABLE_OPPS_CLIENTS_TABLE ?? '',
	linkField: 'Client',
	linkNameField: 'Contoso',
	// Exactly the fields /media/opps and the Delivery tab read today (verified
	// against the base by those pages); an unknown field name fails the whole
	// list call with 422, so nothing speculative goes in this list.
	fields: [
		'Media Opp', 'Client', 'Story Title', 'Potential Story / Angle', 'Outlet', 'Outlet URL', 'Status',
		'Date Secured', 'Date Sent to Client', 'Date Added', 'Live Link', 'Live Date', 'Reach',
		'Media Tier', 'Category', 'Opp Type', 'Secured By',
	],
} as const;

export type SourceSpec = {
	baseId: string;
	table: string;
	tableName: string;
	fields: readonly string[];
	linkTable?: string;
	linkField?: string;
	linkNameField?: string;
};

export type PullState = {
	/** Airtable offset to resume from; undefined before the first page, null when exhausted. */
	cursor: string | null | undefined;
	/** Rows staged so far. */
	pulled: number;
	/** Link record id -> display name, filled on the first call when the source has a link table. */
	linkNames: Record<string, string>;
};

/** Reads every row of a table (used for the small link table only). */
export async function listAll<T extends Record<string, unknown>>(adapter: DataAdapter, baseId: string, table: string, fields: string[]): Promise<DataRecord<T>[]> {
	const out: DataRecord<T>[] = [];
	let cursor: string | undefined;
	do {
		const page = await adapter.list<T>(baseId, table, { fields, pageSize: 100, cursor, noCache: true });
		out.push(...page.rows);
		cursor = page.cursor;
	} while (cursor);
	return out;
}

/** CSV header: the record id first, then the source fields in order. */
export function pullHeaders(source: SourceSpec): string[] {
	return ['Record ID', ...source.fields];
}

/**
 * One Airtable record as a CSV row in `pullHeaders` order. Link fields are
 * replaced with the linked record's name (first link only: the Client link
 * carries one record); arrays otherwise join with ", "; everything else is
 * stringified. Airtable dates are already ISO.
 */
export function recordToRow(rec: DataRecord<Record<string, unknown>>, source: SourceSpec, linkNames: Record<string, string>): string[] {
	const out: string[] = [rec.id];
	for (const f of source.fields) {
		const v = rec.fields[f];
		if (v == null) {
			out.push('');
			continue;
		}
		if (f === source.linkField && Array.isArray(v)) {
			const id = v.length ? String(v[0]) : '';
			out.push(id ? (linkNames[id] ?? '') : '');
			continue;
		}
		if (Array.isArray(v)) {
			out.push(v.map((x) => (typeof x === 'object' && x && 'name' in x ? String((x as { name: unknown }).name) : String(x))).join(', '));
			continue;
		}
		if (typeof v === 'object') {
			out.push(JSON.stringify(v));
			continue;
		}
		out.push(String(v));
	}
	return out;
}

/**
 * Pulls up to `pages` pages from `state.cursor`. Returns the new rows and
 * the next state; `done` when Airtable returns no further offset.
 */
export async function pullPages(adapter: DataAdapter, source: SourceSpec, state: PullState, pages = PAGES_PER_CALL): Promise<{ rows: string[][]; state: PullState; done: boolean }> {
	let linkNames = state.linkNames;
	if (source.linkTable && source.linkNameField && Object.keys(linkNames).length === 0) {
		const links = await listAll<Record<string, unknown>>(adapter, source.baseId, source.linkTable, [source.linkNameField]);
		linkNames = {};
		for (const r of links) linkNames[r.id] = String(r.fields[source.linkNameField] ?? '').trim();
	}
	const rows: string[][] = [];
	let cursor = state.cursor === null ? undefined : state.cursor;
	let done = state.cursor === null;
	for (let i = 0; i < pages && !done; i++) {
		const page = await adapter.list<Record<string, unknown>>(source.baseId, source.table, { fields: [...source.fields], pageSize: 100, cursor, noCache: true });
		for (const r of page.rows) rows.push(recordToRow(r, source, linkNames));
		cursor = page.cursor;
		if (!cursor) done = true;
	}
	return { rows, state: { cursor: done ? null : cursor, pulled: state.pulled + rows.length, linkNames }, done };
}

export function rowsToCsv(source: SourceSpec, rows: string[][]): string {
	return toCsv(pullHeaders(source), rows);
}
