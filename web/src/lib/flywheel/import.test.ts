import { describe, expect, it } from 'vitest';
import { channelFromText, channelFromUrl, citationStatusFrom, classifyPlacement, gridToRows, importRef, isTotalsRow, mapHeaders, pageStatusFrom, parseClusterNumber, parseDate, parsePageNumber, planImport, spreadsheetIdFrom, summarizePlan, type PlanContext } from './import';

// Header fixtures. The first four are the SOP shapes the importer was built
// against before any sheet could be read; the REAL fixtures are the header
// rows of the live trackers (read 2026-10-02 from the exports in Drive):
// Northwind Published Asset Inventory (native sheet 1Ldh…, three tabs, the
// same layout as the XX Published Asset Inventory template), MINT AEO Citation
// Tracker UPDATED_v2 and FCU AEO Citation Tracker (both .xlsx, Page
// Inventory tab). The importer REPORTS any header it does not know rather
// than guessing, and the preview shows them before anything is written.
const FIXTURES = {
	overpressure_inventory: ['Date Published', 'Asset Type', 'Title', 'URL', 'Keyword', 'Cluster', 'Page', 'Posted By', 'Status', 'Notes'],
	sop_citation_ledger: ['Page URL', 'Citation URL', 'Channel', 'Date', 'Keyword', 'Fact Used', 'Models Surfacing', 'Status'],
	sop_page_tracker: ['Page #', 'Target Keyword', 'Title', 'Live URL', 'Status', 'Go Live Date', 'Notes'],
	mint_tracker: ['Cluster #', 'Page', 'Asset', 'Platform', 'Link', 'Published', 'Account', 'Comments'],
};
const REAL = {
	overpressure_offsite: ['#', 'Platform', 'Question / Title', 'URL', 'Author', 'Posted', 'Publicly Readable?', 'Northwind Citation Visible?', 'Links To', 'Notes'],
	overpressure_articles: ['#', 'Publication', 'Article Title', 'URL', 'Cluster', 'Seed Keyword', 'Published', 'Words', 'Schema', 'Indexable', 'MINT Link Target'],
	overpressure_video: ['#', 'Asset Type', 'Title / Search Question', 'Public URL', 'Author / Source', 'Publicly Readable?', 'MINT Citation Visible?', 'Links To', 'Notes', 'Hyperlinked From'],
	mint_page_inventory: ['#', 'Cluster', 'Domain', 'URL', 'Published', 'Days live', 'Entity anchor?', 'Answer targets', 'Notes'],
	accu_page_inventory: ['#', 'Cluster', 'Domain', 'URL', 'Published', 'Index status', 'Entity anchor?', 'Answer targets', 'Primary prompt / notes'],
};

const CHANNELS = ['medium', 'linkedin', 'quora_space', 'quora_answer', 'reddit', 'shorts', 'faq_schema', 'podcast'].map((key) => ({ key, label: key }));

function ctx(over: Partial<PlanContext> = {}): PlanContext {
	return {
		programId: 'prog',
		primaryUrl: 'https://overpressurepodcast.com/',
		channels: CHANNELS,
		clusters: [{ id: 'c1', number: 1, anchor_keyword: 'military transition podcast', status: 'in_production' }],
		pages: [
			{ id: 'p1', cluster_id: 'c1', number: 1, keyword: 'military transition podcast', live_url: 'https://overpressurepodcast.com/military-transition-podcast', import_ref: null },
			{ id: 'p2', cluster_id: 'c1', number: 2, keyword: 'life after the military', live_url: null, import_ref: null },
		],
		...over,
	};
}

