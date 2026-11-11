import { describe, expect, it } from 'vitest';
import { attentionCounts, mapCallDetail, mapCallRow } from './calls';

describe('attentionCounts', () => {
	it('tallies severities, defaulting absent ones to 0', () => {
		expect(
			attentionCounts([
				{ severity: 'warning', point: 'a' },
				{ severity: 'critical', point: 'b' },
				{ severity: 'warning', point: 'c' },
			]),
		).toEqual({ info: 0, warning: 2, critical: 1 });
	});

	it('all zero for an empty list', () => {
		expect(attentionCounts([])).toEqual({ info: 0, warning: 0, critical: 0 });
	});
});

describe('mapCallRow', () => {
	const call = {
		id: 'call-1',
		client_id: 'client-1',
		call_type: 'client_followup',
		occurred_at: '2026-08-01T12:00:00Z',
		duration_minutes: 30,
		attendee_user_ids: ['u1', 'u2'],
		attendee_external: ['ext@client.com'],
	};

	it('exposes exactly the allowlist', () => {
		const row = mapCallRow({
			call,
			analysis: { call_id: 'call-1', overall_score: 8.5, attention_points: [{ severity: 'critical', point: 'x' }], created_at: '2026-08-01T13:00:00Z' },
			pendingSuggestions: 2,
			attendeeNames: ['Jane', 'Ravi'],
			clientName: 'Acme',
		});
		expect(Object.keys(row).sort()).toEqual([
			'attendees', 'attention_counts', 'call_type', 'client_name', 'duration_minutes',
			'external_attendee_count', 'id', 'occurred_at', 'overall_score', 'pending_suggestions',
			'score_band', 'url',
		]);
		expect(row.id).toBe('call-1');
		expect(row.url).toBe('/team/sessions/call-1');
		expect(row.overall_score).toBe(8.5);
		expect(row.score_band).toBe('good');
		expect(row.attention_counts).toEqual({ info: 0, warning: 0, critical: 1 });
		expect(row.pending_suggestions).toBe(2);
		expect(row.attendees).toEqual(['Jane', 'Ravi']);
		expect(row.external_attendee_count).toBe(1);
		expect(row.client_name).toBe('Acme');
	});

	it('a call with no analysis maps overall_score/score_band to null', () => {
		const row = mapCallRow({
			call,
			analysis: null,
			pendingSuggestions: 0,
			attendeeNames: [],
			clientName: null,
		});
		expect(row.overall_score).toBeNull();
		expect(row.score_band).toBeNull();
		expect(row.attention_counts).toEqual({ info: 0, warning: 0, critical: 0 });
	});
});

describe('mapCallDetail', () => {
	const call = {
		id: 'call-1',
		client_id: 'client-1',
		call_type: 'client_followup',
		occurred_at: '2026-08-01T12:00:00Z',
		duration_minutes: 30,
		recording_url: 'https://example.com/rec.mp4',
		// A real `calls` column (migration 0041:61) — a pointer to the transcript
		// is as off-limits as the text itself, so this MUST NOT leak into the
		// mapped output.
		transcript_url: 'https://example.com/transcript.txt',
		attendee_user_ids: ['u1'],
		attendee_external: ['ext@client.com'],
	};

	const detail = mapCallDetail({
		call,
		analysesMeta: [
			{ analyzer: 'gpt', prompt_version: 'v1', overall_score: 9, created_at: '2026-08-01T13:00:00Z' },
			{ analyzer: 'gpt', prompt_version: 'v1', overall_score: 7, created_at: '2026-08-01T10:00:00Z' },
		],
		latestAnalysisFull: { summary_md: 'summary', dimensions: [{ dimension: 'rapport', score: 9, note: 'good' }], attention_points: [{ severity: 'warning', point: 'x' }] },
		suggestedTasks: [{ title: 'Follow up', detail_md: 'do it', status: 'pending', created_task_id: null }],
		attendeeProfiles: [{ first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' }],
		clientName: 'Acme',
	});

	it('includes the allowlisted detail keys', () => {
		const keys = Object.keys(detail);
		for (const k of ['summary_md', 'dimensions', 'attention_points', 'suggested_tasks', 'attendees', 'external_attendees', 'recording_url', 'analysis']) {
			expect(keys).toContain(k);
		}
	});

	it('never includes transcript, content, or transcript_url', () => {
		const json = JSON.stringify(detail);
		expect(Object.keys(detail)).not.toContain('transcript');
		expect(Object.keys(detail)).not.toContain('content');
		expect(Object.keys(detail)).not.toContain('transcript_url');
		expect(json).not.toContain('transcript_url');
		expect(json).not.toContain('example.com/transcript.txt');
	});

	it('reports earlier_analyses as count-1 and surfaces the newest as `analysis`', () => {
		expect(detail.analysis?.overall_score).toBe(9);
		expect(detail.earlier_analyses).toBe(1);
	});

	it('a call with no analyses maps analysis to null and earlier_analyses to 0', () => {
		const noAnalysis = mapCallDetail({
			call,
			analysesMeta: [],
			latestAnalysisFull: null,
			suggestedTasks: [],
			attendeeProfiles: [],
			clientName: null,
		});
		expect(noAnalysis.analysis).toBeNull();
		expect(noAnalysis.earlier_analyses).toBe(0);
		expect(noAnalysis.summary_md).toBeNull();
		expect(noAnalysis.dimensions).toEqual([]);
		expect(noAnalysis.attention_points).toEqual([]);
	});
});
