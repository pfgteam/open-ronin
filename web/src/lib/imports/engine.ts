// The import engine: plan and apply rows against each allowlisted target.
// Server side only. Every function takes the service role client for the
// target tables (see the 0068 header for why) and never touches
// import_batches or import_rows itself; actions.ts owns those through the
// caller's session.
//
// Contract per target:
//   plan(rows)     find the existing row for each shaped row by natural key,
//                  decide insert or update, and produce the before snapshot.
//   apply(planned) write the inserts and updates, return target ids and
//                  after snapshots.
//   verify(rows)   read the live rows and compare to the after snapshots.
//   revert(rows)   delete inserted rows, restore updated rows from before.
//
// Snapshots hold only the columns the batch mapped (plus roles for
// contacts), so a rollback restores what the import touched and nothing
// else. Reject rows carry a reason and no snapshots.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DataAdapter, FieldSchema } from '@/lib/data/adapter';
import { buildNameResolver } from '@/lib/health/oppMonths';
import { driftedKeys, naturalKeyFor, shapeRow } from './match';
import { airtableColumns, naturalKeyGroups, targetInfo } from './targets';
import type { ColumnSpec, Mapping, PlannedRow, TargetKey } from './types';

type Svc = SupabaseClient;
type Row = Record<string, unknown>;

export interface PlanInput {
	target: TargetKey;
	targetRef: string | null;
	options: Record<string, unknown>;
	headers: string[];
	mapping: Mapping;
	columns: ColumnSpec[];
	/** File rows for this chunk, with their 1 based row numbers. */
	rows: { rowNumber: number; cells: string[] }[];
}

export interface Drift {
	rowNumber: number;
	targetId: string | null;
	keys: string[];
}

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

function lower(v: unknown): string {
	return String(v ?? '').trim().toLowerCase();
}

function escapeLike(v: string): string {
	return v.replace(/[\\%]/g, (m) => `\\${m}`);
}

function pick(row: Row, keys: string[]): Row {
	const out: Row = {};
	for (const k of keys) out[k] = row[k] ?? null;
	return out;
}

function mappedKeys(mapping: Mapping, columns: ColumnSpec[]): string[] {
	return columns.filter((c) => mapping[c.key]).map((c) => c.key);
}

// ============================================================================
// Shared planning
// ============================================================================

interface ShapedInput {
	rowNumber: number;
	values: Row;
	errors: string[];
	/** Set by a target's resolve() to skip the row with a reason (not an error). */
	skip?: string;
}

function shapeAll(input: PlanInput): ShapedInput[] {
	return input.rows.map((r) => {
		const s = shapeRow(r.cells, input.headers, input.mapping, input.columns);
		return { rowNumber: r.rowNumber, values: s.values, errors: s.errors };
	});
}

interface Existing {
	id: string;
	row: Row;
}

/**
 * Turns shaped rows plus a lookup of existing rows into planned rows. The
 * lookup is by natural key string; rows with no natural key are rejected.
 * In chunk duplicates of a key are skipped so two lines cannot race for one
 * target row.
 */
function planFromLookup(
	shaped: ShapedInput[],
	groups: string[][],
	existing: Map<string, Existing>,
	snapshotKeys: string[],
	toAfter: (values: Row, before: Row | null) => Row,
): PlannedRow[] {
	const seen = new Map<string, number>();
	return shaped.map((s) => {
		if (s.errors.length) {
			return { rowNumber: s.rowNumber, action: 'reject', targetId: null, before: null, after: null, reason: s.errors.join('; ') };
		}
		if (s.skip) {
			return { rowNumber: s.rowNumber, action: 'skip', targetId: null, before: null, after: null, reason: s.skip };
		}
		const nk = naturalKeyFor(s.values, groups);
		if (!nk) {
			const need = groups.map((g) => g.join(' plus ')).join(', or ');
			return { rowNumber: s.rowNumber, action: 'reject', targetId: null, before: null, after: null, reason: `No natural key: needs ${need}` };
		}
		const dup = seen.get(nk.key);
		if (dup != null) {
			return { rowNumber: s.rowNumber, action: 'skip', targetId: null, before: null, after: null, reason: `Duplicate of row ${dup} in this file` };
		}
		seen.set(nk.key, s.rowNumber);
		const found = existing.get(nk.key);
		if (found) {
			const before = pick(found.row, snapshotKeys);
			return { rowNumber: s.rowNumber, action: 'update', targetId: found.id, before, after: toAfter(s.values, before), reason: null };
		}
		return { rowNumber: s.rowNumber, action: 'insert', targetId: null, before: null, after: toAfter(s.values, null), reason: null };
	});
}

// ============================================================================
// Supabase targets
// ============================================================================

