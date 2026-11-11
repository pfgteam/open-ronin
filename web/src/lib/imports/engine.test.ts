// Engine test against an in memory stand in for the Supabase client. The
// done test for module 4 (500 contacts import, re import gives 500 updates
// and 0 inserts, rollback leaves the table as it was) cannot run against
// production until 0068 is applied, so this file runs the same three
// assertions against a fake that honors the PostgREST calls the engine
// makes: select with ilikeAnyOf, in and eq; insert with select; update and
// delete with eq and in.

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applySupabase, planSupabase, revertSupabase, verifySupabase } from './engine';
import { autoMatch } from './match';
import { parseCsv, toCsv } from './parse';
import { TARGETS } from './targets';
import type { PlannedRow } from './types';

type Row = Record<string, unknown>;

class FakeDb {
	tables = new Map<string, Row[]>();
	private seq = 0;

	constructor(names: string[]) {
		for (const n of names) this.tables.set(n, []);
	}

	private rows(table: string): Row[] {
		const t = this.tables.get(table);
		if (!t) throw new Error(`unknown table ${table}`);
		return t;
	}

	from(table: string) {
		const rows = this.rows(table);
		const roleRows = table === 'contacts' ? this.rows('contact_roles') : null;
		const nextId = () => `id-${++this.seq}`;
		type Filter = (r: Row) => boolean;
		const filters: Filter[] = [];
		let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
		let payload: Row[] | Row | null = null;
		let wantSelect = false;

		const run = () => {
			const match = (r: Row) => filters.every((f) => f(r));
			if (mode === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
			if (mode === 'insert') {
				const list = Array.isArray(payload) ? payload : [payload!];
				const created = list.map((r) => {
					const row = { ...r } as Row;
					if (table !== 'contact_roles' && row.id == null) row.id = nextId();
					rows.push(row);
					return { ...row };
				});
				return { data: wantSelect ? created : null, error: null };
			}
			if (mode === 'update') {
				for (const r of rows) if (match(r)) Object.assign(r, payload as Row);
				return { data: null, error: null };
			}
			const keep = rows.filter((r) => !match(r));
			// contact_roles cascades from contacts in the real schema (0002).
			if (roleRows) {
				const gone = new Set(rows.filter(match).map((r) => String(r.id)));
				const keepRoles = roleRows.filter((r) => !gone.has(String(r.contact_id)));
				roleRows.length = 0;
				roleRows.push(...keepRoles);
			}
			rows.length = 0;
			rows.push(...keep);
			return { data: null, error: null };
		};

		const builder: Record<string, unknown> = {
			select() {
				if (mode === 'insert') wantSelect = true;
				return builder;
			},
			insert(rowsIn: Row | Row[]) {
				mode = 'insert';
				payload = rowsIn;
				return builder;
			},
			update(patch: Row) {
				mode = 'update';
				payload = patch;
				return builder;
			},
			delete() {
				mode = 'delete';
				return builder;
			},
			eq(col: string, v: unknown) {
				filters.push((r) => r[col] === v);
				return builder;
			},
			in(col: string, list: unknown[]) {
				const set = new Set(list.map(String));
				filters.push((r) => set.has(String(r[col])));
				return builder;
			},
			ilikeAnyOf(col: string, list: string[]) {
				const set = new Set(list.map((s) => s.toLowerCase()));
				filters.push((r) => r[col] != null && set.has(String(r[col]).toLowerCase()));
				return builder;
			},
			not(col: string, op: string, v: unknown) {
				if (op === 'is' && v === null) filters.push((r) => r[col] != null);
				return builder;
			},
			returns() {
				return builder;
			},
			then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
				return Promise.resolve().then(run).then(resolve, reject);
			},
		};
		return builder;
	}
}

function makeCsv(n: number, variant: 'a' | 'b' = 'a'): string {
	const headers = ['Full Name', 'Email Address', 'Company', 'Job Title', 'Contact Type'];
	const rows: string[][] = [];
	for (let i = 1; i <= n; i++) {
		rows.push([
			`Person ${i}`,
			`person${i}@example.com`,
			variant === 'a' ? `Outlet ${i % 37}` : `Outlet ${i % 37} Media`,
			variant === 'a' ? 'Reporter' : 'Senior reporter',
			i % 2 === 0 ? 'journalist, podcaster' : 'journalist',
		]);
	}
	return toCsv(headers, rows);
}

async function importFile(db: FakeDb, csv: string): Promise<PlannedRow[]> {
	const file = parseCsv(csv);
	const columns = TARGETS.contacts.columns;
	const mapping = autoMatch(file.headers, columns);
	const svc = db as unknown as SupabaseClient;
	const written: PlannedRow[] = [];
	for (let from = 0; from < file.rows.length; from += 500) {
		const rows = file.rows.slice(from, from + 500).map((cells, i) => ({ rowNumber: from + i + 1, cells }));
		const planned = await planSupabase(svc, { target: 'contacts', targetRef: null, options: {}, headers: file.headers, mapping, columns, rows });
		written.push(...(await applySupabase(svc, 'contacts', planned)));
	}
	return written;
}