describe('mapHeaders', () => {
	it('maps the Northwind Published Asset Inventory shape with no unknowns', () => {
		const m = mapHeaders(FIXTURES.overpressure_inventory);
		expect(m.unknown).toEqual([]);
		expect(m.missing).toEqual([]);
		expect(m.mapping).toEqual({ asset_type: 1, title: 2, url: 3, keyword: 4, cluster: 5, page: 6, status: 8, posted_on: 0, poster: 7, notes: 9 });
	});
	it('maps the SOP Citation Ledger: citation URL is the asset, page URL is the page; Fact / Models are reported as unknown', () => {
		const m = mapHeaders(FIXTURES.sop_citation_ledger);
		expect(m.mapping.url).toBe(1);
		expect(m.mapping.page).toBe(0);
		expect(m.mapping.asset_type).toBe(2);
		expect(m.mapping.posted_on).toBe(3);
		expect(m.mapping.keyword).toBe(4);
		expect(m.mapping.status).toBe(7);
		expect(m.unknown).toEqual(['Fact Used', 'Models Surfacing']);
		expect(m.missing).toEqual([]);
	});
	it('maps the SOP Page Tracker', () => {
		const m = mapHeaders(FIXTURES.sop_page_tracker);
		expect(m.mapping).toEqual({ page: 0, keyword: 1, title: 2, url: 3, status: 4, posted_on: 5, notes: 6 });
		expect(m.unknown).toEqual([]);
	});
	it('maps the MINT tracker: Platform wins the channel slot, Asset stays unknown rather than guessed', () => {
		const m = mapHeaders(FIXTURES.mint_tracker);
		expect(m.mapping.cluster).toBe(0);
		expect(m.mapping.page).toBe(1);
		expect(m.mapping.asset_type).toBe(2); // 'asset' is an exact alias; 'Platform' then has nothing left to claim
		expect(m.mapping.url).toBe(4);
		expect(m.mapping.posted_on).toBe(5); // a bare "Published" column holds the date
		expect(m.mapping.status).toBeUndefined();
		expect(m.mapping.poster).toBe(6);
		expect(m.mapping.notes).toBe(7);
		expect(m.unknown).toEqual(['Platform']);
	});
	it('keeps "Published?" (question form) as a status column', () => {
		expect(mapHeaders(['URL', 'Published?']).mapping).toEqual({ url: 0, status: 1 });
	});
	it('maps the real Northwind inventory tabs and reports the rest', () => {
		const off = mapHeaders(REAL.overpressure_offsite);
		expect(off.mapping).toEqual({ asset_type: 1, title: 2, url: 3, posted_on: 5, poster: 4, notes: 9 });
		expect(off.unknown).toEqual(['#', 'Publicly Readable?', 'Northwind Citation Visible?', 'Links To']);
		const art = mapHeaders(REAL.overpressure_articles);
		expect(art.mapping).toEqual({ title: 2, url: 3, keyword: 5, cluster: 4, posted_on: 6 });
		expect(art.unknown).toEqual(['#', 'Publication', 'Words', 'Schema', 'Indexable', 'MINT Link Target']);
		const vid = mapHeaders(REAL.overpressure_video);
		expect(vid.mapping).toEqual({ asset_type: 1, title: 2, url: 3, poster: 4, notes: 8 });
		expect(vid.missing).toEqual([]);
	});
	it('maps the real MINT and FCU Page Inventory tabs', () => {
		const mint = mapHeaders(REAL.mint_page_inventory);
		expect(mint.mapping).toEqual({ url: 3, cluster: 1, posted_on: 4, notes: 8 });
		expect(mint.unknown).toEqual(['#', 'Domain', 'Days live', 'Entity anchor?', 'Answer targets']);
		const accu = mapHeaders(REAL.accu_page_inventory);
		expect(accu.mapping).toEqual({ url: 3, cluster: 1, status: 5, posted_on: 4, notes: 8 });
		expect(accu.unknown).toEqual(['#', 'Domain', 'Entity anchor?', 'Answer targets']);
	});
	it('reports a header row with neither a URL nor an asset type as missing', () => {
		const m = mapHeaders(['Title', 'Notes', 'Owner']);
		expect(m.missing).toEqual(['url']);
		expect(m.unknown).toEqual([]);
	});
	it('never maps the same column twice and keeps unknown headers verbatim', () => {
		const m = mapHeaders(['Link', 'Link', 'Fancy Column']);
		expect(m.mapping.url).toBe(0);
		expect(m.unknown).toEqual(['Link', 'Fancy Column']);
	});
});

