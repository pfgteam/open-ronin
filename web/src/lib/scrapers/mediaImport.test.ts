// Media presets (0102): normalizers against the actors' documented output
// shapes (read from the Apify store on 2026-09-19), input builders against
// their input schemas, and the cross-run dedup that the Module 7 done test
// asks for.

import { describe, expect, it } from 'vitest';
import {
	buildNewsJournalistsInput,
	estimateNewsJournalistsCostUsd,
	isRoleMailbox,
	normalizeDomain,
	normalizeNewsJournalistItem,
	normalizeNewsJournalistPage,
	splitName,
} from './newsJournalistsPreset';
import {
	buildEmailWaterfallInput,
	emailStatusFromConfidence,
	normalizeEmailWaterfallPage,
	parsePeopleLines,
} from './emailWaterfallPreset';
import { buildOutletCrawlInput, normalizeOutletCrawlItem, parseWebsiteLines } from './outletCrawlPreset';
import { MEDIA_PRESETS, isMediaPreset, markMediaDuplicates, normalizeMediaPage } from './advance';

// The README's own sample row.
const SAMPLE = {
	query: 'sustainable packaging',
	headline: 'Startup launches new AI research platform - Example News',
	googleNewsUrl: 'https://news.google.com/rss/articles/abc',
	articleUrl: 'https://example.com/technology/ai-research-platform',
	outletName: 'Example News',
	outletUrl: 'https://example.com/',
	publicationDomain: 'example.com',
	journalistName: 'Alex Rivera',
	authorProfileUrl: 'https://example.com/authors/alex-rivera',
	publishedAt: '2026-08-11T10:00:00.000Z',
	publicEmails: ['newsroom@example.com'],
	primaryEmail: 'newsroom@example.com',
	socialLinks: ['https://www.linkedin.com/company/example-news'],
	contactSourceUrls: ['https://example.com/contact'],
	contactConfidence: 'author_or_contact_page',
	status: 'found',
	error: null,
	collectedAt: '2026-08-11T21:30:00.000Z',
};

