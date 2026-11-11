import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageSlice, parsePage, parsePageSize } from './paging';

describe('parsePageSize', () => {
	it('accepts only the offered sizes and falls back to the default otherwise', () => {
		for (const s of PAGE_SIZES) expect(parsePageSize(String(s))).toBe(s);
		expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
		expect(parsePageSize('7')).toBe(DEFAULT_PAGE_SIZE);
		expect(parsePageSize('abc')).toBe(DEFAULT_PAGE_SIZE);
		expect(parsePageSize('-20')).toBe(DEFAULT_PAGE_SIZE);
	});
});

describe('parsePage', () => {
	it('reads a positive integer and falls back to 1 for anything else', () => {
		expect(parsePage('3')).toBe(3);
		expect(parsePage(undefined)).toBe(1);
		expect(parsePage('0')).toBe(1);
		expect(parsePage('-2')).toBe(1);
		expect(parsePage('2.5')).toBe(1);
		expect(parsePage('two')).toBe(1);
	});
});

describe('pageSlice', () => {
	it('slices the requested page', () => {
		expect(pageSlice(78, 2, 20)).toEqual({ page: 2, pageCount: 4, start: 20, end: 40 });
	});
	it('clamps a page past the end to the last page — a stale bookmark must not render an empty list', () => {
		expect(pageSlice(78, 9, 20)).toEqual({ page: 4, pageCount: 4, start: 60, end: 78 });
	});
	it('an empty list is one empty page', () => {
		expect(pageSlice(0, 3, 20)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 });
	});
	it('a total that fits in one page is one page whatever was requested', () => {
		expect(pageSlice(12, 2, 20)).toEqual({ page: 1, pageCount: 1, start: 0, end: 12 });
	});
	it('an exact multiple does not create an empty trailing page', () => {
		expect(pageSlice(40, 3, 20)).toEqual({ page: 2, pageCount: 2, start: 20, end: 40 });
	});
});