function snapshot(db: FakeDb) {
	return {
		contacts: db.tables.get('contacts')!.map((r) => ({ ...r })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
		roles: db.tables.get('contact_roles')!.map((r) => `${r.contact_id}:${r.role}`).sort(),
	};
}

describe('module 4 done test against the in memory client', () => {
	it('maps a contacts export with zero fixes beyond the automatic mapping', () => {
		const file = parseCsv(makeCsv(3));
		const mapping = autoMatch(file.headers, TARGETS.contacts.columns);
		expect(mapping).toEqual({
			display_name: 'Full Name',
			email: 'Email Address',
			organization: 'Company',
			title: 'Job Title',
			roles: 'Contact Type',
		});
	});

	it('imports 500 rows, re imports as 500 updates and 0 inserts, and rolls back to the original table', async () => {
		const db = new FakeDb(['contacts', 'contact_roles']);
		// Pre existing rows so the rollback has something to restore rather than
		// an empty table: 20 of the 500 already exist with older data.
		for (let i = 1; i <= 20; i++) {
			db.tables.get('contacts')!.push({ id: `pre-${i}`, display_name: `Old Name ${i}`, email: `PERSON${i}@example.com`, organization: 'Old Co', title: null, phone: '555', linkedin_url: null });
			db.tables.get('contact_roles')!.push({ contact_id: `pre-${i}`, role: 'client' });
		}
		const before = snapshot(db);

		const first = await importFile(db, makeCsv(500));
		expect(first.filter((r) => r.action === 'insert').length).toBe(480);
		expect(first.filter((r) => r.action === 'update').length).toBe(20);
		expect(first.filter((r) => r.action === 'reject').length).toBe(0);
		expect(db.tables.get('contacts')!.length).toBe(500);
		// Roles were added, never removed: the pre existing client role survives.
		expect(db.tables.get('contact_roles')!.filter((r) => r.role === 'client').length).toBe(20);
		expect(db.tables.get('contact_roles')!.filter((r) => r.role === 'journalist').length).toBe(500);
		// Untouched columns keep their value.
		expect(db.tables.get('contacts')!.find((r) => r.id === 'pre-1')!.phone).toBe('555');

		const second = await importFile(db, makeCsv(500));
		expect(second.filter((r) => r.action === 'update').length).toBe(500);
		expect(second.filter((r) => r.action === 'insert').length).toBe(0);
		expect(db.tables.get('contacts')!.length).toBe(500);

		// Rolling back the first batch must refuse while the second batch's
		// writes are in place... except the second wrote identical values, so
		// the after snapshots still match and the rollback goes through.
		const svc = db as unknown as SupabaseClient;
		expect(await verifySupabase(svc, 'contacts', first)).toEqual([]);
		await revertSupabase(svc, 'contacts', first);
		expect(snapshot(db)).toEqual(before);
	});

	it('refuses rollback and names the drifted rows when the table changed', async () => {
		const db = new FakeDb(['contacts', 'contact_roles']);
		const first = await importFile(db, makeCsv(50));
		const svc = db as unknown as SupabaseClient;
		await importFile(db, makeCsv(50, 'b'));
		const drifts = await verifySupabase(svc, 'contacts', first);
		expect(drifts.length).toBe(50);
		expect(drifts[0].keys.sort()).toEqual(['organization', 'title']);
	});

	it('rejects bad rows with a reason and skips in file duplicates', async () => {
		const db = new FakeDb(['contacts', 'contact_roles']);
		const csv = toCsv(
			['Full Name', 'Email Address', 'Contact Type'],
			[
				['Jane', 'jane@x.com', 'journalist'],
				['', 'nobody@x.com', 'journalist'],
				['Jane again', 'JANE@x.com', 'podcaster'],
				['Bob', 'not an email', 'chef'],
			],
		);
		const written = await importFile(db, csv);
		expect(written.map((r) => r.action)).toEqual(['insert', 'reject', 'skip', 'reject']);
		expect(written[1].reason).toContain('Display name is required');
		expect(written[2].reason).toContain('Duplicate of row 1');
		expect(written[3].reason).toContain('not an email');
		expect(db.tables.get('contacts')!.length).toBe(1);
	});
});

// The 0116 seed target: the client resolves by name through clients_v2 +
// client_aliases, Beacon clients are skipped (not written), anything that
// does not resolve to exactly one Open Ronin-family client is rejected with a
// reason, and a re-import is idempotent on the Airtable record id.
describe('media_opportunities target', () => {
	const MAIN_ORG = 'tag-org';
	const LUX = 'tag-lux';
	const BEACON = 'tag-beacon';

	function seedDb(): FakeDb {
		const db = new FakeDb(['media_opportunities', 'clients_v2', 'client_aliases', 'tags']);
		db.tables.get('tags')!.push({ id: MAIN_ORG, slug: 'org-main', category: 'org' }, { id: LUX, slug: 'org-premium', category: 'org' }, { id: BEACON, slug: 'org-beacon', category: 'org' });
		db.tables.get('clients_v2')!.push(
			{ id: 'c-acme-snacks', display_name: 'Acme Snacks', org_tag_id: MAIN_ORG },
			{ id: 'c-lux', display_name: 'Maison Lux', org_tag_id: LUX },
			{ id: 'c-beacon', display_name: 'Rocket Sub', org_tag_id: BEACON },
			{ id: 'c-untagged', display_name: 'Nobody Knows', org_tag_id: null },
			{ id: 'c-twin-a', display_name: 'Twin Co', org_tag_id: MAIN_ORG },
			{ id: 'c-twin-b', display_name: 'Twin Có', org_tag_id: MAIN_ORG },
		);
		db.tables.get('client_aliases')!.push({ client_id: 'c-acme-snacks', raw_name: 'Acme Snacks Dates' });
		return db;
	}

	const headers = ['Record ID', 'Client', 'Media Opp', 'Outlet', 'Status', 'Date Secured', 'Reach'];

	async function run(db: FakeDb, rows: string[][]): Promise<PlannedRow[]> {
		const file = parseCsv(toCsv(headers, rows));
		const columns = TARGETS.media_opportunities.columns;
		const mapping = autoMatch(file.headers, columns);
		const svc = db as unknown as SupabaseClient;
		const planned = await planSupabase(svc, { target: 'media_opportunities', targetRef: null, options: {}, headers: file.headers, mapping, columns, rows: file.rows.map((cells, i) => ({ rowNumber: i + 1, cells })) });
		return applySupabase(svc, 'media_opportunities', planned);
	}

	it('auto maps the Airtable pull headers', () => {
		const mapping = autoMatch(headers, TARGETS.media_opportunities.columns);
		expect(mapping).toEqual({
			airtable_record_id: 'Record ID',
			client_name: 'Client',
			title: 'Media Opp',
			outlet_name: 'Outlet',
			status_raw: 'Status',
			date_secured: 'Date Secured',
			reach: 'Reach',
		});
	});

	it('inserts Open Ronin-family rows, skips Beacon rows, rejects unresolved and untagged clients', async () => {
		const db = seedDb();
		const written = await run(db, [
			['recAAAAAAAAAAAAA01', 'Acme Snacks', 'Forbes feature', 'Forbes', 'Secured Coverage', '2026-09-03', '1000'],
			['recAAAAAAAAAAAAA02', 'acme-snacks dates', 'Alias match', 'Vogue', 'Pending Coverage', '', ''],
			['recAAAAAAAAAAAAA03', 'Maison Lux', 'Lux row', 'WSJ', 'Scheduled', '2026-09-04', '50'],
			['recAAAAAAAAAAAAA04', 'Rocket Sub', 'Beacon row', 'TechCrunch', 'Secured Coverage', '2026-09-05', '9'],
			['recAAAAAAAAAAAAA05', 'Unknown Brand', 'No client', 'X', 'Secured Coverage', '', ''],
			['recAAAAAAAAAAAAA06', 'Nobody Knows', 'Untagged', 'X', 'Secured Coverage', '', ''],
			['recAAAAAAAAAAAAA07', 'Twin Co', 'Ambiguous fold', 'X', 'Secured Coverage', '', ''],
			['recAAAAAAAAAAAAA08', '', 'Empty client', 'X', 'Secured Coverage', '', ''],
		]);
		expect(written.map((r) => r.action)).toEqual(['insert', 'insert', 'insert', 'skip', 'reject', 'reject', 'insert', 'reject']);
		expect(written[3].reason).toContain('Beacon client "Rocket Sub"');
		expect(written[4].reason).toContain('does not resolve to exactly one');
		expect(written[5].reason).toContain('no org tag');
		expect(written[7].reason).toContain('required');
		const table = db.tables.get('media_opportunities')!;
		expect(table.length).toBe(4);
		expect(table.find((r) => r.airtable_record_id === 'recAAAAAAAAAAAAA02')!.client_id).toBe('c-acme-snacks');
		// Exact display-name match wins even when the fold is ambiguous.
		expect(table.find((r) => r.airtable_record_id === 'recAAAAAAAAAAAAA07')!.client_id).toBe('c-twin-a');
		const row = table.find((r) => r.airtable_record_id === 'recAAAAAAAAAAAAA01')!;
		expect(row.source).toBe('airtable');
		expect(row.status_raw).toBe('Secured Coverage');
		expect(row.reach).toBe(1000);
		expect('client_name' in row).toBe(false);
	});

	it('is idempotent on the Airtable record id: a second run updates, never duplicates', async () => {
		const db = seedDb();
		const rows = [['recBBBBBBBBBBBBB01', 'Acme Snacks', 'First', 'Forbes', 'Pending Coverage', '', '']];
		const first = await run(db, rows);
		expect(first[0].action).toBe('insert');
		const second = await run(db, [['recBBBBBBBBBBBBB01', 'Acme Snacks', 'First', 'Forbes', 'Secured Coverage', '2026-09-10', '']]);
		expect(second[0].action).toBe('update');
		const table = db.tables.get('media_opportunities')!;
		expect(table.length).toBe(1);
		expect(table[0].status_raw).toBe('Secured Coverage');
	});
});
