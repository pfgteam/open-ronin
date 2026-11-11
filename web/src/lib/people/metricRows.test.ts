import { describe, it, expect } from 'vitest';
import {
	resolveMetricRows,
	diffToOverrides,
	specialtyFingerprint,
	type MetricDefLike,
} from './metricRows';

const defs: MetricDefLike[] = [
	{ key: 'leading', pap_positions: ['Ops'], sort: 40 },
	{ key: 'projects_completed', pap_positions: ['Ops'], sort: 400 },
	{ key: 'team_retention', pap_positions: [], sort: 990 },
	{ key: 'v2_tasks_completed', pap_positions: ['Ops'], sort: 1010 },
	{ key: 'pitches_sent', pap_positions: ['Publicist'], sort: 100 },
];

const keys = (rows: { def: MetricDefLike }[]) => rows.map((r) => r.def.key);

describe('resolveMetricRows', () => {
	it('gives the specialty its set and nothing else', () => {
		const rows = resolveMetricRows({ defs, papPosition: 'Ops', overrides: [], keysWithValues: [] });
		expect(keys(rows)).toEqual(['leading', 'projects_completed', 'v2_tasks_completed']);
	});

	it('shows nothing when the person has no specialty', () => {
		const rows = resolveMetricRows({ defs, papPosition: null, overrides: [], keysWithValues: [] });
		expect(rows).toEqual([]);
	});

	it('still shows granted metrics when there is no specialty at all', () => {
		// The orphaned-metric case: the specialty was deactivated, the person
		// keeps what a manager explicitly gave them.
		const rows = resolveMetricRows({
			defs,
			papPosition: null,
			overrides: [{ metric_key: 'team_retention', mode: 'add' }],
			keysWithValues: [],
		});
		expect(keys(rows)).toEqual(['team_retention']);
	});

	it('grants a metric that belongs to no specialty', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'team_retention', mode: 'add' }],
			keysWithValues: [],
		});
		expect(keys(rows)).toContain('team_retention');
		expect(rows.find((r) => r.def.key === 'team_retention')!.granted).toBe(true);
	});

	it('grants a metric that belongs to a DIFFERENT specialty', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'pitches_sent', mode: 'add' }],
			keysWithValues: [],
		});
		expect(keys(rows)).toContain('pitches_sent');
	});

	it('does not mark a specialty metric as granted just because it was also added', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'leading', mode: 'add' }],
			keysWithValues: [],
		});
		expect(rows.find((r) => r.def.key === 'leading')!.granted).toBe(false);
	});

	it('withholds a removed metric', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'leading', mode: 'remove' }],
			keysWithValues: [],
		});
		expect(keys(rows)).toEqual(['projects_completed', 'v2_tasks_completed']);
	});

	it('will not hide a removed metric that already has a value this month', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'leading', mode: 'remove' }],
			keysWithValues: ['leading'],
		});
		const kept = rows.find((r) => r.def.key === 'leading');
		expect(kept).toBeDefined();
		expect(kept!.keptForValue).toBe(true);
	});

	it('hides the same removed metric in a month with no value', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'leading', mode: 'remove' }],
			keysWithValues: ['projects_completed'],
		});
		expect(keys(rows)).not.toContain('leading');
	});

	it('does not resurrect a metric that was never granted just because a value exists', () => {
		// The pre-0050 accident: a stray imported value must not add a row.
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [],
			keysWithValues: ['pitches_sent'],
		});
		expect(keys(rows)).not.toContain('pitches_sent');
	});

	it('returns catalog order, so a granted metric lands where it belongs', () => {
		const rows = resolveMetricRows({
			defs,
			papPosition: 'Ops',
			overrides: [{ metric_key: 'pitches_sent', mode: 'add' }],
			keysWithValues: [],
		});
		expect(keys(rows)).toEqual(['leading', 'pitches_sent', 'projects_completed', 'v2_tasks_completed']);
	});
});

describe('diffToOverrides', () => {
	it('writes nothing when the wanted set is exactly the specialty set', () => {
		const wanted = ['leading', 'projects_completed', 'v2_tasks_completed'];
		expect(diffToOverrides(defs, 'Ops', wanted)).toEqual([]);
	});

	it('writes only the delta, so the profile keeps following the catalog', () => {
		const wanted = ['leading', 'projects_completed', 'v2_tasks_completed', 'team_retention'];
		expect(diffToOverrides(defs, 'Ops', wanted)).toEqual([
			{ metric_key: 'team_retention', mode: 'add' },
		]);
	});

	it('writes a remove for a specialty metric that was unchecked', () => {
		const wanted = ['projects_completed', 'v2_tasks_completed'];
		expect(diffToOverrides(defs, 'Ops', wanted)).toEqual([
			{ metric_key: 'leading', mode: 'remove' },
		]);
	});

	it('round-trips: applying the diff reproduces the wanted set', () => {
		const wanted = ['projects_completed', 'team_retention', 'pitches_sent'];
		const overrides = diffToOverrides(defs, 'Ops', wanted);
		const rows = resolveMetricRows({ defs, papPosition: 'Ops', overrides, keysWithValues: [] });
		expect(keys(rows).sort()).toEqual([...wanted].sort());
	});

	it('round-trips for an empty wanted set', () => {
		const overrides = diffToOverrides(defs, 'Ops', []);
		const rows = resolveMetricRows({ defs, papPosition: 'Ops', overrides, keysWithValues: [] });
		expect(rows).toEqual([]);
	});
});

describe('specialtyFingerprint', () => {
	const fp = (pos: string | null) => specialtyFingerprint(defs, pos);

	it('is stable regardless of catalog order', () => {
		const shuffled = [...defs].reverse();
		expect(specialtyFingerprint(shuffled, 'Ops')).toBe(fp('Ops'));
	});

	it('changes when a metric joins the specialty', () => {
		const before = fp('Ops');
		const after = specialtyFingerprint(
			defs.map((d) => (d.key === 'team_retention' ? { ...d, pap_positions: ['Ops'] } : d)),
			'Ops',
		);
		expect(after).not.toBe(before);
	});

	it('changes when a metric leaves the specialty', () => {
		const after = specialtyFingerprint(
			defs.map((d) => (d.key === 'leading' ? { ...d, pap_positions: [] } : d)),
			'Ops',
		);
		expect(after).not.toBe(fp('Ops'));
	});

	it('does not change when an unrelated specialty is edited', () => {
		const after = specialtyFingerprint(
			defs.map((d) => (d.key === 'pitches_sent' ? { ...d, pap_positions: ['Media'] } : d)),
			'Ops',
		);
		expect(after).toBe(fp('Ops'));
	});

	it('distinguishes "no specialty" from a real one', () => {
		expect(fp(null)).toBe('');
		expect(fp('Ops')).not.toBe('');
	});
});