interface SupabaseTarget {
	table: string;
	/** Columns that identify a row for lookups and reverts. */
	idOf: (row: Row) => string;
	update: (svc: Svc, id: string, cols: Row) => Promise<void>;
	remove: (svc: Svc, id: string) => Promise<void>;
	/** Loads existing rows for the shaped values. Returns natural key to row. */
	lookup: (svc: Svc, shaped: ShapedInput[]) => Promise<Map<string, Existing>>;
	/** Extra resolution of shaped values into table columns (client name to id). */
	resolve?: (svc: Svc, shaped: ShapedInput[]) => Promise<void>;
	/** Keys stored in snapshots beyond the mapped columns. */
	extraSnapshotKeys?: string[];
	/** Turns snapshot values into the columns written to the table. */
	toColumns: (after: Row) => Row;
	/** Reads live rows by id for verification. */
	readCurrent: (svc: Svc, ids: string[]) => Promise<Map<string, Row>>;
	/** Hooks for side tables (contact_roles). */
	afterInsert?: (svc: Svc, id: string, after: Row) => Promise<void>;
	afterUpdate?: (svc: Svc, id: string, before: Row, after: Row) => Promise<void>;
	beforeRevertUpdate?: (svc: Svc, id: string, before: Row, after: Row) => Promise<void>;
	/**
	 * A target whose writes go through a database function instead of row
	 * inserts/updates (rev_prospects → rev_intake). When set, apply / verify /
	 * revert delegate here entirely; plan() still runs the generic lookup.
	 */
	custom?: {
		apply: (svc: Svc, planned: PlannedRow[]) => Promise<PlannedRow[]>;
		verify: (svc: Svc, rows: PlannedRow[]) => Promise<Drift[]>;
		revert: (svc: Svc, rows: PlannedRow[]) => Promise<void>;
	};
}

function omit(row: Row, ...keys: string[]): Row {
	const out: Row = { ...row };
	for (const k of keys) delete out[k];
	return out;
}

function byId(svc: Svc, table: string) {
	return {
		async update(id: string, cols: Row) {
			const { error } = await svc.from(table).update(cols).eq('id', id);
			if (error) throw new Error(`${table} update failed: ${error.message}`);
		},
		async remove(id: string) {
			const { error } = await svc.from(table).delete().eq('id', id);
			if (error) throw new Error(`${table} delete failed: ${error.message}`);
		},
	};
}

async function fetchByIlike(svc: Svc, table: string, column: string, values: string[], select: string): Promise<Row[]> {
	const out: Row[] = [];
	const uniq = [...new Set(values.map(lower).filter(Boolean))];
	for (const part of chunk(uniq, 100)) {
		const { data, error } = await svc.from(table).select(select).ilikeAnyOf(column, part.map(escapeLike));
		if (error) throw new Error(`${table} lookup failed: ${error.message}`);
		out.push(...((data ?? []) as unknown as Row[]));
	}
	return out;
}

const CONTACT_COLUMNS = 'id, display_name, first_name, last_name, email, phone, title, organization, linkedin_url, twitter_handle, notes_md';

async function contactRoles(svc: Svc, ids: string[]): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	for (const part of chunk(ids, 200)) {
		const { data, error } = await svc.from('contact_roles').select('contact_id, role').in('contact_id', part);
		if (error) throw new Error(`contact_roles lookup failed: ${error.message}`);
		for (const r of (data ?? []) as { contact_id: string; role: string }[]) {
			const list = out.get(r.contact_id) ?? [];
			list.push(r.role);
			out.set(r.contact_id, list);
		}
	}
	return out;
}