describe('news_journalists normalizer', () => {
	it('stages a journalist as media_contact and treats newsroom@ as the outlet mailbox, not theirs', () => {
		const rows = normalizeNewsJournalistItem(SAMPLE, null);
		expect(rows).toHaveLength(1);
		const r = rows[0];
		expect(r.kind).toBe('media_contact');
		expect(r.fullName).toBe('Alex Rivera');
		expect(r.firstName).toBe('Alex');
		expect(r.lastName).toBe('Rivera');
		expect(r.email).toBeNull();
		expect(r.emailStatus).toBe('not_found');
		expect(r.outletName).toBe('Example News');
		expect(r.outletDomain).toBe('example.com');
		expect(r.companyLinkedin).toBe('https://www.linkedin.com/company/example-news');
		expect(r.beats).toEqual(['sustainable packaging']);
		expect(r.evidence[0]).toMatchObject({
			title: SAMPLE.headline,
			url: SAMPLE.articleUrl,
			date: SAMPLE.publishedAt,
			source_url: 'https://example.com/contact',
		});
		// No personal email: dedup on name + domain, so a rerun folds onto it.
		expect(r.dedupKey).toBe('name:alex rivera|example.com');
	});

	it('uses a personal email as the dedup key and marks its status from the actor confidence', () => {
		const rows = normalizeNewsJournalistItem(
			{ ...SAMPLE, publicEmails: ['newsroom@example.com', 'Alex.Rivera@Example.com'], primaryEmail: 'newsroom@example.com', contactConfidence: 'article_page' },
			null,
		);
		expect(rows[0].email).toBe('alex.rivera@example.com');
		expect(rows[0].dedupKey).toBe('alex.rivera@example.com');
		expect(rows[0].emailStatus).toBe('article_page');
	});

	it('stages an outlet row when there is no byline', () => {
		const rows = normalizeNewsJournalistItem({ ...SAMPLE, journalistName: null, status: 'no_public_contact', publicEmails: [], primaryEmail: null }, 'beat');
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('media_outlet');
		expect(rows[0].dedupKey).toBe('example.com');
		expect(rows[0].email).toBeNull();
		expect(rows[0].outletName).toBe('Example News');
	});

	it('keeps the newsroom mailbox on an outlet row', () => {
		const rows = normalizeNewsJournalistItem({ ...SAMPLE, journalistName: '' }, null);
		expect(rows[0].kind).toBe('media_outlet');
		expect(rows[0].email).toBe('newsroom@example.com');
		expect(rows[0].emailStatus).toBe('verified');
	});

	it('skips an unresolved article with nothing to stage', () => {
		expect(
			normalizeNewsJournalistItem({ status: 'article_unavailable', outletName: null, publicationDomain: null, articleUrl: null, journalistName: null }, null),
		).toEqual([]);
	});

	it('folds two articles by the same journalist into one row with both as evidence', () => {
		const second = { ...SAMPLE, headline: 'Second story', articleUrl: 'https://example.com/second', publishedAt: '2026-08-12T10:00:00.000Z', query: 'circular economy' };
		const { records, skipped } = normalizeNewsJournalistPage([SAMPLE, second], { queries: ['sustainable packaging'] });
		expect(skipped).toBe(0);
		expect(records).toHaveLength(1);
		expect(records[0].evidence.map((e) => e.url)).toEqual([SAMPLE.articleUrl, 'https://example.com/second']);
		expect(records[0].beats).toEqual(['sustainable packaging', 'circular economy']);
	});

	it('derives maxArticlesPerQuery from max_results and clamps to the actor ceiling', () => {
		expect(buildNewsJournalistsInput({ queries: ['a', 'b'] }, 50)).toMatchObject({ queries: ['a', 'b'], maxArticlesPerQuery: 25, freshnessDays: 7, includeNoContact: true, enrichPublisherPages: true, maxExtraPagesPerArticle: 1 });
		expect(buildNewsJournalistsInput({ queries: ['a'] }, 500).maxArticlesPerQuery).toBe(25);
		expect(buildNewsJournalistsInput({ queries: ['a'], maxArticlesPerQuery: 3, freshnessDays: 900, country: 'gb', language: 'EN' }, 500)).toMatchObject({ maxArticlesPerQuery: 3, freshnessDays: 365, country: 'GB', language: 'en' });
		// The actor allows at most 20 queries.
		expect((buildNewsJournalistsInput({ queries: Array.from({ length: 30 }, (_, i) => `q${i}`) }, 100).queries as string[]).length).toBe(20);
	});

	it('estimates the bill as start fee plus the smaller of rows asked and rows possible', () => {
		// 2 beats x 10 default = 20 rows, under the 100 ceiling.
		expect(estimateNewsJournalistsCostUsd({ queries: ['a', 'b'] }, 100)).toBeCloseTo(0.12 + 20 * 0.0023, 3);
		// ceiling wins
		expect(estimateNewsJournalistsCostUsd({ queries: ['a', 'b'], maxArticlesPerQuery: 25 }, 30)).toBeCloseTo(0.12 + 30 * 0.0023, 3);
	});

	it('helpers', () => {
		expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
		expect(normalizeDomain('example.com')).toBe('example.com');
		expect(normalizeDomain('not a domain')).toBeNull();
		expect(isRoleMailbox('newsroom@x.com')).toBe(true);
		expect(isRoleMailbox('tips@x.com')).toBe(true);
		expect(isRoleMailbox('alex.rivera@x.com')).toBe(false);
		expect(splitName('Mary Anne Smith')).toEqual({ first: 'Mary', last: 'Anne Smith' });
		expect(splitName('Cher')).toEqual({ first: 'Cher', last: null });
	});
});

describe('email_waterfall preset', () => {
	it('parses pasted "Name, domain" lines and drops the unparseable', () => {
		expect(parsePeopleLines('Alex Rivera, example.com\nJane Doe\thttps://www.startup.io/\nnope\nOne Name@ x')).toEqual([
			{ firstName: 'Alex', lastName: 'Rivera', domain: 'example.com' },
			{ firstName: 'Jane', lastName: 'Doe', domain: 'startup.io' },
		]);
	});

	it('sends the documented people wrapper and strips our own fields', () => {
		const input = buildEmailWaterfallInput(
			{ people: [{ firstName: 'A', lastName: 'B', domain: 'x.com', sourceRecordId: 'rec', company: 'X' }, { firstName: 'C', lastName: 'D', domain: 'y.com' }] },
			1,
		);
		expect(input).toEqual({ people: [{ firstName: 'A', lastName: 'B', domain: 'x.com', company: 'X' }], checkWebsite: true, checkGitHub: false, checkGravatar: true });
	});

	it('maps confidence to email_status and stages misses as not_found', () => {
		expect(emailStatusFromConfidence('high', 'a@b.c')).toBe('verified');
		expect(emailStatusFromConfidence('medium', 'a@b.c')).toBe('likely');
		expect(emailStatusFromConfidence('low', 'a@b.c')).toBe('pattern_guess');
		expect(emailStatusFromConfidence('high', null)).toBe('not_found');
		const { records } = normalizeEmailWaterfallPage(
			[
				{ firstName: 'John', lastName: 'Smith', domain: 'acme.com', company: 'Acme', email: 'John.Smith@acme.com', confidence: 'high', sources: ['website'] },
				{ firstName: 'Jane', lastName: 'Doe', domain: 'startup.io', email: null, confidence: null },
			],
			{ people: [], beats: ['fintech'] },
		);
		expect(records[0]).toMatchObject({ kind: 'media_contact', email: 'john.smith@acme.com', dedupKey: 'john.smith@acme.com', emailStatus: 'verified', outletName: 'Acme', beats: ['fintech'] });
		expect(records[1]).toMatchObject({ email: null, emailStatus: 'not_found', dedupKey: 'name:jane doe|startup.io' });
	});
});

