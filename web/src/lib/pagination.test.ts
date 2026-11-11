import { describe, expect, it } from 'vitest';
import { parsePage, rangeFor } from './pagination';

describe('parsePage', () => {
	it('reads a positive integer', () => {
		expect(parsePage('3')).toBe(3);
	});
	it('falls back to page 1 for anything else', () => {
		for (const raw of [undefined, null, '', '0', '-2', '1.5', 'abc', '999999999']) expect(parsePage(raw)).toBe(1);
	});
});

describe('rangeFor', () => {
	it('gives inclusive bounds for a 1-based page', () => {
		expect(rangeFor(1, 10)).toEqual({ from: 0, to: 9 });
		expect(rangeFor(3, 10)).toEqual({ from: 20, to: 29 });
	});
	it('treats page 0 or below as page 1', () => {
		expect(rangeFor(0, 10)).toEqual({ from: 0, to: 9 });
	});
});
