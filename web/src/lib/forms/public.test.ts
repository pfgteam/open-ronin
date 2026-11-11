import { describe, expect, it } from 'vitest';
import { answerText, embedSnippet, hostedUrl, submissionsCsv, utmFromUrl } from './shared';
import { renderNotification } from './notify';
import { finalizeSubmission, validateFields, type FormField } from './logic';

const fields: FormField[] = [
	{ key: 'name', label: 'Your name', type: 'text', required: true },
	{ key: 'email', label: 'Email', type: 'email', required: true },
	{ key: 'phone', label: 'Phone', type: 'phone' },
	{ key: 'website', label: 'Website', type: 'url' },
	{ key: 'deck', label: 'Deck', type: 'file' },
	{ key: 'format', label: 'Format', type: 'select', options: ['Podcast', 'TV'], required: true },
];

describe('public forms (0158)', () => {
	it('builds the hosted URL and an embed snippet that loads the resize script', () => {
		expect(hostedUrl('op-guest', 'https://app.example.com')).toBe('https://app.example.com/f/op-guest');
		const snip = embedSnippet('op-guest', 'https://app.example.com/');
		expect(snip).toContain('src="https://app.example.com/f/op-guest/embed"');
		expect(snip).toContain('data-or-form="op-guest"');
		expect(snip).toContain('https://app.example.com/f/embed.js');
	});

	it('keeps only utm_* keys from the source page', () => {
		expect(utmFromUrl('https://example.net/speaking?utm_source=li&utm_campaign=launch&foo=bar')).toEqual({ utm_source: 'li', utm_campaign: 'launch' });
		expect(utmFromUrl('not a url')).toEqual({});
		expect(utmFromUrl(null)).toEqual({});
	});

	it('validates phone, url and file values; passes the new types through the builder check', () => {
		expect(validateFields(fields)).toEqual([]);
		const bad = finalizeSubmission(fields, { name: 'A', email: 'a@b.co', phone: 'call me', website: 'not a url at all with spaces', format: 'Podcast' });
		expect(bad.errors.join(' ')).toMatch(/Phone must be a phone number/);
		expect(bad.errors.join(' ')).toMatch(/Website must be a link/);
		const ok = finalizeSubmission(fields, { name: 'A', email: 'a@b.co', phone: '+1 (615) 555-0100', website: 'example.net', deck: 'form-id/uuid-deck.pdf', format: 'TV' });
		expect(ok.errors).toEqual([]);
		expect(ok.data.phone).toBe('+1 (615) 555-0100');
	});

	it('renders answers for display, CSV and email, with file names from the files list', () => {
		const files = [{ key: 'deck', path: 'f/x-deck.pdf', name: 'deck.pdf', size: 2048, type: 'application/pdf' }];
		expect(answerText(fields[4], 'f/x-deck.pdf', files)).toBe('deck.pdf (2 KB)');
		expect(answerText(fields[5], ['a', 'b'])).toBe('a, b');
		expect(answerText(undefined, true)).toBe('Yes');
		const csv = submissionsCsv(fields, [
			{ id: '1', created_at: '2026-10-19T10:00:00Z', status: 'new', source_url: 'https://x.com/a?utm_source=li', utm: { utm_source: 'li' }, data: { name: 'Jo "JJ" Doe', email: 'jo@x.com', format: 'TV' }, files },
		]);
		const lines = csv.split('\r\n');
		expect(lines[0]).toBe('id,submitted_at,status,source_url,utm_source,utm_medium,utm_campaign,utm_term,utm_content,Your name,Email,Phone,Website,Deck,Format');
		expect(lines[1]).toContain('"Jo ""JJ"" Doe"');
		expect(lines[1]).toContain(',li,');
		const mail = renderNotification({
			to: ['owner@example.com'],
			form: { slug: 'media-request', title: 'Request a media appearance', brand_label: 'Alex Morgan', confidential: true },
			fields,
			data: { name: 'Jo Doe', email: 'jo@x.com', format: 'TV' },
			files: [],
			submission_id: 'abc',
			source_url: 'https://example.net/media',
			utm: { utm_source: 'li' },
			created_at: '2026-10-19T10:00:00Z',
		});
		expect(mail.subject).toBe('[CONFIDENTIAL] [Request a media appearance] New submission from Jo Doe');
		expect(mail.text).toContain('Format: TV');
		expect(mail.text).toContain('/data/forms/media-request/submissions/abc');
		expect(mail.html).toContain('utm_source: li');
		expect(mail.html).not.toContain('<script');
	});
});
