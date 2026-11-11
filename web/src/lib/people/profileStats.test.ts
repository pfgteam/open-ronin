import { describe, it, expect } from 'vitest';
import { buildProfileStats, type ProfileStatsInput } from './profileStats';

const base: ProfileStatsInput = {
	metricsFilled: 2,
	metricsTotal: 3,
	monthLabel: 'August',
	checkinState: 'missing',
	openTasks: 4,
	overdueTasks: 0,
	tenureStart: '2023-05-15',
	asOf: '2026-08-26',
};

const byLabel = (rows: { label: string }[]) => rows.map((r) => r.label);
const pick = (rows: { label: string; value: string; tone?: string }[], label: string) =>
	rows.find((r) => r.label.startsWith(label));

describe('buildProfileStats', () => {
	it('reads the metrics cell as "2 of 3 filled"', () => {
		const stat = pick(buildProfileStats(base), 'Metrics');
		expect(stat?.value).toBe('2 of 3 filled');
		expect(stat?.label).toBe('Metrics · August');
	});

	it('tints the metrics cell success once every metric is filled', () => {
		const stat = pick(buildProfileStats({ ...base, metricsFilled: 3 }), 'Metrics');
		expect(stat?.value).toBe('3 of 3 filled');
		expect(stat?.tone).toBe('success');
	});

	it('omits the metrics cell entirely when the person answers for no metrics', () => {
		const rows = buildProfileStats({ ...base, metricsFilled: 0, metricsTotal: 0 });
		expect(byLabel(rows).some((l) => l.startsWith('Metrics'))).toBe(false);
	});

	it('emits NO check-in cell when a check-in is not expected', () => {
		const rows = buildProfileStats({ ...base, checkinState: 'not-expected' });
		expect(byLabel(rows).some((l) => l.startsWith('Check-in'))).toBe(false);
	});

	it('distinguishes submitted, draft and missing check-ins', () => {
		expect(pick(buildProfileStats({ ...base, checkinState: 'submitted' }), 'Check-in')).toMatchObject({
			value: 'Submitted',
			tone: 'success',
		});
		expect(pick(buildProfileStats({ ...base, checkinState: 'draft' }), 'Check-in')).toMatchObject({
			value: 'Draft saved',
			tone: 'warning',
		});
		expect(pick(buildProfileStats({ ...base, checkinState: 'missing' }), 'Check-in')).toMatchObject({
			value: 'Not submitted',
			tone: 'danger',
		});
	});

	it('marks the tasks cell danger only when something is overdue', () => {
		const clean = pick(buildProfileStats({ ...base, openTasks: 4, overdueTasks: 0 }), 'Open work');
		expect(clean).toMatchObject({ value: '4', tone: 'default' });

		const late = pick(buildProfileStats({ ...base, openTasks: 4, overdueTasks: 2 }), 'Open work');
		expect(late).toMatchObject({ value: '4 · 2 overdue', tone: 'danger' });
	});

	it('renders tenure as years and months against asOf', () => {
		expect(pick(buildProfileStats(base), 'Tenure')?.value).toBe('3y 3m');
		expect(
			pick(buildProfileStats({ ...base, tenureStart: '2026-02-26' }), 'Tenure')?.value,
		).toBe('6m');
		expect(
			pick(buildProfileStats({ ...base, tenureStart: '2025-08-26' }), 'Tenure')?.value,
		).toBe('1y');
		expect(
			pick(buildProfileStats({ ...base, tenureStart: '2026-08-20' }), 'Tenure')?.value,
		).toBe('Less than a month');
	});

	it('renders an em dash for tenure when there is no start date', () => {
		expect(pick(buildProfileStats({ ...base, tenureStart: null }), 'Tenure')?.value).toBe('—');
	});

	it('does not count a start date in the future as tenure', () => {
		expect(
			pick(buildProfileStats({ ...base, tenureStart: '2027-01-01' }), 'Tenure')?.value,
		).toBe('Less than a month');
	});

	it('keeps the four cells in a stable order', () => {
		expect(byLabel(buildProfileStats(base))).toEqual([
			'Metrics · August',
			'Check-in · latest week',
			'Open work',
			'Tenure',
		]);
	});

	it('is pure — two identical calls give identical output', () => {
		expect(buildProfileStats(base)).toEqual(buildProfileStats(base));
	});
});
