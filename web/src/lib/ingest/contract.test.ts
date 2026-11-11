import { describe, expect, it } from 'vitest';
import { sessionRow } from './contract';

const valid = {
	zoom_meeting_id: '84512345678',
	call_type: 'client_recurring',
	occurred_at: '2026-08-28T15:00:00Z',
	duration_minutes: 45,
	client: { airtable_contract_id: 'recABC123' },
	attendee_emails: ['user-3f0ec5@example.com', 'client@acme.com'],
	recording_url: 'https://zoom.us/rec/abc',
	transcript: { content: 'Hello…', language: 'en', word_count: 6200 },
	analysis: {
		analyzer: 'n8n/gpt-4o',
		prompt_version: 'v3',
		overall_score: 7.5,
		summary_md: 'Good call.',
		dimensions: [{ dimension: 'Next steps', score: 8, note: 'Clear owners.' }],
		attention_points: [{ severity: 'warning', point: 'Client asked about renewal.' }],
		suggested_tasks: [{ title: 'Send recap', suggested_owner_email: 'user-3f0ec5@example.com' }],
	},
};

describe('sessionRow', () => {
	it('accepts a full valid row', () => {
		expect(sessionRow.safeParse(valid).success).toBe(true);
	});
	it('rejects a missing transcript content', () => {
		const r = { ...valid, transcript: { language: 'en' } };
		expect(sessionRow.safeParse(r).success).toBe(false);
	});
	it('rejects an out-of-range overall_score', () => {
		const r = { ...valid, analysis: { ...valid.analysis, overall_score: 10.5 } };
		expect(sessionRow.safeParse(r).success).toBe(false);
	});
	it('rejects an unknown severity', () => {
		const r = { ...valid, analysis: { ...valid.analysis, attention_points: [{ severity: 'sev1', point: 'x' }] } };
		expect(sessionRow.safeParse(r).success).toBe(false);
	});
	it('defaults call_type to untyped and allows an absent client (internal call)', () => {
		const { client: _c, ...rest } = valid;
		const r = { ...rest, call_type: undefined };
		const parsed = sessionRow.safeParse(r);
		expect(parsed.success).toBe(true);
		if (parsed.success) expect(parsed.data.call_type).toBe('untyped');
	});
	it('rejects an empty dimensions array', () => {
		const r = { ...valid, analysis: { ...valid.analysis, dimensions: [] } };
		expect(sessionRow.safeParse(r).success).toBe(false);
	});
});

// --------------------------------------------------- participants (0087)

const participant = {
	email: 'user-3f0ec5@example.com',
	listening: 8,
	affirming: 7.5,
	responding: 6,
	asking: 9,
	overall: 7.5,
	notes_md: 'Asked strong discovery questions.',
};

describe('sessionRow.analysis.participants', () => {
	it('defaults to [] so a pre-0087 payload stays valid', () => {
		// `valid` deliberately carries no participants key.
		const parsed = sessionRow.safeParse(valid);
		expect(parsed.success).toBe(true);
		if (parsed.success) expect(parsed.data.analysis.participants).toEqual([]);
	});

	it('accepts a scored participant who is an attendee', () => {
		const r = { ...valid, analysis: { ...valid.analysis, participants: [participant] } };
		expect(sessionRow.safeParse(r).success).toBe(true);
	});

	it('accepts a participant without notes_md', () => {
		const { notes_md: _n, ...noNotes } = participant;
		const r = { ...valid, analysis: { ...valid.analysis, participants: [noNotes] } };
		expect(sessionRow.safeParse(r).success).toBe(true);
	});

	it('rejects a participant who is not in attendee_emails', () => {
		const r = {
			...valid,
			analysis: {
				...valid.analysis,
				participants: [{ ...participant, email: 'user-ed5acf@example.com' }],
			},
		};
		const parsed = sessionRow.safeParse(r);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0].message).toContain('not in attendee_emails');
			expect(parsed.error.issues[0].path).toEqual(['analysis', 'participants', 0, 'email']);
		}
	});

	it('matches the attendee check case-insensitively', () => {
		const r = {
			...valid,
			analysis: {
				...valid.analysis,
				participants: [{ ...participant, email: 'user-3f0ec5@example.com' }],
			},
		};
		expect(sessionRow.safeParse(r).success).toBe(true);
	});

	it('rejects an out-of-range LARA dimension', () => {
		const r = {
			...valid,
			analysis: { ...valid.analysis, participants: [{ ...participant, asking: 11 }] },
		};
		expect(sessionRow.safeParse(r).success).toBe(false);
	});

	it('requires every LARA dimension', () => {
		const { asking: _a, ...missing } = participant;
		const r = { ...valid, analysis: { ...valid.analysis, participants: [missing] } };
		expect(sessionRow.safeParse(r).success).toBe(false);
	});

	it('allows an external attendee to be scored only if the pipeline sends them (route drops them later)', () => {
		// The contract only checks attendance. Whether a profile exists is the
		// route's call, and it drops silently — see the sessions ingest route.
		const r = {
			...valid,
			analysis: { ...valid.analysis, participants: [{ ...participant, email: 'client@acme.com' }] },
		};
		expect(sessionRow.safeParse(r).success).toBe(true);
	});
});