describe('channel detection', () => {
	it('reads the channel from the URL host', () => {
		expect(channelFromUrl('https://medium.com/@op/some-post')).toBe('medium');
		expect(channelFromUrl('https://www.linkedin.com/pulse/x')).toBe('linkedin');
		expect(channelFromUrl('https://www.quora.com/What-is-x/answer/Alex')).toBe('quora_answer');
		expect(channelFromUrl('https://northwind.quora.com/post-title')).toBe('quora_space');
		expect(channelFromUrl('https://www.reddit.com/r/Veterans/comments/abc')).toBe('reddit');
		expect(channelFromUrl('https://youtube.com/shorts/abc123')).toBe('shorts');
		expect(channelFromUrl('https://www.youtube.com/watch?v=abc')).toBeNull();
		expect(channelFromUrl('https://open.spotify.com/episode/x')).toBe('podcast');
		expect(channelFromUrl('not a url')).toBeNull();
	});
	it('reads Open Ronin publisher-network hosts as FAQ-schema syndication, other third-party hosts stay unknown', () => {
		expect(channelFromUrl('https://trendingconsumerism.com/consumer-guides/curling-iron-ceramic-buyers-guide/')).toBe('faq_schema');
		expect(channelFromUrl('https://www.newyorkpostdaily.com/dealership-or-credit-union-financing/')).toBe('faq_schema');
		expect(channelFromUrl('https://thoughtleadersethos.com/x/')).toBe('faq_schema');
		expect(channelFromUrl('https://pt.quora.com/profile/Riley-Vidal/Question-x')).toBe('quora_answer'); // pt. is a language site, not a Space
		expect(channelFromUrl('https://someblog.example/x')).toBeNull();
	});
	it('reads the channel from the asset type text, Quora space before answer', () => {
		expect(channelFromText('Medium article')).toBe('medium');
		expect(channelFromText('LinkedIn Article')).toBe('linkedin');
		expect(channelFromText('Quora Space post')).toBe('quora_space');
		expect(channelFromText('Quora answer')).toBe('quora_answer');
		expect(channelFromText('YouTube Short')).toBe('shorts');
		expect(channelFromText('Reel')).toBe('shorts');
		expect(channelFromText('FAQ schema syndication')).toBe('faq_schema');
		expect(channelFromText('Podcast episode')).toBe('podcast');
		expect(channelFromText('Newsletter')).toBeNull();
	});
	it('classifies on-site pages by the program host or by page / blog wording, else null', () => {
		expect(classifyPlacement(null, 'https://overpressurepodcast.com/life-after', 'overpressurepodcast.com')).toBe('on_site');
		expect(classifyPlacement('Blog post', null, 'overpressurepodcast.com')).toBe('on_site');
		expect(classifyPlacement('Medium', 'https://overpressurepodcast.com/x', 'overpressurepodcast.com')).toBe('medium');
		expect(classifyPlacement('Newsletter', 'https://substack.com/x', 'overpressurepodcast.com')).toBeNull();
		expect(classifyPlacement(null, null, 'overpressurepodcast.com')).toBeNull();
	});
});

describe('cells', () => {
	it('parses cluster and page numbers from the common spellings', () => {
		expect(parseClusterNumber('Cluster 1')).toBe(1);
		expect(parseClusterNumber('C2')).toBe(2);
		expect(parseClusterNumber('3')).toBe(3);
		expect(parseClusterNumber('military transition')).toBeNull();
		expect(parseClusterNumber('Cluster 7 — Can I use a curling iron on wet hair?')).toBe(7);
		expect(parseClusterNumber('cluster #4')).toBe(4);
		expect(parseClusterNumber('2-Inch / Long Barrel')).toBeNull(); // a topic label, not cluster 2
		expect(parseClusterNumber('Medium Cross-Cut (P1 + P3 close)')).toBeNull();
		expect(parsePageNumber('Page 4')).toBe(4);
		expect(parsePageNumber('P7')).toBe(7);
		expect(parsePageNumber('#10')).toBe(10);
		expect(parsePageNumber('21')).toBeNull();
		expect(parsePageNumber('life after the military')).toBeNull();
	});
	it('parses dates in ISO, US, long form and Sheets serial', () => {
		expect(parseDate('2026-09-12')).toBe('2026-09-12');
		expect(parseDate('9/12/2026')).toBe('2026-09-12');
		expect(parseDate('9/12/26')).toBe('2026-09-12');
		expect(parseDate('Sep 12, 2026')).toBe('2026-09-12');
		expect(parseDate('12 Sept 2026')).toBe('2026-09-12');
		expect(parseDate(46277)).toBe('2026-09-12');
		expect(parseDate('TBD')).toBeNull();
		expect(parseDate('')).toBeNull();
		expect(parseDate('2/30/2026')).toBeNull();
	});
	it('derives statuses: a URL means posted / live unless the sheet says otherwise', () => {
		expect(citationStatusFrom('Posted', true)).toBe('posted');
		expect(citationStatusFrom('Verified', true)).toBe('live');
		expect(citationStatusFrom(null, true)).toBe('posted');
		expect(citationStatusFrom('Draft', false)).toBe('drafting');
		expect(citationStatusFrom('Removed', true)).toBe('removed');
		expect(citationStatusFrom('', false)).toBe('planned');
		expect(pageStatusFrom('Live', false)).toBe('live');
		expect(pageStatusFrom(null, true)).toBe('live');
		expect(pageStatusFrom('In review', true)).toBe('in_review');
		expect(pageStatusFrom('Sent to dev', false)).toBe('handed_off');
		expect(pageStatusFrom('Approved', false)).toBe('approved');
		expect(pageStatusFrom(undefined, false)).toBe('planned');
	});
	it('builds import_ref and reads a spreadsheet id from a URL', () => {
		expect(importRef('1Ldh', 'Inventory', 7)).toBe('1Ldh!Inventory!7');
		expect(spreadsheetIdFrom('https://docs.google.com/spreadsheets/d/1LdhrvbzRlT9rn_ah7p_5B-dguu0j1TU85WOA3r3uR70/edit#gid=0')).toBe('1LdhrvbzRlT9rn_ah7p_5B-dguu0j1TU85WOA3r3uR70');
		expect(spreadsheetIdFrom('1LdhrvbzRlT9rn_ah7p_5B-dguu0j1TU85WOA3r3uR70')).toBe('1LdhrvbzRlT9rn_ah7p_5B-dguu0j1TU85WOA3r3uR70');
		expect(spreadsheetIdFrom('nope')).toBeNull();
	});
});

