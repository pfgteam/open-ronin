import { describe, expect, it } from 'vitest';
import { groupByShape } from './upsert';

// Pins the silent data loss in ingest upserts: supabase-js builds PostgREST's
// `columns=` from the UNION of keys across the batch, so in a mixed batch a
// row that omitted `calls_attended` still got
// `calls_attended = EXCLUDED.calls_attended` and wrote the column default (0)
// over the stored value. Splitting the batch by key signature is what keeps
// an unmentioned field out of that group's column list.

type Row = Record<string, unknown>;

const groupsOf = (rows: Row[]) => [...groupByShape(rows).values()];

describe('groupByShape', () => {
	it('keeps a uniform batch in one group', () => {
		const rows: Row[] = [
			{ client_id: 'a', month: '2026-08', calls_attended: 3, calls_scheduled: 4 },
			{ client_id: 'b', month: '2026-08', calls_attended: 1, calls_scheduled: 2 },
		];
		const groups = groupsOf(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toHaveLength(2);
	});

	it('splits a mixed batch and leaves the absent key out entirely', () => {
		const rows: Row[] = [
			{ client_id: 'a', month: '2026-08', calls_attended: 3 },
			{ client_id: 'b', month: '2026-08' },
		];
		const groups = groupsOf(rows);
		expect(groups).toHaveLength(2);

		const without = groups.find((g) => !('calls_attended' in g[0]));
		expect(without).toBeDefined();
		// The whole point: the key must not merely be undefined, it must be gone,
		// or supabase-js puts it back into `columns=`.
		expect(Object.keys(without![0])).toEqual(['client_id', 'month']);
		expect('calls_attended' in without![0]).toBe(false);
	});

	it('treats an explicit undefined as absent and strips it from the row', () => {
		const rows: Row[] = [{ client_id: 'a', month: '2026-08', calls_attended: undefined }];
		const groups = groupsOf(rows);
		expect(groups).toHaveLength(1);
		expect('calls_attended' in groups[0][0]).toBe(false);
		expect(Object.keys(groups[0][0])).toEqual(['client_id', 'month']);
	});

	it('groups an explicit undefined with a row that omitted the key', () => {
		const rows: Row[] = [
			{ client_id: 'a', month: '2026-08', calls_attended: undefined },
			{ client_id: 'b', month: '2026-08' },
		];
		expect(groupsOf(rows)).toHaveLength(1);
	});

	it('keeps an explicit null — the sender is clearing the column on purpose', () => {
		const rows: Row[] = [{ client_id: 'a', month: '2026-08', calls_attended: null }];
		const groups = groupsOf(rows);
		expect('calls_attended' in groups[0][0]).toBe(true);
		expect(groups[0][0].calls_attended).toBeNull();
	});

	it('does not group an explicit null with an omitted key', () => {
		const rows: Row[] = [
			{ client_id: 'a', month: '2026-08', calls_attended: null },
			{ client_id: 'b', month: '2026-08' },
		];
		expect(groupsOf(rows)).toHaveLength(2);
	});

	it('ignores key order', () => {
		const rows: Row[] = [
			{ a: 1, b: 2 },
			{ b: 9, a: 8 },
		];
		const groups = groupsOf(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toHaveLength(2);
	});

	it('returns an empty map for an empty batch', () => {
		expect(groupByShape([])).toBeInstanceOf(Map);
		expect(groupByShape([]).size).toBe(0);
	});

	it('loses no row: every input lands in exactly one group', () => {
		const rows: Row[] = [
			{ client_id: 'a', calls_attended: 1 },
			{ client_id: 'b' },
			{ client_id: 'c', calls_attended: 2, pitches: 20 },
			{ client_id: 'd', pitches: 15 },
			{ client_id: 'e', calls_attended: 3 },
		];
		const groups = groupsOf(rows);
		const flat = groups.flat();
		expect(flat).toHaveLength(rows.length);
		expect(groups).toHaveLength(4);
		expect(flat.map((r) => r.client_id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('does not mutate the input rows', () => {
		const row: Row = { client_id: 'a', calls_attended: undefined };
		groupByShape([row]);
		expect('calls_attended' in row).toBe(true);
	});
});
