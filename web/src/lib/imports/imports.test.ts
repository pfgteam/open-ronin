import { describe, it, expect } from 'vitest';
import { coerce, parseDate, parseNumber, parseBoolean, parseList, normalizeEmail, normalizeUrl } from './coerce';
import { parseCsv, toCsv } from './parse';
import { autoMatch, shapeRow, naturalKeyFor, snapshotEqual, driftedKeys, missingRequired } from './match';
import { TARGETS, naturalKeyGroups } from './targets';
import { stepForStatus, TARGET_KEYS } from './types';

describe('parseCsv', () => {
	it('handles quotes, doubled quotes, embedded newlines and a BOM', () => {
		const text = '\ufeffname,email,notes\r\n"Doe, Jane",JANE@x.com,"says ""hi""\nand bye"\r\nBob,bob@x.com,\r\n';
		const f = parseCsv(text);
		expect(f.headers).toEqual(['name', 'email', 'notes']);
		expect(f.rows).toEqual([
			['Doe, Jane', 'JANE@x.com', 'says "hi"\nand bye'],
			['Bob', 'bob@x.com', ''],
		]);
	});

	it('sniffs semicolon and tab delimiters', () => {
		expect(parseCsv('a;b\n1;2\n').rows).toEqual([['1', '2']]);
		expect(parseCsv('a\tb\n1\t2\n').rows).toEqual([['1', '2']]);
	});

	it('drops empty rows and pads short rows', () => {
		const f = parseCsv('a,b,c\n1\n\n2,3,4\n');
		expect(f.rows).toEqual([['1', '', ''], ['2', '3', '4']]);
	});

	it('round trips through toCsv', () => {
		const csv = toCsv(['a', 'b'], [['x, y', 'q"r'], [1, null]]);
		const f = parseCsv(csv);
		expect(f.rows).toEqual([['x, y', 'q"r'], ['1', '']]);
	});
});

describe('coerce', () => {
	it('parses the date shapes people actually export', () => {
		expect(parseDate('2026-09-12')).toBe('2026-09-12');
		expect(parseDate('2026-09-12T10:00:00Z')).toBe('2026-09-12');
		expect(parseDate('9/12/2026')).toBe('2026-09-12');
		expect(parseDate('12.09.2026')).toBe('2026-09-12');
		expect(parseDate('12 Sep 2026')).toBe('2026-09-12');
		expect(parseDate('September 12, 2026')).toBe('2026-09-12');
		expect(parseDate('Sep 2026')).toBe('2026-09-01');
		expect(parseDate('2026-09')).toBe('2026-09-01');
		expect(parseDate('46277')).toBe('2026-09-12');
	});

	it('refuses two digit years and impossible dates', () => {
		expect(parseDate('9/12/26')).toBeNull();
		expect(parseDate('2026-02-30')).toBeNull();
		expect(parseDate('13/13/2026')).toBeNull();
	});

	it('parses currency and negatives', () => {
		expect(parseNumber('$1,234.50')).toBe(1234.5);
		expect(parseNumber('(200)')).toBe(-200);
		expect(parseNumber('-3')).toBe(-3);
		expect(parseNumber('abc')).toBeNull();
		expect(coerce('$12.34', 'currency_cents')).toEqual({ ok: true, value: 1234 });
	});

	it('rejects fractional values for integer columns instead of rounding', () => {
		expect(coerce('1,234', 'integer')).toEqual({ ok: true, value: 1234 });
		expect(coerce('303.456', 'integer')).toEqual({ ok: false, error: '"303.456" is not a whole number' });
		expect(coerce('abc', 'integer')).toEqual({ ok: false, error: '"abc" is not a number' });
		expect(coerce('3,100,000,000', 'integer')).toEqual({ ok: false, error: '"3,100,000,000" is too large for this column (max 2147483647)' });
		expect(coerce('3100000000', 'bigint')).toEqual({ ok: true, value: 3_100_000_000 });
	});

	it('parses booleans and lists', () => {
		expect(parseBoolean('Yes')).toBe(true);
		expect(parseBoolean('0')).toBe(false);
		expect(parseBoolean('maybe')).toBeNull();
		expect(parseList('a, b; c | a')).toEqual(['a', 'b', 'c']);
	});

	it('normalizes emails and urls', () => {
		expect(normalizeEmail(' Jane@X.com ')).toBe('jane@x.com');
		expect(normalizeEmail('nope')).toBeNull();
		expect(normalizeUrl('example.com/a')).toBe('https://example.com/a');
		expect(normalizeUrl('not a url')).toBeNull();
	});

	it('matches enums loosely and constrained lists strictly', () => {
		expect(coerce('Qualified', 'enum', { values: ['lead', 'qualified'] })).toEqual({ ok: true, value: 'qualified' });
		expect(coerce('won!', 'enum', { values: ['won'] }).ok).toBe(false);
		expect(coerce('journalist, Podcaster', 'list', { values: ['journalist', 'podcaster'] })).toEqual({ ok: true, value: ['journalist', 'podcaster'] });
		expect(coerce('journalist, chef', 'list', { values: ['journalist'] }).ok).toBe(false);
	});

	it('treats an empty cell as null for every type', () => {
		expect(coerce('', 'date')).toEqual({ ok: true, value: null });
		expect(coerce('  ', 'number')).toEqual({ ok: true, value: null });
	});
});

