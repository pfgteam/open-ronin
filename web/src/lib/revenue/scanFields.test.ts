import { describe, expect, it } from 'vitest';
import { allowedValues, buildDiff, cleanFound, htmlToText, isFetchableUrl, literalInSource, parseJsonObject, pickSubpages } from './scanFields';

describe('htmlToText', () => {
	it('drops scripts, styles and tags and decodes entities', () => {
		const html = '<html><head><style>p{}</style><script>var x=1</script></head><body><h1>Hi&nbsp;there</h1><p>A &amp; B</p></body></html>';
		expect(htmlToText(html)).toBe('Hi there\nA & B');
	});
	it('caps the length', () => {
		expect(htmlToText(`<p>${'a'.repeat(50)}</p>`, 10)).toHaveLength(10);
	});
});

describe('pickSubpages', () => {
	const html = '<a href="/about-us">About</a><a href="https://other.com/team">x</a><a href="/shop">Shop</a><a href="https://www.brand.com/our-team#top">Team</a><a href="/contact">C</a>';
	it('keeps same-site about/team/contact links, up to the limit', () => {
		expect(pickSubpages(html, 'https://brand.com')).toEqual(['https://brand.com/about-us', 'https://www.brand.com/our-team']);
	});
	it('returns nothing for a bad base URL', () => {
		expect(pickSubpages(html, 'not a url')).toEqual([]);
	});
});

describe('isFetchableUrl', () => {
	it('allows public http(s) hosts', () => {
		expect(isFetchableUrl('https://brand.com/about')).toBe(true);
	});
	it('blocks other schemes, localhost and private ranges', () => {
		for (const u of ['file:///etc/passwd', 'http://localhost:3000', 'http://127.0.0.1', 'http://10.0.0.5', 'http://192.168.1.1', 'http://172.20.0.1', 'http://169.254.169.254/latest', 'http://intranet', 'http://[::1]/']) {
			expect(isFetchableUrl(u)).toBe(false);
		}
	});
});

describe('parseJsonObject', () => {
	it('reads a JSON object wrapped in prose or a fence', () => {
		expect(parseJsonObject('Sure:\n```json\n{"title":"CEO"}\n```')).toEqual({ title: 'CEO' });
	});
	it('returns null when there is no object', () => {
		expect(parseJsonObject('no json')).toBeNull();
		expect(parseJsonObject('[1,2]')).toBeNull();
	});
});

describe('literalInSource', () => {
	it('keeps an email only when the page has it', () => {
		expect(literalInSource('email', 'Ana@Brand.com', 'write to ana@brand.com')).toBe(true);
		expect(literalInSource('email', 'ana@brand.com', 'no email here')).toBe(false);
	});
	it('matches phones by digits', () => {
		expect(literalInSource('phone', '+1 (615) 555-0100', 'Call 615.555.0100')).toBe(true);
		expect(literalInSource('phone', '615-555-0199', 'Call 615.555.0100')).toBe(false);
	});
	it('does not restrict other fields', () => {
		expect(literalInSource('title', 'CEO', '')).toBe(true);
	});
});

describe('cleanFound', () => {
	it('keeps allowed string fields and drops placeholders and invented contacts', () => {
		const raw = { title: ' Founder & CEO ', location: 'unknown', email: 'made@up.com', phone: '615-555-0100', salary: '1M', instagram: 42 };
		expect(cleanFound('person', raw, 'Founder & CEO. Call 615 555 0100')).toEqual({ title: 'Founder & CEO', phone: '615-555-0100' });
	});
	it('flattens brand socials', () => {
		expect(cleanFound('brand', { industry: 'Beauty', socials: { instagram: '@brand', myspace: 'x' } }, '')).toEqual({ industry: 'Beauty', 'socials.instagram': '@brand' });
	});
	it('rejects a malformed email even when present', () => {
		expect(cleanFound('person', { email: 'not-an-email' }, 'not-an-email')).toEqual({});
	});
});

describe('buildDiff', () => {
	it('lists only new or different values, in field order', () => {
		const rows = buildDiff('person', { title: 'CEO', location: null, website: 'https://a.com/' }, {
			title: { value: 'ceo', source: 'linkedin' },
			location: { value: 'HQ, TN', source: 'linkedin' },
			website: { value: 'https://a.com', source: 'website' },
			email: { value: 'ana@a.com', source: 'website' },
		});
		expect(rows.map((r) => [r.key, r.current, r.found, r.source])).toEqual([
			['location', null, 'HQ, TN', 'linkedin'],
			['email', null, 'ana@a.com', 'website'],
		]);
	});
});

describe('allowedValues', () => {
	it('drops keys the target cannot write', () => {
		expect(allowedValues('brand', { industry: 'CPG', 'socials.x': '@b', owner_id: 'x', description: '  ' })).toEqual({ industry: 'CPG', 'socials.x': '@b' });
	});
});
