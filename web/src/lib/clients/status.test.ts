import { describe, expect, it } from 'vitest';
import { formatHealth, hasHealth, healthBand, healthColor, statusColor } from './status';

// `Client Health` on Contract Agreement is an Airtable PERCENT field, so the
// adapter hands over a NUMBER. The old code called .toLowerCase() on it and
// took the whole /clients render down (`a.toLowerCase is not a function`,
// production 2026-09-01). These pin both shapes: the numeric one Airtable
// actually sends, and the legacy word list older bases still carry.

describe('healthColor with numbers', () => {
	it('reads a percent field in fraction form', () => {
		expect(healthColor(0.85)).toBe('success');
		expect(healthColor(0.5)).toBe('warning');
		expect(healthColor(0.1)).toBe('danger');
	});

	it('reads hand-typed points form the same way', () => {
		expect(healthColor(85)).toBe('success');
		expect(healthColor(50)).toBe('warning');
		expect(healthColor(10)).toBe('danger');
	});

	it('treats 0 as a real value, not a missing one', () => {
		expect(healthColor(0)).toBe('danger');
	});

	it('falls back to default on NaN', () => {
		expect(healthColor(Number.NaN)).toBe('default');
	});

	it('does not crash on a number (the 2026-09-01 regression)', () => {
		expect(() => healthColor(0.72)).not.toThrow();
	});
});

describe('healthColor with words', () => {
	it('handles the live High / Medium / Low / Red Flag vocabulary', () => {
		expect(healthColor('High')).toBe('success');
		expect(healthColor('Medium')).toBe('warning');
		expect(healthColor('Low')).toBe('danger');
		expect(healthColor('Red Flag')).toBe('danger');
	});

	it('still handles the legacy green / yellow / red fallbacks', () => {
		expect(healthColor('Green')).toBe('success');
		expect(healthColor('Healthy')).toBe('success');
		expect(healthColor('Strong')).toBe('success');
		expect(healthColor('At risk')).toBe('warning');
		expect(healthColor('Caution')).toBe('warning');
		expect(healthColor('Critical')).toBe('danger');
		expect(healthColor('Yellow')).toBe('warning');
		expect(healthColor('Red')).toBe('danger');
	});

	it('is case-insensitive', () => {
		expect(healthColor('hIgH')).toBe('success');
	});

	// Regression: the word branches are substring tests, and "yellow" contains
	// "low". While Low was tested before Yellow, a legacy yellow health
	// painted danger-red. The colour words are now checked first.
	it('colors the legacy "Yellow" value as a warning, not a danger', () => {
		expect(healthColor('Yellow')).toBe('warning');
	});

	// Same ordering trap the other way round: a churn signal must not be
	// softened to a warning by the generic `risk` branch.
	it('treats "Churn risk" as danger, not a warning', () => {
		expect(healthColor('Churn risk')).toBe('danger');
	});

	it('falls back to default on an unknown word', () => {
		expect(healthColor('Bananas')).toBe('default');
	});
});

describe('healthColor with nothing', () => {
	it('returns default for undefined, null and empty string', () => {
		expect(healthColor(undefined)).toBe('default');
		expect(healthColor(null)).toBe('default');
		expect(healthColor('')).toBe('default');
	});
});

describe('formatHealth', () => {
	it('renders a fraction as a whole percentage', () => {
		expect(formatHealth(0.85)).toBe('85%');
	});

	it('renders points form as the same percentage', () => {
		expect(formatHealth(85)).toBe('85%');
	});

	it('renders 0 rather than treating it as absent', () => {
		expect(formatHealth(0)).toBe('0%');
	});

	it('passes a word through unchanged', () => {
		expect(formatHealth('Red Flag')).toBe('Red Flag');
	});

	it('em-dashes nullish and NaN values', () => {
		expect(formatHealth(undefined)).toBe('—');
		expect(formatHealth(null)).toBe('—');
		expect(formatHealth('')).toBe('—');
		expect(formatHealth(Number.NaN)).toBe('—');
	});
});

describe('hasHealth', () => {
	it('counts 0 as a value', () => {
		expect(hasHealth(0)).toBe(true);
	});

	it('rejects empty string, null, undefined and NaN', () => {
		expect(hasHealth('')).toBe(false);
		expect(hasHealth(null)).toBe(false);
		expect(hasHealth(undefined)).toBe(false);
		expect(hasHealth(Number.NaN)).toBe(false);
	});

	it('accepts a number and a word', () => {
		expect(hasHealth(0.85)).toBe(true);
		expect(hasHealth('High')).toBe(true);
	});
});

describe('healthBand', () => {
	it('names the band a number falls in', () => {
		expect(healthBand(0.85)).toBe('Healthy');
		expect(healthBand(0.5)).toBe('Watch');
		expect(healthBand(0.1)).toBe('At risk');
		expect(healthBand(0)).toBe('At risk');
	});

	it('names the band a word falls in', () => {
		expect(healthBand('High')).toBe('Healthy');
		expect(healthBand('Medium')).toBe('Watch');
		expect(healthBand('Red Flag')).toBe('At risk');
	});

	it('returns null when there is no band', () => {
		expect(healthBand(undefined)).toBeNull();
		expect(healthBand('')).toBeNull();
		expect(healthBand(Number.NaN)).toBeNull();
	});
});

describe('statusColor', () => {
	it('colors all seven canonical Client Status values', () => {
		expect(statusColor('Active')).toBe('success');
		expect(statusColor('30-day')).toBe('success');
		expect(statusColor('60-day')).toBe('success');
		expect(statusColor('Hold')).toBe('warning');
		expect(statusColor('Post Contract Fulfillment')).toBe('warning');
		expect(statusColor('Closed')).toBe('danger');
		expect(statusColor('Internal')).toBe('primary');
	});

	it('is case-insensitive', () => {
		expect(statusColor('active')).toBe('success');
		expect(statusColor('CLOSED')).toBe('danger');
	});

	it('returns default for nothing and for an unknown status', () => {
		expect(statusColor(undefined)).toBe('default');
		expect(statusColor('')).toBe('default');
		expect(statusColor('Sabbatical')).toBe('default');
	});
});
