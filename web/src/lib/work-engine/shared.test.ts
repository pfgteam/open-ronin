import { describe, expect, it } from 'vitest';
import { availableActions, formatAge, isWorkDomain, isWorkStatus } from './shared';

describe('work-engine vocabulary', () => {
	it('guards domain and status', () => {
		expect(isWorkDomain('scrape')).toBe(true);
		expect(isWorkDomain('pitch')).toBe(false);
		expect(isWorkStatus('waiting_approval')).toBe(true);
		expect(isWorkStatus('pending')).toBe(false);
	});

	it('formats age coarsely', () => {
		const now = new Date('2026-09-19T10:00:00Z');
		expect(formatAge('2026-09-19T09:58:00Z', now)).toBe('2m');
		expect(formatAge('2026-09-19T07:00:00Z', now)).toBe('3h');
		expect(formatAge('2026-09-10T07:00:00Z', now)).toBe('9d');
	});
});

describe('availableActions', () => {
	it('native rows get the full set by status', () => {
		expect(availableActions({ status: 'waiting_approval', source_table: null })).toEqual(['approve', 'reject', 'cancel']);
		expect(availableActions({ status: 'failed', source_table: null })).toEqual(['retry']);
		expect(availableActions({ status: 'done', source_table: null })).toEqual([]);
	});
	it('mirrored rows only expose what their domain safely supports', () => {
		expect(availableActions({ status: 'waiting_approval', source_table: 'staff_requests' })).toEqual(['approve', 'reject', 'open']);
		// scraper review is per record, so the job-level row only links through
		expect(availableActions({ status: 'waiting_approval', source_table: 'scrape_jobs' })).toEqual(['open']);
		expect(availableActions({ status: 'running', source_table: 'scrape_jobs' })).toEqual(['cancel', 'open']);
		expect(availableActions({ status: 'queued', source_table: 'import_batches' })).toEqual(['open']);
		expect(availableActions({ status: 'failed', source_table: 'automation_runs' })).toEqual(['retry', 'open']);
	});
});
