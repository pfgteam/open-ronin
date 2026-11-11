import { describe, expect, it } from 'vitest';
import { backfillSince, countResults, flattenWebhookPayload, webhookExternalId, ghlContactUrl, mapOpportunity, nextRun, opportunityEvent, pageFinished, pageRows, type BackfillRunRow, type GhlOpportunity } from './ghlImport';

const ctx = { locationId: '2T1CDPBbbOUfCwdmJa7S', userEmails: { u1: 'user-d53652@example.com' } };
const base: GhlOpportunity = {
	id: 'opp1',
	name: 'Dana Reyes',
	monetaryValue: 750,
	pipelineId: 'cGxgpGwzo2w5D9MTrdgx',
	pipelineStageId: '5840e23d-2386-459c-bf42-9a09b9c54283',
	status: 'open',
	source: 'Called to Lead',
	assignedTo: 'u1',
	createdAt: '2026-10-08T14:32:40.161Z',
	lastStageChangeAt: '2026-10-08T14:32:40.161Z',
	lastStatusChangeAt: '2026-10-08T14:32:40.161Z',
	contactId: 'c1',
	contact: { id: 'c1', name: 'Dana Reyes', companyName: 'Dana Reyes ~ Marketing and Events Consulting', email: 'connect@example.net', phone: '+19702329092' },
};

describe('mapOpportunity', () => {
	it('maps the row the import function expects', () => {
		expect(mapOpportunity(base, ctx)).toEqual({
			ghl_opportunity_id: 'opp1',
			ghl_contact_id: 'c1',
			ghl_location_id: '2T1CDPBbbOUfCwdmJa7S',
			ghl_pipeline_id: 'cGxgpGwzo2w5D9MTrdgx',
			ghl_stage_id: '5840e23d-2386-459c-bf42-9a09b9c54283',
			ghl_status: 'open',
			created_at: '2026-10-08T14:32:40.161Z',
			last_stage_change_at: '2026-10-08T14:32:40.161Z',
			last_status_change_at: '2026-10-08T14:32:40.161Z',
			value_cents: 75000,
			owner_email: 'user-d53652@example.com',
			ghl_source: 'Called to Lead',
			person: { display_name: 'Dana Reyes', email: 'connect@example.net', phone: '+19702329092', company_name: 'Dana Reyes ~ Marketing and Events Consulting' },
		});
	});
	it('names a phone-only contact after the phone', () => {
		const row = mapOpportunity({ ...base, name: null, contact: { id: 'c2', name: null, email: null, phone: '+15029561815', companyName: null } }, ctx);
		expect(row?.person).toEqual({ display_name: '+15029561815', phone: '+15029561815' });
	});
	it('drops a company name that only repeats the person', () => {
		const row = mapOpportunity({ ...base, contact: { ...base.contact, name: 'Chrystal Potter', companyName: 'chrystal potter ' } }, ctx);
		expect(row?.person.company_name).toBeUndefined();
	});
	it('treats zero value and an unknown owner as empty', () => {
		const row = mapOpportunity({ ...base, monetaryValue: 0, assignedTo: 'nobody' }, ctx);
		expect(row?.value_cents).toBeNull();
		expect(row?.owner_email).toBeNull();
	});
	it('keeps abandoned and rejects unknown statuses or missing stage', () => {
		expect(mapOpportunity({ ...base, status: 'abandoned' }, ctx)?.ghl_status).toBe('abandoned');
		expect(mapOpportunity({ ...base, status: 'weird' }, ctx)).toBeNull();
		expect(mapOpportunity({ ...base, pipelineStageId: '' }, ctx)).toBeNull();
	});
	it('falls back to the opportunity name, then a placeholder', () => {
		expect(mapOpportunity({ ...base, contact: { id: 'c3' } }, ctx)?.person.display_name).toBe('Dana Reyes');
		expect(mapOpportunity({ ...base, name: null, contact: { id: 'c3' } }, ctx)?.person.display_name).toBe('GHL contact');
	});
});

describe('opportunityEvent', () => {
	it('reads native and workflow payloads', () => {
		expect(opportunityEvent({ type: 'OpportunityStageUpdate', id: 'o1' })).toEqual({ type: 'OpportunityStageUpdate', oppId: 'o1' });
		expect(opportunityEvent({ type: 'OpportunityCreate', opportunityId: 'o2', id: 'c9' })).toEqual({ type: 'OpportunityCreate', oppId: 'o2' });
		expect(opportunityEvent({ event: 'opportunity_status_changed', opportunity_id: 'o3' })).toEqual({ type: 'opportunity_status_changed', oppId: 'o3' });
	});
	it('ignores other events and opportunity events without an id', () => {
		expect(opportunityEvent({ type: 'InboundMessage', id: 'm1' })).toBeNull();
		expect(opportunityEvent({ type: 'OpportunityCreate' })).toBeNull();
	});
});

describe('ghlContactUrl', () => {
	it('builds the contact link and trims a trailing slash', () => {
		expect(ghlContactUrl('https://app.gohighlevel.com/', 'L1', 'C1')).toBe('https://app.gohighlevel.com/v2/location/L1/contacts/detail/C1');
	});
	it('returns null when a part is missing', () => {
		expect(ghlContactUrl('https://app.gohighlevel.com', null, 'C1')).toBeNull();
		expect(ghlContactUrl('https://app.gohighlevel.com', 'L1', '')).toBeNull();
	});
});

