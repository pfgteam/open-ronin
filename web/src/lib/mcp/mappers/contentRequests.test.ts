import { describe, expect, it } from 'vitest';
import { mapContentRequest, type ContentRequestRow } from './contentRequests';

const raw: ContentRequestRow & { requester_id: string; assignee_id: string; closed_by: string; proposed_action_id: string } = {
	id: 'r1',
	client_id: 'c1',
	asset_type: 'video',
	title: 'Launch reel',
	brief: 'Cut 30s',
	due_on: '2026-09-25',
	priority: 'high',
	status: 'requested',
	decision_note: null,
	studio_job_id: null,
	identity_slug: 'client_success',
	sla_accept_by: '2026-09-20T15:00:00Z',
	accepted_at: null,
	delivered_at: null,
	created_at: '2026-09-19T15:00:00Z',
	requester: { first_name: 'Alex', last_name: 'A', email: 'owner@example.com' },
	assignee: null,
	client: { display_name: 'Acme' },
	job: null,
	// columns the mapper must drop
	requester_id: 'u1',
	assignee_id: 'u2',
	closed_by: 'u3',
	proposed_action_id: 'pa1',
};

describe('mapContentRequest', () => {
	it('exposes exactly the allowlist with names, never profile ids or spine ids', () => {
		const out = mapContentRequest(raw, new Date('2026-09-19T16:00:00Z'));
		expect(Object.keys(out).sort()).toEqual(
			[
				'accept_by', 'accepted_at', 'asset_type', 'assignee_name', 'brief', 'client_id', 'client_name', 'created_at',
				'decision_note', 'delivered_at', 'due_on', 'id', 'priority', 'proposed_by_identity', 'requester_name', 'sla',
				'status', 'studio_job_status', 'title', 'url',
			].sort(),
		);
		const json = JSON.stringify(out);
		for (const secret of ['u1', 'u2', 'u3', 'pa1', 'owner@example.com']) expect(json).not.toContain(secret);
		expect(out.requester_name).toBe('Alex A');
		expect(out.client_name).toBe('Acme');
		expect(out.sla).toEqual({ state: 'ok', clock: 'accept', label: 'accept in 23h' });
	});
});
