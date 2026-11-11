import { describe, expect, it } from 'vitest';
import { buildOpenRequests, staffRequestHref } from './openRequestsShared';

const ME = '11111111-1111-4111-8111-111111111111';

describe('buildOpenRequests (Work › Overview "My open requests")', () => {
	it('keeps only open rows from both engines, newest first, with labels and links', () => {
		const out = buildOpenRequests(
			[
				{ id: 'a', kind: 'time_off', title: 'Vacation', status: 'pending', created_at: '2026-11-01T00:00:00Z' },
				{ id: 'b', kind: 'innovation', title: 'Idea', status: 'in_review', created_at: '2026-11-03T00:00:00Z' },
				{ id: 'c', kind: 'sop', title: 'Closed', status: 'approved', created_at: '2026-11-04T00:00:00Z' },
			],
			[
				{ id: 'd', title: 'Reel for Acme', status: 'accepted', created_at: '2026-11-02T00:00:00Z' },
				{ id: 'e', title: 'Done', status: 'delivered', created_at: '2026-11-05T00:00:00Z' },
			],
			ME,
		);
		expect(out.map((r) => r.id)).toEqual(['staff:b', 'content:d', 'staff:a']);
		expect(out[0]).toMatchObject({ type: 'Innovation Desk', status: 'In Review', href: '/the-work/innovation-desk' });
		expect(out[1]).toMatchObject({ type: 'Content', status: 'Accepted', href: '/the-work/content-requests' });
		expect(out[2]).toMatchObject({ type: 'Time Off', status: 'Submitted', href: `/team/${ME}?tab=timeoff` });
	});

	it('caps the list', () => {
		const staff = Array.from({ length: 12 }, (_, i) => ({ id: String(i), kind: 'sop', title: `t${i}`, status: 'pending', created_at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
		expect(buildOpenRequests(staff, [], ME, 5)).toHaveLength(5);
	});

	it('keeps approved two-step requests (not done until completed), drops approved one-step ones', () => {
		const out = buildOpenRequests(
			[
				{ id: 'i', kind: 'innovation', title: 'Approved idea', status: 'approved', created_at: '2026-11-03T00:00:00Z' },
				{ id: 's', kind: 'software_change', title: 'Shipped', status: 'completed', created_at: '2026-11-02T00:00:00Z' },
				{ id: 't', kind: 'time_off', title: 'Approved PTO', status: 'approved', created_at: '2026-11-01T00:00:00Z' },
			],
			[],
			ME,
		);
		expect(out.map((r) => r.id)).toEqual(['staff:i']);
		expect(out[0]).toMatchObject({ status: 'Approved' });
	});

	it('routes position requests to Hiring', () => {
		expect(staffRequestHref('position_request', ME)).toBe('/hiring/requests');
	});
});