describe('pageRows', () => {
	const older = { ...base, id: 'old', createdAt: '2025-01-01T00:00:00Z' };
	it('drops rows created before since and flags the end', () => {
		const r = pageRows([base, older], { ...ctx, since: '2025-10-08T00:00:00Z' });
		expect(r.rows.map((x) => x.ghl_opportunity_id)).toEqual(['opp1']);
		expect(r.reachedSince).toBe(true);
	});
	it('keeps everything without since', () => {
		expect(pageRows([base, older], { ...ctx, since: null }).rows).toHaveLength(2);
	});
});

describe('countResults', () => {
	it('folds merged into imported', () => {
		expect(countResults([{ opp: 'a', status: 'imported' }, { opp: 'b', status: 'merged' }, { opp: 'c', status: 'exists' }, { opp: 'd', status: 'skipped' }, { opp: 'e', status: 'error', error: 'x' }])).toEqual({ imported: 2, existed: 1, skipped: 1, failed: 1 });
	});
});

describe('nextRun', () => {
	const run = (id: string, ghl_status: BackfillRunRow['ghl_status'], created_at: string): BackfillRunRow => ({ id, connection_id: 'k', ghl_pipeline_id: 'p', ghl_status, since: null, state: 'queued', cursor_after: null, cursor_after_id: null, fetched: 0, imported: 0, existed: 0, skipped: 0, failed: 0, last_error: null, created_at, finished_at: null });
	it('runs history before open, oldest first', () => {
		expect(nextRun([run('o', 'open', '2026-01-01'), run('w2', 'won', '2026-01-03'), run('w1', 'lost', '2026-01-02')])?.id).toBe('w1');
	});
	it('returns null when nothing is left', () => {
		expect(nextRun([])).toBeNull();
	});
});

describe('backfillSince', () => {
	it('is twelve months back', () => {
		expect(backfillSince(new Date('2026-10-08T00:00:00Z'))).toBe('2025-10-08T00:00:00.000Z');
	});
});

describe('flattenWebhookPayload', () => {
	it('lifts workflow customData to the top level without losing native fields', () => {
		expect(flattenWebhookPayload({ contact_id: 'c1', customData: { type: 'OpportunityCreate', opportunityId: 'o9' } })).toEqual({ contact_id: 'c1', customData: { type: 'OpportunityCreate', opportunityId: 'o9' }, type: 'OpportunityCreate', opportunityId: 'o9' });
		expect(opportunityEvent(flattenWebhookPayload({ customData: { type: 'OpportunityStageUpdate', opportunityId: 'o8' } }))).toEqual({ type: 'OpportunityStageUpdate', oppId: 'o8' });
	});
	it('leaves payloads without customData alone', () => {
		expect(flattenWebhookPayload({ type: 'InboundMessage' })).toEqual({ type: 'InboundMessage' });
	});
});

describe('pageFinished', () => {
	it('stops on a short page, on since, or when the cursor is incomplete', () => {
		expect(pageFinished({ count: 100, reachedSince: false, after: 1, afterId: 'x' })).toBe(false);
		expect(pageFinished({ count: 40, reachedSince: false, after: 1, afterId: 'x' })).toBe(true);
		expect(pageFinished({ count: 100, reachedSince: true, after: 1, afterId: 'x' })).toBe(true);
		expect(pageFinished({ count: 100, reachedSince: false, after: null, afterId: 'x' })).toBe(true);
		expect(pageFinished({ count: 100, reachedSince: false, after: 1, afterId: null })).toBe(true);
	});
});

describe('flattenWebhookPayload calendar', () => {
	it('lifts the appointment status and id from the standard calendar object', () => {
		const p = flattenWebhookPayload({ customData: { type: 'AppointmentUpdate' }, contact_id: 'c1', calendar: { appointmentId: 'ap1', status: 'booked', appoinmentStatus: 'showed' } });
		expect(p.type).toBe('AppointmentUpdate');
		expect(p.appointmentId).toBe('ap1');
		expect(p.appointmentStatus).toBe('showed');
	});
	it('falls back to calendar.status and never overwrites top-level fields', () => {
		expect(flattenWebhookPayload({ calendar: { status: 'confirmed' } }).appointmentStatus).toBe('confirmed');
		expect(flattenWebhookPayload({ appointmentStatus: 'noshow', calendar: { appoinmentStatus: 'showed' } }).appointmentStatus).toBe('noshow');
	});
});

describe('webhookExternalId', () => {
	it('never dedupes two stage moves of the same opportunity', () => {
		const move = { type: 'OpportunityStageUpdate', id: 'opp1', opportunityId: 'opp1' };
		expect(webhookExternalId(move)).toBeNull();
	});
	it('uses ids that name one event', () => {
		expect(webhookExternalId({ webhookId: 'w1', id: 'opp1' })).toBe('w1');
		expect(webhookExternalId({ type: 'InboundMessage', messageId: 'm1' })).toBe('m1');
		expect(webhookExternalId({ type: 'AppointmentUpdate', appointmentId: 'a1', appointmentStatus: 'showed' })).toBe('a1:showed');
		expect(webhookExternalId({ id: 'x', timestamp: '2026-10-14T19:18:45Z' })).toBe('x:2026-10-14T19:18:45Z');
	});
});