const contactsTarget: SupabaseTarget = {
	table: 'contacts',
	idOf: (row) => String(row.id),
	update: (svc, id, cols) => byId(svc, 'contacts').update(id, cols),
	remove: (svc, id) => byId(svc, 'contacts').remove(id),
	extraSnapshotKeys: ['roles'],
	async lookup(svc, shaped) {
		const emails = shaped.map((s) => s.values.email).filter((v): v is string => typeof v === 'string');
		const names = shaped.filter((s) => !s.values.email && s.values.display_name).map((s) => String(s.values.display_name));
		const rows: Row[] = [];
		if (emails.length) rows.push(...(await fetchByIlike(svc, 'contacts', 'email', emails, CONTACT_COLUMNS)));
		if (names.length) rows.push(...(await fetchByIlike(svc, 'contacts', 'display_name', names, CONTACT_COLUMNS)));
		const roles = await contactRoles(svc, rows.map((r) => String(r.id)));
		const out = new Map<string, Existing>();
		for (const r of rows) {
			const full = { ...r, roles: roles.get(String(r.id)) ?? [] };
			if (r.email) {
				const k = `email=${lower(r.email)}`;
				if (!out.has(k)) out.set(k, { id: String(r.id), row: full });
			}
			if (r.display_name && r.organization) {
				const k = `display_name=${lower(r.display_name)}|organization=${lower(r.organization)}`;
				if (!out.has(k)) out.set(k, { id: String(r.id), row: full });
			}
		}
		return out;
	},
	toColumns: (after) => omit(after, 'roles'),
	async readCurrent(svc, ids) {
		const out = new Map<string, Row>();
		for (const part of chunk(ids, 200)) {
			const { data, error } = await svc.from('contacts').select(CONTACT_COLUMNS).in('id', part);
			if (error) throw new Error(`contacts read failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) out.set(String(r.id), r);
		}
		const roles = await contactRoles(svc, [...out.keys()]);
		for (const [id, row] of out) row.roles = roles.get(id) ?? [];
		return out;
	},
	async afterInsert(svc, id, after) {
		const roles = (after.roles as string[] | undefined) ?? [];
		if (!roles.length) return;
		const { error } = await svc.from('contact_roles').insert(roles.map((role) => ({ contact_id: id, role })));
		if (error) throw new Error(`contact_roles insert failed: ${error.message}`);
	},
	async afterUpdate(svc, id, before, after) {
		const have = new Set((before.roles as string[] | undefined) ?? []);
		const want = ((after.roles as string[] | undefined) ?? []).filter((r) => !have.has(r));
		if (!want.length) return;
		const { error } = await svc.from('contact_roles').insert(want.map((role) => ({ contact_id: id, role })));
		if (error) throw new Error(`contact_roles insert failed: ${error.message}`);
	},
	async beforeRevertUpdate(svc, id, before, after) {
		const had = new Set((before.roles as string[] | undefined) ?? []);
		const added = ((after.roles as string[] | undefined) ?? []).filter((r) => !had.has(r));
		if (!added.length) return;
		const { error } = await svc.from('contact_roles').delete().eq('contact_id', id).in('role', added);
		if (error) throw new Error(`contact_roles delete failed: ${error.message}`);
	},
};

function simpleTarget(table: string, keyColumn: string, select: string): SupabaseTarget {
	return {
		table,
		idOf: (row) => String(row.id),
		update: (svc, id, cols) => byId(svc, table).update(id, cols),
		remove: (svc, id) => byId(svc, table).remove(id),
		async lookup(svc, shaped) {
			const values = shaped.map((s) => s.values[keyColumn]).filter((v): v is string => typeof v === 'string');
			const rows = values.length ? await fetchByIlike(svc, table, keyColumn, values, select) : [];
			const out = new Map<string, Existing>();
			for (const r of rows) {
				const k = `${keyColumn}=${lower(r[keyColumn])}`;
				if (!out.has(k)) out.set(k, { id: String(r.id), row: r });
			}
			return out;
		},
		toColumns: (after) => after,
		async readCurrent(svc, ids) {
			const out = new Map<string, Row>();
			for (const part of chunk(ids, 200)) {
				const { data, error } = await svc.from(table).select(select).in('id', part);
				if (error) throw new Error(`${table} read failed: ${error.message}`);
				for (const r of (data ?? []) as unknown as Row[]) out.set(String(r.id), r);
			}
			return out;
		},
	};
}

const prospectsTarget = simpleTarget(
	'prospects',
	'name',
	'id, name, stage, source, industry, estimated_mrr_cents, pitched_at, notes_md',
);

const mediaOutletsTarget = simpleTarget(
	'media_outlets',
	'domain',
	'id, name, domain, website, location, media_types, categories, tier, bio',
);

const ALIAS_SELECT = 'client_id, source, external_id, raw_name, confidence';

const clientAliasesTarget: SupabaseTarget = {
	table: 'client_aliases',
	idOf: (row) => `${row.source}/${row.external_id}`,
	async update(svc, id, cols) {
		const i = id.indexOf('/');
		const { error } = await svc.from('client_aliases').update(cols).eq('source', id.slice(0, i)).eq('external_id', id.slice(i + 1));
		if (error) throw new Error(`client_aliases update failed: ${error.message}`);
	},
	async remove(svc, id) {
		const i = id.indexOf('/');
		const { error } = await svc.from('client_aliases').delete().eq('source', id.slice(0, i)).eq('external_id', id.slice(i + 1));
		if (error) throw new Error(`client_aliases delete failed: ${error.message}`);
	},
	extraSnapshotKeys: ['client_id'],
	async resolve(svc, shaped) {
		const names = [...new Set(shaped.map((s) => s.values.client_name).filter((v): v is string => typeof v === 'string').map(lower))];
		const byKey = new Map<string, string>();
		for (const part of chunk(names, 100)) {
			const { data, error } = await svc.from('clients_v2').select('id, display_name_key').in('display_name_key', part);
			if (error) throw new Error(`clients_v2 lookup failed: ${error.message}`);
			for (const r of (data ?? []) as { id: string; display_name_key: string }[]) byKey.set(r.display_name_key, r.id);
		}
		for (const s of shaped) {
			if (s.errors.length) continue;
			const id = byKey.get(lower(s.values.client_name));
			if (!id) {
				s.errors.push(`Client "${String(s.values.client_name)}" not found in clients_v2`);
				continue;
			}
			s.values.client_id = id;
			if (s.values.confidence == null) s.values.confidence = 1;
		}
	},
	async lookup(svc, shaped) {
		const ids = [...new Set(shaped.map((s) => s.values.external_id).filter((v): v is string => typeof v === 'string'))];
		const out = new Map<string, Existing>();
		for (const part of chunk(ids, 100)) {
			const { data, error } = await svc.from('client_aliases').select(ALIAS_SELECT).in('external_id', part);
			if (error) throw new Error(`client_aliases lookup failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) {
				out.set(`source=${lower(r.source)}|external_id=${lower(r.external_id)}`, { id: `${r.source}/${r.external_id}`, row: r });
			}
		}
		return out;
	},
	toColumns: (after) => omit(after, 'client_name'),
	async readCurrent(svc, ids) {
		const out = new Map<string, Row>();
		const ext = ids.map((id) => id.slice(id.indexOf('/') + 1));
		for (const part of chunk([...new Set(ext)], 100)) {
			const { data, error } = await svc.from('client_aliases').select(ALIAS_SELECT).in('external_id', part);
			if (error) throw new Error(`client_aliases read failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) out.set(`${r.source}/${r.external_id}`, r);
		}
		return out;
	},
};

const METRIC_SELECT = 'id, subject_type, subject_id, subject_ref, subject_key, metric_key, period, value, goal, source';

const metricsTarget: SupabaseTarget = {
	table: 'metrics',
	idOf: (row) => String(row.id),
	update: (svc, id, cols) => byId(svc, 'metrics').update(id, cols),
	remove: (svc, id) => byId(svc, 'metrics').remove(id),
	extraSnapshotKeys: ['subject_id', 'source'],
	async resolve(svc, shaped) {
		const emails = [...new Set(shaped.map((s) => s.values.subject_email).filter((v): v is string => typeof v === 'string').map(lower))];
		const profileByEmail = new Map<string, string>();
		if (emails.length) {
			for (const r of await fetchByIlike(svc, 'profiles', 'email', emails, 'id, email')) profileByEmail.set(lower(r.email), String(r.id));
		}
		const keys = [...new Set(shaped.map((s) => s.values.metric_key).filter((v): v is string => typeof v === 'string'))];
		const known = new Set<string>();
		for (const part of chunk(keys, 100)) {
			const { data, error } = await svc.from('metric_definitions').select('key').in('key', part);
			if (error) throw new Error(`metric_definitions lookup failed: ${error.message}`);
			for (const r of (data ?? []) as { key: string }[]) known.add(r.key);
		}
		for (const s of shaped) {
			if (s.errors.length) continue;
			if (!known.has(String(s.values.metric_key))) s.errors.push(`Metric key "${String(s.values.metric_key)}" is not in the Metrics Catalog`);
			if (s.values.subject_type === 'user') {
				const id = s.values.subject_email ? profileByEmail.get(lower(s.values.subject_email)) : null;
				if (!id) s.errors.push(`No profile with email "${String(s.values.subject_email ?? '')}"`);
				else {
					s.values.subject_id = id;
					delete s.values.subject_ref;
				}
			} else if (!s.values.subject_ref) {
				s.errors.push('Subject reference is required for client and team rows');
			}
			if (s.values.value == null && s.values.goal == null) s.errors.push('Value or goal is required');
			s.values.source = 'manual';
		}
	},
	async lookup(svc, shaped) {
		const keys = [...new Set(shaped.map((s) => s.values.metric_key).filter((v): v is string => typeof v === 'string'))];
		const periods = [...new Set(shaped.map((s) => s.values.period).filter((v): v is string => typeof v === 'string'))];
		const out = new Map<string, Existing>();
		if (!keys.length || !periods.length) return out;
		for (const part of chunk(keys, 50)) {
			const { data, error } = await svc.from('metrics').select(METRIC_SELECT).eq('source', 'manual').in('metric_key', part).in('period', periods);
			if (error) throw new Error(`metrics lookup failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) {
				const base = `subject_type=${lower(r.subject_type)}`;
				const tail = `|metric_key=${lower(r.metric_key)}|period=${lower(r.period)}`;
				if (r.subject_id) out.set(`${base}|subject_id=${lower(r.subject_id)}${tail}`, { id: String(r.id), row: r });
				if (r.subject_ref) out.set(`${base}|subject_ref=${lower(r.subject_ref)}${tail}`, { id: String(r.id), row: r });
			}
		}
		return out;
	},
	toColumns: (after) => omit(after, 'subject_email'),
	async readCurrent(svc, ids) {
		const out = new Map<string, Row>();
		for (const part of chunk(ids, 200)) {
			const { data, error } = await svc.from('metrics').select(METRIC_SELECT).in('id', part);
			if (error) throw new Error(`metrics read failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) out.set(String(r.id), r);
		}
		return out;
	},
};

const MEDIA_OPP_SELECT =
	'id, client_id, airtable_record_id, source, title, story_title, potential_story, outlet_name, outlet_url, status_raw, date_secured, date_sent_to_client, date_added, live_link, live_date, reach, media_tier, category, opp_type, secured_by, notes';

/** Org tag slugs whose clients this table holds. Beacon rows live in Beacon's DB. */
const MEDIA_OPP_ORG_SLUGS: ReadonlySet<string> = new Set(['org-main', 'org-premium', 'org-main-marketing']);
const BEACON_ORG_SLUG = 'org-beacon';

/**
 * Media Opportunities (0116). The client is resolved by NAME with the same
 * resolver /api/cron/opp-months uses (display names + client_aliases, exact
 * first, then a diacritic fold that must be unique). Three outcomes per row:
 *   - resolves to a Open Ronin-family client         -> insert/update
 *   - resolves to a Beacon-tagged client       -> skip (counted, never written;
 *                                                 t_2a16ef81 seeds those in Beacon)
 *   - no match / ambiguous / untagged / empty  -> reject with the reason
 * Nothing is guessed: an untagged client is a classification question for
 * Alex, not a default.
 */
const mediaOpportunitiesTarget: SupabaseTarget = {
	table: 'media_opportunities',
	idOf: (row) => String(row.id),
	update: (svc, id, cols) => byId(svc, 'media_opportunities').update(id, cols),
	remove: (svc, id) => byId(svc, 'media_opportunities').remove(id),
	extraSnapshotKeys: ['client_id', 'source'],
	async resolve(svc, shaped) {
		const live = shaped.filter((s) => !s.errors.length);
		if (!live.length) return;
		const [{ data: clients, error: cErr }, { data: aliases, error: aErr }, { data: tags, error: tErr }] = await Promise.all([
			svc.from('clients_v2').select('id, display_name, org_tag_id').returns<{ id: string; display_name: string; org_tag_id: string | null }[]>(),
			svc.from('client_aliases').select('client_id, raw_name').not('raw_name', 'is', null).returns<{ client_id: string; raw_name: string }[]>(),
			svc.from('tags').select('id, slug').eq('category', 'org').returns<{ id: string; slug: string }[]>(),
		]);
		if (cErr || aErr || tErr) throw new Error(`client lookup failed: ${cErr?.message ?? aErr?.message ?? tErr?.message}`);
		const resolveName = buildNameResolver(clients ?? [], aliases ?? []);
		const slugByTag = new Map((tags ?? []).map((t) => [t.id, t.slug]));
		const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
		for (const s of live) {
			const raw = String(s.values.client_name ?? '').trim();
			if (!raw) {
				s.errors.push('Client is empty');
				continue;
			}
			const id = resolveName(raw);
			const client = id ? clientById.get(id) : undefined;
			if (!client) {
				s.errors.push(`Client "${raw}" does not resolve to exactly one clients_v2 row`);
				continue;
			}
			const slug = client.org_tag_id ? slugByTag.get(client.org_tag_id) : undefined;
			if (slug === BEACON_ORG_SLUG) {
				s.skip = `Beacon client "${client.display_name}": seeded in Beacon's own media_opportunities, not here`;
				continue;
			}
			if (!slug || !MEDIA_OPP_ORG_SLUGS.has(slug)) {
				s.errors.push(`Client "${client.display_name}" has ${slug ? `org tag ${slug}` : 'no org tag'}; flag for Alex, not guessed`);
				continue;
			}
			s.values.client_id = client.id;
			s.values.source = 'airtable';
		}
	},
	async lookup(svc, shaped) {
		const ids = [...new Set(shaped.map((s) => s.values.airtable_record_id).filter((v): v is string => typeof v === 'string'))];
		const out = new Map<string, Existing>();
		for (const part of chunk(ids, 100)) {
			const { data, error } = await svc.from('media_opportunities').select(MEDIA_OPP_SELECT).in('airtable_record_id', part);
			if (error) throw new Error(`media_opportunities lookup failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) out.set(`airtable_record_id=${lower(r.airtable_record_id)}`, { id: String(r.id), row: r });
		}
		return out;
	},
	toColumns: (after) => omit(after, 'client_name'),
	async readCurrent(svc, ids) {
		const out = new Map<string, Row>();
		for (const part of chunk(ids, 200)) {
			const { data, error } = await svc.from('media_opportunities').select(MEDIA_OPP_SELECT).in('id', part);
			if (error) throw new Error(`media_opportunities read failed: ${error.message}`);
			for (const r of (data ?? []) as Row[]) out.set(String(r.id), r);
		}
		return out;
	},
};

// ----------------------------------------------------------------------------
// Revenue Engine prospects (0121). Every row is one rev_intake() call, so the
// dedupe order (LinkedIn → phone → email → domain+name) and the "reuse the
// open deal for this brand + motion" rule are the database's, not a copy
// here. plan() only decides insert vs update by looking the identity keys up
// in rev_people; apply() calls the function; the after snapshot carries the
// ids it returned so verify() can confirm the deal still exists and revert()
// can call rev_intake_revert() on the deals this batch created (and no
// others: a matched person or an existing deal is left alone).
// ----------------------------------------------------------------------------

const REV_PERSON_SELECT = 'id, display_name, email, phone, linkedin_url, title, instagram, location';

function revIntakePayload(after: Row): Record<string, unknown> {
	const p: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(after)) {
		if (v == null || v === '' || k.startsWith('_')) continue;
		p[k] = v;
	}
	p.created_via = 'import';
	p.activity = { kind: 'system', subject: 'Imported', is_touch: false };
	if (!p.pipeline) p.pipeline = 'lead-gen';
	return p;
}

const revProspectsTarget: SupabaseTarget = {
	table: 'rev_people',
	idOf: (row) => String(row.id),
	update: async () => {
		/* writes go through rev_intake (custom.apply) */
	},
	remove: async () => {
		/* reverts go through rev_intake_revert (custom.revert) */
	},
	async lookup(svc, shaped) {
		const out = new Map<string, Existing>();
		const emails = shaped.map((s) => s.values.email).filter((v): v is string => typeof v === 'string');
		const phones = shaped.map((s) => s.values.phone).filter((v): v is string => typeof v === 'string');
		const linkedins = shaped.map((s) => s.values.linkedin_url).filter((v): v is string => typeof v === 'string');
		const brands = shaped.map((s) => s.values.brand_name).filter((v): v is string => typeof v === 'string');
		const rows: Row[] = [];
		if (emails.length) rows.push(...(await fetchByIlike(svc, 'rev_people', 'email', emails, REV_PERSON_SELECT)));
		if (phones.length) {
			const digits = phones.map((p) => p.replace(/[^0-9+]/g, ''));
			for (const part of chunk([...new Set(digits)], 100)) {
				const { data, error } = await svc.from('rev_people').select(REV_PERSON_SELECT).in('phone', part);
				if (error) throw new Error(`rev_people lookup failed: ${error.message}`);
				rows.push(...((data ?? []) as unknown as Row[]));
			}
		}
		if (linkedins.length) {
			const keys = [...new Set(linkedins.map((u) => u.toLowerCase().replace(/^(https?:\/\/)?(www\.)?linkedin\.com\/in\//, '').replace(/\/+$/, '').replace(/\?.*$/, '')))].filter(Boolean);
			for (const part of chunk(keys, 100)) {
				const { data, error } = await svc.from('rev_people').select(REV_PERSON_SELECT).in('linkedin_key', part);
				if (error) throw new Error(`rev_people lookup failed: ${error.message}`);
				rows.push(...((data ?? []) as unknown as Row[]));
			}
		}
		for (const r of rows) {
			if (r.email) out.set(`email=${lower(r.email)}`, { id: String(r.id), row: r });
			if (r.phone) out.set(`phone=${lower(r.phone)}`, { id: String(r.id), row: r });
			if (r.linkedin_url) {
				const k = String(r.linkedin_url).toLowerCase().replace(/^(https?:\/\/)?(www\.)?linkedin\.com\/in\//, '').replace(/\/+$/, '').replace(/\?.*$/, '');
				out.set(`linkedin_url=${lower(r.linkedin_url)}`, { id: String(r.id), row: r });
				out.set(`linkedin_url=${k}`, { id: String(r.id), row: r });
			}
		}
		// A row with only a brand name matches the brand's primary person (so a
		// second line for the same brand updates, not duplicates).
		if (brands.length) {
			const brandRows = await fetchByIlike(svc, 'rev_brands', 'name', brands, 'id, name');
			const ids = brandRows.map((b) => String(b.id));
			if (ids.length) {
				const { data } = await svc.from('rev_person_links').select(`brand_id, is_primary, rev_people(${REV_PERSON_SELECT})`).in('brand_id', ids).eq('is_primary', true);
				const byBrand = new Map(brandRows.map((b) => [String(b.id), lower(b.name)]));
				for (const l of (data ?? []) as unknown as { brand_id: string; rev_people: Row | Row[] | null }[]) {
					const p = Array.isArray(l.rev_people) ? l.rev_people[0] : l.rev_people;
					if (p) out.set(`brand_name=${byBrand.get(l.brand_id)}`, { id: String(p.id), row: p });
				}
			}
		}
		return out;
	},
	toColumns: (after) => after,
	async readCurrent(svc, ids) {
		const out = new Map<string, Row>();
		for (const part of chunk(ids, 200)) {
			const { data, error } = await svc.from('rev_people').select(REV_PERSON_SELECT).in('id', part);
			if (error) throw new Error(`rev_people read failed: ${error.message}`);
			for (const r of (data ?? []) as unknown as Row[]) out.set(String(r.id), r);
		}
		return out;
	},
	custom: {
		async apply(svc, planned) {
			const out: PlannedRow[] = [];
			for (const p of planned) {
				if (p.action !== 'insert' && p.action !== 'update') {
					out.push(p);
					continue;
				}
				const { data, error } = await svc.rpc('rev_intake', { p: revIntakePayload(p.after ?? {}) });
				if (error) {
					out.push({ ...p, action: 'reject', targetId: null, reason: error.message });
					continue;
				}
				const r = data as { deal_id: string | null; person_id: string; brand_id: string | null; matched_on: string | null; created: Record<string, string> };
				const createdDeal = !!r.created?.deal;
				out.push({
					...p,
					action: createdDeal ? 'insert' : 'update',
					targetId: r.person_id,
					after: { ...(p.after ?? {}), _deal_id: r.deal_id, _person_id: r.person_id, _brand_id: r.brand_id, _created_deal: createdDeal, _matched_on: r.matched_on },
					reason: r.matched_on ? `Matched existing person on ${r.matched_on}` : createdDeal ? null : 'Reused the open deal',
				});
			}
			return out.sort((a, b) => a.rowNumber - b.rowNumber);
		},
		async verify(svc, rows) {
			const dealIds = rows.map((r) => r.after?._deal_id).filter((v): v is string => typeof v === 'string');
			const live = new Set<string>();
			for (const part of chunk([...new Set(dealIds)], 200)) {
				const { data, error } = await svc.from('rev_deals').select('id').in('id', part);
				if (error) throw new Error(`rev_deals read failed: ${error.message}`);
				for (const d of (data ?? []) as { id: string }[]) live.add(d.id);
			}
			const drifts: Drift[] = [];
			for (const r of rows) {
				const id = r.after?._deal_id;
				if (typeof id === 'string' && !live.has(id)) drifts.push({ rowNumber: r.rowNumber, targetId: r.targetId, keys: ['deal deleted'] });
			}
			return drifts;
		},
		async revert(svc, rows) {
			for (const r of [...rows].sort((a, b) => b.rowNumber - a.rowNumber)) {
				const id = r.after?._deal_id;
				if (typeof id !== 'string' || !r.after?._created_deal) continue;
				const { error } = await svc.rpc('rev_intake_revert', { p_deal: id });
				if (error) throw new Error(`rev_intake_revert failed: ${error.message}`);
			}
		},
	},
};

const SUPABASE_TARGETS: Record<Exclude<TargetKey, 'airtable'>, SupabaseTarget> = {
	contacts: contactsTarget,
	prospects: prospectsTarget,
	media_outlets: mediaOutletsTarget,
	client_aliases: clientAliasesTarget,
	metrics: metricsTarget,
	media_opportunities: mediaOpportunitiesTarget,
	rev_prospects: revProspectsTarget,
};

// Metrics rows match on subject id after resolution, so the natural key
// groups differ from the file facing ones in targets.ts.
function groupsFor(target: TargetKey): string[][] {
	if (target === 'metrics') return [['subject_type', 'subject_id', 'metric_key', 'period'], ['subject_type', 'subject_ref', 'metric_key', 'period']];
	return naturalKeyGroups(target);
}

function snapshotKeysFor(target: Exclude<TargetKey, 'airtable'>, mapping: Mapping, columns: ColumnSpec[]): string[] {
	const t = SUPABASE_TARGETS[target];
	const keys = new Set(mappedKeys(mapping, columns));
	for (const k of t.extraSnapshotKeys ?? []) keys.add(k);
	// File facing keys that resolve to something else are not table columns.
	if (target === 'client_aliases') keys.delete('client_name');
	if (target === 'metrics') keys.delete('subject_email');
	if (target === 'media_opportunities') keys.delete('client_name');
	return [...keys];
}

export async function planSupabase(svc: Svc, input: PlanInput): Promise<PlannedRow[]> {
	if (input.target === 'airtable') throw new Error('planSupabase called with the airtable target');
	const t = SUPABASE_TARGETS[input.target];
	const shaped = shapeAll(input);
	if (t.resolve) await t.resolve(svc, shaped);
	const existing = await t.lookup(svc, shaped.filter((s) => !s.errors.length));
	const keys = snapshotKeysFor(input.target, input.mapping, input.columns);
	return planFromLookup(shaped, groupsFor(input.target), existing, keys, (values, before) => {
		const after: Row = { ...(before ?? {}) };
		for (const k of keys) if (values[k] !== undefined) after[k] = values[k];
		if (input.target === 'contacts') {
			const had = (before?.roles as string[] | undefined) ?? [];
			const want = (values.roles as string[] | undefined) ?? [];
			after.roles = [...new Set([...had, ...want])];
		}
		return after;
	});
}

export async function applySupabase(svc: Svc, target: TargetKey, planned: PlannedRow[]): Promise<PlannedRow[]> {
	if (target === 'airtable') throw new Error('applySupabase called with the airtable target');
	const t = SUPABASE_TARGETS[target];
	if (t.custom) return t.custom.apply(svc, planned);
	const out: PlannedRow[] = [];

	const inserts = planned.filter((p) => p.action === 'insert');
	for (const part of chunk(inserts, 100)) {
		const rows = part.map((p) => t.toColumns(p.after ?? {}));
		const { data, error } = await svc.from(t.table).insert(rows).select('*');
		if (error) throw new Error(`${t.table} insert failed: ${error.message}`);
		const created = (data ?? []) as Row[];
		if (created.length !== part.length) throw new Error(`${t.table} insert returned ${created.length} rows for ${part.length}`);
		for (let i = 0; i < part.length; i++) {
			const id = t.idOf(created[i]);
			if (t.afterInsert) await t.afterInsert(svc, id, part[i].after ?? {});
			out.push({ ...part[i], targetId: id });
		}
	}

	for (const p of planned.filter((x) => x.action === 'update')) {
		if (!p.targetId) continue;
		await t.update(svc, p.targetId, t.toColumns(p.after ?? {}));
		if (t.afterUpdate) await t.afterUpdate(svc, p.targetId, p.before ?? {}, p.after ?? {});
		out.push(p);
	}

	for (const p of planned.filter((x) => x.action === 'reject' || x.action === 'skip')) out.push(p);
	return out.sort((a, b) => a.rowNumber - b.rowNumber);
}

export async function verifySupabase(svc: Svc, target: TargetKey, rows: PlannedRow[]): Promise<Drift[]> {
	if (target === 'airtable') throw new Error('verifySupabase called with the airtable target');
	const t = SUPABASE_TARGETS[target];
	if (t.custom) return t.custom.verify(svc, rows);
	const ids = rows.map((r) => r.targetId).filter((v): v is string => !!v);
	const current = await t.readCurrent(svc, ids);
	const drifts: Drift[] = [];
	for (const r of rows) {
		if (!r.targetId) continue;
		const live = current.get(r.targetId);
		if (!live) {
			drifts.push({ rowNumber: r.rowNumber, targetId: r.targetId, keys: ['row deleted'] });
			continue;
		}
		const keys = driftedKeys(r.after, pick(live, Object.keys(r.after ?? {})));
		if (keys.length) drifts.push({ rowNumber: r.rowNumber, targetId: r.targetId, keys });
	}
	return drifts;
}

export async function revertSupabase(svc: Svc, target: TargetKey, rows: PlannedRow[]): Promise<void> {
	if (target === 'airtable') throw new Error('revertSupabase called with the airtable target');
	const t = SUPABASE_TARGETS[target];
	if (t.custom) return t.custom.revert(svc, rows);
	// Reverse order so a row updated twice in one file (not possible within
	// a chunk, possible across chunks) unwinds to its earliest before.
	const ordered = [...rows].sort((a, b) => b.rowNumber - a.rowNumber);
	for (const r of ordered) {
		if (!r.targetId) continue;
		if (r.action === 'insert') {
			await t.remove(svc, r.targetId);
		} else if (r.action === 'update') {
			if (t.beforeRevertUpdate) await t.beforeRevertUpdate(svc, r.targetId, r.before ?? {}, r.after ?? {});
			await t.update(svc, r.targetId, t.toColumns(r.before ?? {}));
		}
	}
}

// ============================================================================
// Airtable target (through the data adapter)
// ============================================================================

function airtableRef(targetRef: string | null): { baseId: string; table: string } {
	const i = (targetRef ?? '').indexOf('/');
	if (i < 1) throw new Error('Airtable target needs a base and table');
	return { baseId: targetRef!.slice(0, i), table: targetRef!.slice(i + 1) };
}

function formulaString(v: string): string {
	return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function planAirtable(adapter: DataAdapter, input: PlanInput): Promise<PlannedRow[]> {
	const { baseId, table } = airtableRef(input.targetRef);
	const keyField = String(input.options.keyField ?? '');
	if (!keyField) throw new Error('Pick the Airtable field that identifies a record');
	const shaped = shapeAll(input);
	const keys = mappedKeys(input.mapping, input.columns);
	if (!keys.includes(keyField)) {
		for (const s of shaped) s.errors.push(`The key field "${keyField}" is not mapped`);
	}

	const values = [...new Set(shaped.filter((s) => !s.errors.length).map((s) => s.values[keyField]).filter((v) => v != null).map(String))];
	const existing = new Map<string, Existing>();
	for (const part of chunk(values, 40)) {
		const filter = `OR(${part.map((v) => `LOWER({${keyField}})=LOWER(${formulaString(v)})`).join(',')})`;
		let cursor: string | undefined;
		do {
			const res = await adapter.list<Row>(baseId, table, { filter, fields: keys, cursor, noCache: true, pageSize: 100 });
			for (const r of res.rows) {
				const k = `${keyField}=${lower(r.fields[keyField])}`;
				if (!existing.has(k)) existing.set(k, { id: r.id, row: r.fields });
			}
			cursor = res.cursor;
		} while (cursor);
	}

	return planFromLookup(shaped, [[keyField]], existing, keys, (vals, before) => {
		const after: Row = { ...(before ?? {}) };
		for (const k of keys) if (vals[k] !== undefined) after[k] = vals[k];
		return after;
	});
}

export async function applyAirtable(adapter: DataAdapter, targetRef: string | null, planned: PlannedRow[]): Promise<PlannedRow[]> {
	const { baseId, table } = airtableRef(targetRef);
	if (!adapter.createMany || !adapter.updateMany) throw new Error('The data adapter does not support batch writes');
	const out: PlannedRow[] = [];
	const inserts = planned.filter((p) => p.action === 'insert');
	if (inserts.length) {
		const created = await adapter.createMany<Row>(baseId, table, inserts.map((p) => p.after ?? {}));
		if (created.length !== inserts.length) throw new Error(`Airtable create returned ${created.length} records for ${inserts.length}`);
		inserts.forEach((p, i) => out.push({ ...p, targetId: created[i].id }));
	}
	const updates = planned.filter((p) => p.action === 'update' && p.targetId);
	if (updates.length) {
		await adapter.updateMany<Row>(baseId, table, updates.map((p) => ({ id: p.targetId!, fields: p.after ?? {} })));
		out.push(...updates);
	}
	for (const p of planned.filter((x) => x.action === 'reject' || x.action === 'skip')) out.push(p);
	return out.sort((a, b) => a.rowNumber - b.rowNumber);
}

async function readAirtable(adapter: DataAdapter, targetRef: string | null, rows: PlannedRow[]): Promise<Map<string, Row | null>> {
	const { baseId, table } = airtableRef(targetRef);
	const out = new Map<string, Row | null>();
	for (const r of rows) {
		if (!r.targetId) continue;
		const rec = await adapter.get<Row>(baseId, table, r.targetId);
		out.set(r.targetId, rec ? rec.fields : null);
	}
	return out;
}

export async function verifyAirtable(adapter: DataAdapter, targetRef: string | null, rows: PlannedRow[]): Promise<Drift[]> {
	const current = await readAirtable(adapter, targetRef, rows);
	const drifts: Drift[] = [];
	for (const r of rows) {
		if (!r.targetId) continue;
		const live = current.get(r.targetId);
		if (!live) {
			drifts.push({ rowNumber: r.rowNumber, targetId: r.targetId, keys: ['record deleted'] });
			continue;
		}
		const keys = driftedKeys(r.after, pick(live, Object.keys(r.after ?? {})));
		if (keys.length) drifts.push({ rowNumber: r.rowNumber, targetId: r.targetId, keys });
	}
	return drifts;
}

export async function revertAirtable(adapter: DataAdapter, targetRef: string | null, rows: PlannedRow[]): Promise<void> {
	const { baseId, table } = airtableRef(targetRef);
	const ordered = [...rows].sort((a, b) => b.rowNumber - a.rowNumber);
	for (const r of ordered) {
		if (!r.targetId) continue;
		if (r.action === 'insert') await adapter.delete(baseId, table, r.targetId);
		else if (r.action === 'update') {
			// Fields absent from before were empty in Airtable: send null to clear.
			const fields: Row = {};
			for (const k of Object.keys(r.after ?? {})) fields[k] = r.before?.[k] ?? null;
			await adapter.update<Row>(baseId, table, r.targetId, fields);
		}
	}
}

export function columnsForTarget(target: TargetKey, airtableFields?: FieldSchema[]): ColumnSpec[] {
	if (target === 'airtable') return airtableColumns(airtableFields ?? []);
	return targetInfo(target).columns;
}
