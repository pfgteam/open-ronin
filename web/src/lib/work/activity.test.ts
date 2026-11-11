import { describe, it, expect } from 'vitest';
import { composeActivity } from './activity';

const baseInput = {
	createdAt: '2026-01-01T00:00:00.000Z',
	createdByName: 'Ada Lovelace',
	parentName: null as string | null,
	statusLog: [] as {
		from_status: string | null;
		to_status: string;
		created_at: string;
		actorName: string | null;
	}[],
	updates: [] as { health: string; created_at: string; authorName: string | null }[],
	comments: [] as { created_at: string; authorName: string | null }[],
	attachments: [] as {
		file_name: string | null;
		is_deliverable: boolean;
		created_at: string;
		uploaderName: string | null;
	}[],
};

describe('composeActivity', () => {
	it('yields exactly the creation entry when everything else is empty', () => {
		const entries = composeActivity(baseInput);
		expect(entries).toHaveLength(1);
		expect(entries[0].at).toBe(baseInput.createdAt);
	});

	it('puts the creation entry last, however many other entries exist', () => {
		const entries = composeActivity({
			...baseInput,
			statusLog: [
				{
					from_status: 'In progress',
					to_status: 'Review',
					created_at: '2026-01-05T00:00:00.000Z',
					actorName: 'Grace Hopper',
				},
			],
			comments: [{ created_at: '2026-01-02T00:00:00.000Z', authorName: 'Grace Hopper' }],
		});
		expect(entries).toHaveLength(3);
		expect(entries[entries.length - 1].at).toBe(baseInput.createdAt);
	});

	it('renders a status change as "Status: from → to" with tone primary', () => {
		const entries = composeActivity({
			...baseInput,
			statusLog: [
				{
					from_status: 'In progress',
					to_status: 'Review',
					created_at: '2026-01-05T00:00:00.000Z',
					actorName: 'Grace Hopper',
				},
			],
		});
		const statusEntry = entries.find((e) => e.text.startsWith('Status:'));
		expect(statusEntry).toEqual({
			tone: 'primary',
			text: 'Status: In progress → Review',
			at: '2026-01-05T00:00:00.000Z',
		});
	});

	it('renders a deliverable attachment with tone success and mentions the uploader', () => {
		const entries = composeActivity({
			...baseInput,
			attachments: [
				{
					file_name: 'brand-guide.pdf',
					is_deliverable: true,
					created_at: '2026-01-06T00:00:00.000Z',
					uploaderName: 'Margaret Hamilton',
				},
			],
		});
		const attachmentEntry = entries.find((e) => e.at === '2026-01-06T00:00:00.000Z');
		expect(attachmentEntry?.tone).toBe('success');
		expect(attachmentEntry?.text).toContain('Margaret Hamilton');
	});

	it('renders a non-deliverable attachment without the success tone', () => {
		const entries = composeActivity({
			...baseInput,
			attachments: [
				{
					file_name: 'notes.txt',
					is_deliverable: false,
					created_at: '2026-01-06T00:00:00.000Z',
					uploaderName: 'Margaret Hamilton',
				},
			],
		});
		const attachmentEntry = entries.find((e) => e.at === '2026-01-06T00:00:00.000Z');
		expect(attachmentEntry?.tone).toBe('default');
	});

	it('derives an update tone of success for on_track, per that entry\'s own health', () => {
		const entries = composeActivity({
			...baseInput,
			updates: [
				{ health: 'on_track', created_at: '2026-01-03T00:00:00.000Z', authorName: 'Katherine Johnson' },
				{ health: 'at_risk', created_at: '2026-01-04T00:00:00.000Z', authorName: 'Katherine Johnson' },
			],
		});
		const onTrack = entries.find((e) => e.at === '2026-01-03T00:00:00.000Z');
		const atRisk = entries.find((e) => e.at === '2026-01-04T00:00:00.000Z');
		expect(onTrack?.tone).toBe('success');
		expect(atRisk?.tone).toBe('primary');
	});

	it('sorts entries newest-first', () => {
		const entries = composeActivity({
			...baseInput,
			statusLog: [
				{
					from_status: 'In progress',
					to_status: 'Review',
					created_at: '2026-01-05T00:00:00.000Z',
					actorName: 'Grace Hopper',
				},
			],
			comments: [{ created_at: '2026-01-02T00:00:00.000Z', authorName: 'Grace Hopper' }],
			updates: [{ health: 'on_track', created_at: '2026-01-08T00:00:00.000Z', authorName: 'Katherine Johnson' }],
		});
		const ats = entries.map((e) => e.at);
		expect(ats).toEqual([
			'2026-01-08T00:00:00.000Z',
			'2026-01-05T00:00:00.000Z',
			'2026-01-02T00:00:00.000Z',
			baseInput.createdAt,
		]);
	});

	it('breaks a timestamp tie deterministically by kind, comment before status', () => {
		const tiedAt = '2026-01-05T00:00:00.000Z';
		const entries = composeActivity({
			...baseInput,
			statusLog: [
				{ from_status: 'In progress', to_status: 'Review', created_at: tiedAt, actorName: 'Grace Hopper' },
			],
			comments: [{ created_at: tiedAt, authorName: 'Grace Hopper' }],
		});
		expect(entries[0].text.startsWith('Comment')).toBe(true);
		expect(entries[1].text.startsWith('Status:')).toBe(true);
	});

	it('mentions the comment author when present', () => {
		const entries = composeActivity({
			...baseInput,
			comments: [{ created_at: '2026-01-02T00:00:00.000Z', authorName: 'Grace Hopper' }],
		});
		const commentEntry = entries.find((e) => e.at === '2026-01-02T00:00:00.000Z');
		expect(commentEntry?.text).toContain('Grace Hopper');
	});

	it('mentions the parent in the creation entry when parentName is given', () => {
		const entries = composeActivity({ ...baseInput, parentName: 'Q3 Rebrand' });
		expect(entries[0].text).toBe('Created by Ada Lovelace in Q3 Rebrand');
	});

	it('omits the parent clause from the creation entry when parentName is null', () => {
		const entries = composeActivity({ ...baseInput, parentName: null });
		expect(entries[0].text).toBe('Created by Ada Lovelace');
	});

	it('renders a status change with no prior status as "New → to"', () => {
		const entries = composeActivity({
			...baseInput,
			statusLog: [
				{
					from_status: null,
					to_status: 'In progress',
					created_at: '2026-01-05T00:00:00.000Z',
					actorName: 'Grace Hopper',
				},
			],
		});
		const statusEntry = entries.find((e) => e.text.startsWith('Status:'));
		expect(statusEntry?.text).toBe('Status: New → In progress');
	});

	it('prettifies each known health slug into its label', () => {
		const entries = composeActivity({
			...baseInput,
			updates: [
				{ health: 'on_track', created_at: '2026-01-03T00:00:00.000Z', authorName: 'K' },
				{ health: 'at_risk', created_at: '2026-01-04T00:00:00.000Z', authorName: 'K' },
				{ health: 'off_track', created_at: '2026-01-05T00:00:00.000Z', authorName: 'K' },
				{ health: 'some_other_slug', created_at: '2026-01-06T00:00:00.000Z', authorName: 'K' },
			],
		});
		const textFor = (at: string) => entries.find((e) => e.at === at)?.text;
		expect(textFor('2026-01-03T00:00:00.000Z')).toBe('Update: On track');
		expect(textFor('2026-01-04T00:00:00.000Z')).toBe('Update: At risk');
		expect(textFor('2026-01-05T00:00:00.000Z')).toBe('Update: Off track');
		expect(textFor('2026-01-06T00:00:00.000Z')).toBe('Update: some other slug');
	});
});