describe('outlet_crawl preset', () => {
	const ROW = {
		inputUrl: 'https://stripe.com',
		rootDomain: 'stripe.com',
		title: 'Stripe | Financial Infrastructure to Grow Your Revenue',
		emails: ['support@cloudflare.com', 'press@stripe.com', 'support@stripe.com'],
		phones: [],
		linkedinUrl: 'https://www.linkedin.com/company/stripe',
		pagesScraped: ['https://stripe.com', 'https://stripe.com/contact'],
	};

	it('stages one outlet per website with the on-domain role mailbox and a clean name', () => {
		const r = normalizeOutletCrawlItem(ROW, { websites: [], beats: ['fintech'] });
		expect(r).toMatchObject({ kind: 'media_outlet', dedupKey: 'stripe.com', outletName: 'Stripe', outletDomain: 'stripe.com', email: 'press@stripe.com', emailStatus: 'verified', companyLinkedin: ROW.linkedinUrl, beats: ['fintech'] });
		expect((r!.raw as { onDomainEmails: string[] }).onDomainEmails).toEqual(['press@stripe.com', 'support@stripe.com']);
	});

	it('builds startUrls from domains and caps at max_results', () => {
		const input = buildOutletCrawlInput({ websites: parseWebsiteLines('stripe.com, https://www.ramp.com/x\nairtable.com'), maxPagesPerDomain: 99 }, 2);
		expect(input.startUrls).toEqual([{ url: 'https://stripe.com' }, { url: 'https://ramp.com' }]);
		expect(input).toMatchObject({ maxWebsites: 2, maxPagesPerDomain: 30, includePhones: false, decodeObfuscatedEmails: true });
	});
});

describe('media import (advance.ts)', () => {
	it('knows the three media presets and rejects the others', () => {
		expect([...MEDIA_PRESETS]).toEqual(['news_journalists', 'email_waterfall', 'outlet_crawl']);
		expect(isMediaPreset('news_journalists')).toBe(true);
		expect(isMediaPreset('b2b_database')).toBe(false);
		expect(() => normalizeMediaPage('b2b_database', [], null)).toThrow(/Not a media preset/);
	});

	it('marks a rerun of the same beat duplicate against earlier staging rows and contacts', async () => {
		const { records } = normalizeMediaPage('news_journalists', [SAMPLE, { ...SAMPLE, journalistName: 'New Person', publicEmails: ['new.person@example.com'], primaryEmail: 'new.person@example.com' }, { ...SAMPLE, journalistName: 'Known Contact', publicEmails: ['known@example.com'], primaryEmail: 'known@example.com' }], null);
		expect(records).toHaveLength(3);

		// A fake service-role client: the earlier run staged Alex Rivera; contacts holds known@.
		const calls: string[] = [];
		const db = {
			from(table: string) {
				const chain = {
					_table: table,
					select() { return chain; },
					in(col: string, vals: string[]) { calls.push(`${table}.in(${col}:${vals.length})`); return chain; },
					neq() { return chain; },
					then(resolve: (v: { data: unknown[]; error: null }) => void) {
						resolve(
							table === 'scraped_records'
								? { data: [{ dedup_key: 'name:alex rivera|example.com' }], error: null }
								: { data: [{ email: 'Known@example.com' }], error: null },
						);
					},
				};
				return chain;
			},
		};
		const dupes = await markMediaDuplicates(db as never, 'job-2', records);
		expect([...dupes].sort()).toEqual(['known@example.com', 'name:alex rivera|example.com']);
		expect(calls).toEqual(['scraped_records.in(kind:2)', 'scraped_records.in(dedup_key:3)', 'contacts.in(email:2)']);
	});
});
