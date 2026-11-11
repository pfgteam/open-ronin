import { describe, expect, it } from 'vitest';
import { assessable, isInternalStaff, loadCalibrationPeople } from './people';

type Row = Record<string, unknown>;

/** Minimal PostgREST-shaped fake: `select(cols)` decides the outcome. */
function fakeClient(opts: { hasFlag: boolean; rows: Row[] }) {
	const calls: string[] = [];
	const chain = (cols: string) => {
		calls.push(cols);
		const missing = !opts.hasFlag && cols.includes('calibration_excluded');
		const result = missing
			? { data: null, error: { code: '42703', message: 'column profiles.calibration_excluded does not exist' } }
			: { data: opts.rows.map((r) => (opts.hasFlag ? r : { ...r, calibration_excluded: undefined })), error: null };
		const q = {
			eq: () => q,
			order: () => q,
			then: (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res),
		};
		return q;
	};
	return { client: { from: () => ({ select: chain }) } as never, calls };
}

const rows: Row[] = [
	{ id: 'a', email: 'owner@example.com', role: 'exec', first_name: 'Alex', last_name: 'Morgan', department_tag_id: null, manager_id: null, calibration_excluded: false },
	{ id: 'v', email: 'user-3895da@example.com', role: 'contributor', first_name: 'Vera', last_name: 'Morgan', department_tag_id: null, manager_id: 'a', calibration_excluded: true },
];

describe('assessable (0118: internal staff only)', () => {
	it('drops excluded people and anyone outside the staff domains / roles', () => {
		const people = [
			{ id: 'a', email: 'owner@example.com', role: 'exec', calibration_excluded: false },
			{ id: 'r', email: 'user-b937b2@example.org', role: 'contributor', calibration_excluded: false },
			{ id: 'x', email: 'user-3895da@example.com', role: 'contributor', calibration_excluded: true },
			{ id: 'c', email: 'client@acme.com', role: 'contributor', calibration_excluded: false },
			{ id: 'b', email: 'user-c71e72@example.com', role: 'bot', calibration_excluded: false },
		];
		expect(assessable(people).map((p) => p.id)).toEqual(['a', 'r']);
		expect(isInternalStaff({ email: 'user-ca29f2@example.com', role: 'manager' })).toBe(true);
	});
});

describe('loadCalibrationPeople (0117)', () => {
	it('reads the flag when the column exists', async () => {
		const { client, calls } = fakeClient({ hasFlag: true, rows });
		const r = await loadCalibrationPeople(client);
		expect(r.flagAvailable).toBe(true);
		expect(calls).toHaveLength(1);
		expect(r.people.find((p) => p.id === 'v')?.calibration_excluded).toBe(true);
		expect(assessable(r.people).map((p) => p.id)).toEqual(['a']);
	});

	it('falls back to the pre-0117 column list and treats everyone as assessed', async () => {
		const { client, calls } = fakeClient({ hasFlag: false, rows });
		const r = await loadCalibrationPeople(client);
		expect(r.flagAvailable).toBe(false);
		expect(calls).toHaveLength(2);
		expect(calls[1]).not.toContain('calibration_excluded');
		expect(r.people.every((p) => p.calibration_excluded === false)).toBe(true);
		expect(assessable(r.people)).toHaveLength(2);
	});
});
