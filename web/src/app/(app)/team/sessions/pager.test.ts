import { describe, expect, it } from 'vitest';
import type { SessionsPager } from './SessionsTable';

// The pager crosses a server → client boundary (SessionsTable is
// 'use client'), and React refuses to serialize a function across it:
// "Functions cannot be passed directly to Client Components". tsc accepts a
// function-typed prop happily, so only a runtime render catches it — hence
// this structural guard instead.
describe('SessionsPager', () => {
	it('carries only serializable values', () => {
		const pager: SessionsPager = {
			page: 1,
			pageCount: 2,
			total: 98,
			from: 1,
			prevHref: null,
			nextHref: '/team/sessions?month=2026-09&p=2',
		};
		for (const [key, value] of Object.entries(pager)) {
			expect(typeof value, `pager.${key} must not be a function`).not.toBe('function');
		}
		// Round-trips through the RSC payload unchanged.
		expect(JSON.parse(JSON.stringify(pager))).toEqual(pager);
	});
});