describe('autoMatch', () => {
	const cols = TARGETS.contacts.columns;

	it('maps a typical contacts export with no manual fixes', () => {
		const headers = ['Full Name', 'First', 'Last', 'Email Address', 'Phone Number', 'Job Title', 'Company', 'LinkedIn', 'Contact Type'];
		const m = autoMatch(headers, cols);
		expect(m).toEqual({
			display_name: 'Full Name',
			first_name: 'First',
			last_name: 'Last',
			email: 'Email Address',
			phone: 'Phone Number',
			title: 'Job Title',
			organization: 'Company',
			linkedin_url: 'LinkedIn',
			roles: 'Contact Type',
		});
	});

	it('uses each header at most once and prefers exact matches', () => {
		const m = autoMatch(['email', 'email 2', 'name'], cols);
		expect(m.email).toBe('email');
		expect(m.display_name).toBe('name');
		expect(Object.values(m).filter((h) => h === 'email').length).toBe(1);
	});

	it('does not match on tiny headers by containment', () => {
		const m = autoMatch(['id', 'x'], TARGETS.prospects.columns);
		expect(m).toEqual({});
	});
});

describe('shapeRow', () => {
	const cols = TARGETS.contacts.columns;
	const headers = ['Name', 'Email', 'Roles'];
	const mapping = { display_name: 'Name', email: 'Email', roles: 'Roles' };

	it('coerces and reports errors per column', () => {
		const good = shapeRow(['Jane', 'JANE@x.com', 'journalist'], headers, mapping, cols);
		expect(good.errors).toEqual([]);
		expect(good.values).toEqual({ display_name: 'Jane', email: 'jane@x.com', roles: ['journalist'] });

		const bad = shapeRow(['', 'nope', 'chef'], headers, mapping, cols);
		expect(bad.errors).toEqual(['Display name is required', 'Email: "nope" is not an email address', expect.stringContaining('Roles: "chef"')]);
	});

	it('flags required columns missing from the mapping', () => {
		expect(missingRequired({ email: 'Email' }, cols).map((c) => c.key)).toEqual(['display_name']);
		const r = shapeRow(['x'], ['Email'], { email: 'Email' }, cols);
		expect(r.errors[0]).toContain('not mapped');
	});
});

describe('natural keys and snapshots', () => {
	it('falls through to the second key group', () => {
		const groups = naturalKeyGroups('contacts');
		expect(naturalKeyFor({ email: 'a@b.c' }, groups)).toEqual({ group: ['email'], key: 'email=a@b.c' });
		expect(naturalKeyFor({ display_name: 'Jane', organization: 'ACME' }, groups)?.key).toBe('display_name=jane|organization=acme');
		expect(naturalKeyFor({ display_name: 'Jane' }, groups)).toBeNull();
	});

	it('compares snapshots by value, arrays as sets, numbers to numeric strings', () => {
		expect(snapshotEqual({ a: 1, roles: ['x', 'y'] }, { a: '1', roles: ['y', 'x'] })).toBe(true);
		expect(snapshotEqual({ a: null }, {})).toBe(true);
		expect(driftedKeys({ a: 1, b: 'x' }, { a: 1, b: 'y' })).toEqual(['b']);
		expect(driftedKeys({ a: 1 }, null)).toEqual(['a']);
	});
});

describe('target registry', () => {
	it('every Supabase target has a natural key group made of its own columns', () => {
		for (const key of TARGET_KEYS) {
			if (key === 'airtable') continue;
			const t = TARGETS[key];
			const groups = naturalKeyGroups(key);
			expect(groups.length, key).toBeGreaterThan(0);
			const keys = new Set(t.columns.map((c) => c.key));
			for (const g of groups) for (const c of g) expect(keys.has(c), `${key}: ${c}`).toBe(true);
		}
	});

	it('keeps the CHECK constraint in 0068 (widened by 0116, 0121) and the TypeScript allowlist in step', () => {
		expect([...TARGET_KEYS].sort()).toEqual(['airtable', 'client_aliases', 'contacts', 'media_opportunities', 'media_outlets', 'metrics', 'prospects', 'rev_prospects']);
	});

	it('maps status to the furthest wizard step', () => {
		expect(stepForStatus('draft')).toBe('upload');
		expect(stepForStatus('uploaded')).toBe('target');
		expect(stepForStatus('mapped')).toBe('dry-run');
		expect(stepForStatus('committed')).toBe('commit');
	});
});