describe('planImport', () => {
	const headers = FIXTURES.overpressure_inventory;
	const rows: (string | number | null)[][] = [
		// row 2: Medium article, links to page 1 by number
		['9/12/2026', 'Medium article', 'Why transition is hard', 'https://medium.com/@northwind/why-transition', 'military transition podcast', 'Cluster 1', 'Page 1', '@northwind', 'Posted', null],
		// row 3: Quora answer, page by keyword
		['Sep 14, 2026', 'Quora answer', null, 'https://www.quora.com/x/answer/Alex', 'life after the military', null, 'life after the military', 'Alex', 'Verified', 'rotated fact 3'],
		// row 4: on-site page, new (number 3, next free), live by URL
		['2026-09-20', 'Blog post', 'Veteran resilience', 'https://overpressurepodcast.com/veteran-resilience', 'veteran resilience podcast', '1', null, null, 'Live', null],
		// row 5: short that cites the page planned on row 4 (by keyword)
		['9/21/2026', 'YouTube Short', 'Resilience clip', 'https://youtube.com/shorts/abc', 'veteran resilience podcast', null, null, null, null, null],
		// row 6: unknown channel -> review
		['9/22/2026', 'Newsletter', 'Issue 4', 'https://substack.com/op/issue-4', null, null, null, null, 'Sent', null],
		// row 7: blank
		[null, '', null, null, null, null, null, null, null, null],
		// row 8: cluster that does not exist -> review
		['9/23/2026', 'Blog post', 'Orphan', null, 'orphan keyword', 'Cluster 4', null, null, null, null],
		// row 9: URL already on the ledger from the app -> review
		['9/24/2026', 'Reddit', 'dup', 'https://www.reddit.com/r/Veterans/comments/dup', null, null, null, null, null, null],
		// row 10: nothing to classify on
		[null, null, 'Just a title', null, null, null, null, null, null, null],
	];
	const plan = planImport({
		spreadsheetId: 'SHEET',
		tab: 'Inventory',
		headers,
		rows,
		ctx: ctx({ citationsByUrl: new Map([['https://www.reddit.com/r/veterans/comments/dup', { id: 'x', import_ref: null }]]) }),
	});

	it('places pages and citations and sends the rest to review (nothing dropped)', () => {
		expect(plan.header.unknown).toEqual([]);
		expect(plan.pages).toHaveLength(1);
		expect(plan.citations).toHaveLength(3);
		expect(plan.review.map((r) => r.row_number)).toEqual([6, 8, 9, 10]);
		expect(plan.blank).toBe(1);
		expect(plan.pages.length + plan.citations.length + plan.review.length + plan.blank).toBe(rows.length);
		expect(summarizePlan(plan)).toBe('1 page · 3 citations · 4 to review · 1 blank');
	});
	it('keys every row on the sheet row (header = row 1)', () => {
		expect(plan.citations[0].import_ref).toBe('SHEET!Inventory!2');
		expect(plan.pages[0].import_ref).toBe('SHEET!Inventory!4');
		expect(plan.review[0].import_ref).toBe('SHEET!Inventory!6');
	});
	it('links citations to existing pages by number or keyword, and to pages planned in the same run by import_ref', () => {
		const [medium, quora, short] = plan.citations;
		expect(medium).toMatchObject({ channel_key: 'medium', page_id: 'p1', cluster_id: 'c1', status: 'posted', posted_on: '2026-09-12', poster_handle: '@northwind', url: 'https://medium.com/@northwind/why-transition' });
		expect(quora).toMatchObject({ channel_key: 'quora_answer', page_id: 'p2', status: 'live', posted_on: '2026-09-14', notes_md: 'rotated fact 3' });
		expect(short).toMatchObject({ channel_key: 'shorts', page_id: null, page_import_ref: 'SHEET!Inventory!4', cluster_id: 'c1', status: 'posted' });
	});
	it('gives a new on-site page the next free number in its cluster and marks it live from the URL + date', () => {
		expect(plan.pages[0]).toMatchObject({ cluster_id: 'c1', number: 3, keyword: 'veteran resilience podcast', title: 'Veteran resilience', status: 'live', live_url: 'https://overpressurepodcast.com/veteran-resilience', live_at: '2026-09-20T12:00:00Z', existing_id: null });
	});
	it('explains every review row', () => {
		expect(plan.review[0].reason).toMatch(/no channel or on-site page recognised/);
		expect(plan.review[1].reason).toMatch(/cluster 4 does not exist/);
		expect(plan.review[2].reason).toMatch(/already on the ledger \(entered in the app\)/);
		expect(plan.review[3].reason).toBe('no asset type and no URL on the row');
		expect(plan.review[0].raw).toEqual({ 'Date Published': '9/22/2026', 'Asset Type': 'Newsletter', Title: 'Issue 4', URL: 'https://substack.com/op/issue-4', Status: 'Sent' });
	});
	it('is idempotent: a page already imported from the same row keeps its id and number', () => {
		const again = planImport({
			spreadsheetId: 'SHEET',
			tab: 'Inventory',
			headers,
			rows: [rows[2]],
			ctx: ctx({ pages: [...ctx().pages, { id: 'p3', cluster_id: 'c1', number: 3, keyword: 'veteran resilience podcast', live_url: null, import_ref: 'SHEET!Inventory!2' }] }),
		});
		expect(again.pages[0]).toMatchObject({ existing_id: 'p3', number: 3 });
	});
	it('a single open cluster is assumed when the sheet has no cluster column; several clusters go to review', () => {
		const two = ctx({ clusters: [...ctx().clusters, { id: 'c2', number: 2, anchor_keyword: 'x', status: 'planning' }] });
		const p = planImport({ spreadsheetId: 'S', tab: 'T', headers: FIXTURES.sop_page_tracker, rows: [['1', 'kw', 'Title', 'https://overpressurepodcast.com/kw', 'Live', '9/1/2026', null]], ctx: two });
		expect(p.pages).toHaveLength(0);
		expect(p.review[0].reason).toMatch(/several clusters/);
		const one = planImport({ spreadsheetId: 'S', tab: 'T', headers: FIXTURES.sop_page_tracker, rows: [['4', 'new kw', 'Title', 'https://overpressurepodcast.com/kw', 'Live', '9/1/2026', null]], ctx: ctx() });
		expect(one.pages[0]).toMatchObject({ cluster_id: 'c1', number: 4 });
	});
	it('a channel outside the program template goes to review', () => {
		const p = planImport({ spreadsheetId: 'S', tab: 'T', headers, rows: [rows[0]], ctx: ctx({ channels: CHANNELS.filter((c) => c.key !== 'medium') }) });
		expect(p.citations).toHaveLength(0);
		expect(p.review[0].reason).toMatch(/not in the program's channel template/);
	});
});

describe('planImport on the real trackers (rows as exported 2026-10-02)', () => {
	const channels = CHANNELS.map((c) => ({ ...c, poster_default: c.key === 'faq_schema' ? 'network' : c.key === 'podcast' ? 'fourth_pillar' : 'person' }));
	const noClusters = (primaryUrl: string): PlanContext => ({ programId: 'prog', primaryUrl, channels, clusters: [], pages: [] });

	it('MINT Page Inventory: title rows + TOTAL footer skipped, network articles → faq_schema, Medium + Quora by host', () => {
		const grid: (string | number | null)[][] = [
			['Page Inventory — live Prong 2 assets'],
			['One row per published article. Verify Index Status with a site: query before every report.'],
			REAL.mint_page_inventory,
			[1, 'Ceramic Curling Iron', 'trendingconsumerism.com', 'https://trendingconsumerism.com/consumer-guides/curling-iron-ceramic-buyers-guide/', '2026-06-07', null, 'Yes', null, 'Primary target: curling iron ceramic (12,100/mo, SD 16)'],
			[6, 'Medium Cross-Cut (P1 + P3 close)', 'medium.com', 'https://medium.com/@robpene/everything-nobody-actually-tells-you-about-curling-irons-41e91c4e0257', '2026-07-16', null, 'Yes', null, 'Closes P1 + P3'],
			[7, 'Quora Citations', 'quora.com', 'https://www.quora.com/What-is-the-best-curling-iron-for-thick-hair/answer/Chris-Pene', '2026-07-16', null, 'Yes', null, 'REINFORCES P2 on Quora.'],
			['TOTAL'],
		];
		const { headers, rows } = gridToRows(grid);
		const plan = planImport({ spreadsheetId: 'MINTv2', tab: 'Page Inventory', headers, rows, ctx: noClusters('https://www.mintprotools.com/') });
		expect(summarizePlan(plan)).toBe('0 pages · 3 citations · 0 to review · 3 blank · 5 unknown headers');
		expect(plan.citations.map((c) => [c.import_ref, c.channel_key, c.poster_kind, c.status, c.posted_on])).toEqual([
			['MINTv2!Page Inventory!4', 'faq_schema', 'network', 'posted', '2026-06-07'],
			['MINTv2!Page Inventory!5', 'medium', 'person', 'posted', '2026-07-16'],
			['MINTv2!Page Inventory!6', 'quora_answer', 'person', 'posted', '2026-07-16'],
		]);
		// No cluster on the program yet: the sheet's label titles the row and is kept on the notes.
		expect(plan.citations[0]).toMatchObject({ cluster_id: null, title: 'Ceramic Curling Iron', notes_md: 'Sheet cluster: Ceramic Curling Iron\n\nPrimary target: curling iron ceramic (12,100/mo, SD 16)' });
	});

	it('Northwind Off-Site Citations: Platform column decides the channel, Posted is the date, Author the poster', () => {
		const grid: (string | number | null)[][] = [
			REAL.overpressure_offsite,
			[null, 'Medium', 'The Gratitude Practice That Stuck', 'https://medium.com/@vidalraphaella80/the-gratitude-practice-that-stuck-2571b5599e61', 'Riley Vidal', '2026-09-22', 'Yes — public', 'Yes', null, null],
			[null, 'Quora', 'Why does gratitude journaling feel fake?', 'https://pt.quora.com/profile/Riley-Vidal/Question-Why-does-gratitude-journaling-feel-fake', 'Riley Vidal', '2026-09-23', 'Yes — public', 'Yes', null, null],
		];
		const { headers, rows } = gridToRows(grid);
		const plan = planImport({ spreadsheetId: 'OP', tab: 'Off-Site Citations', headers, rows, ctx: noClusters('https://overpressurepodcast.com/') });
		expect(plan.review).toEqual([]);
		expect(plan.citations.map((c) => [c.row_number, c.channel_key, c.title, c.poster_handle, c.posted_on, c.notes_md])).toEqual([
			[2, 'medium', 'The Gratitude Practice That Stuck', 'Riley Vidal', '2026-09-22', null],
			[3, 'quora_answer', 'Why does gratitude journaling feel fake?', 'Riley Vidal', '2026-09-23', null],
		]);
	});

	it('a third-party host outside the network still goes to review with its reason', () => {
		const { headers, rows } = gridToRows([REAL.mint_page_inventory, [12, 'Guest post', 'someblog.example', 'https://someblog.example/curling', '2026-08-01', null, 'Yes', null, null]]);
		const plan = planImport({ spreadsheetId: 'S', tab: 'T', headers, rows, ctx: noClusters('https://www.mintprotools.com/') });
		expect(plan.citations).toEqual([]);
		expect(plan.review[0]).toMatchObject({ row_number: 2, reason: 'no channel or on-site page recognised (asset type "", url host "someblog.example")' });
	});

	it('only a footer with no URL counts as a totals row', () => {
		expect(isTotalsRow(['TOTAL', null, null], 2)).toBe(true);
		expect(isTotalsRow([null, 'Grand total:', null], 2)).toBe(true);
		expect(isTotalsRow(['Total', null, 'https://medium.com/x'], 2)).toBe(false);
		expect(isTotalsRow(['Totally new post', null, null], 2)).toBe(false);
	});
});
