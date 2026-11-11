import { describe, expect, it } from 'vitest';
import { splitLinks } from './linkify';

const hrefs = (t: string) => splitLinks(t).filter((p) => p.href).map((p) => p.href);

describe('splitLinks', () => {
	it('leaves text without links alone', () => {
		expect(splitLinks('no links here')).toEqual([{ text: 'no links here' }]);
	});
	it('links http(s) URLs and keeps the text around them', () => {
		expect(splitLinks('see https://drive.google.com/x?id=1 now')).toEqual([
			{ text: 'see ' },
			{ text: 'https://drive.google.com/x?id=1', href: 'https://drive.google.com/x?id=1' },
			{ text: ' now' },
		]);
	});
	it('adds https:// to www. links', () => {
		expect(hrefs('www.canva.com/design/abc')).toEqual(['https://www.canva.com/design/abc']);
	});
	it('leaves sentence punctuation outside the link', () => {
		expect(hrefs('Final: https://a.com/b. Thanks')).toEqual(['https://a.com/b']);
		expect(hrefs('(https://a.com/b)')).toEqual(['https://a.com/b']);
	});
	it('keeps a closing paren that belongs to the URL', () => {
		expect(hrefs('https://en.wikipedia.org/wiki/PR_(disambiguation)')).toEqual(['https://en.wikipedia.org/wiki/PR_(disambiguation)']);
	});
	it('finds several links across lines', () => {
		expect(hrefs('a https://x.com\nb https://y.com')).toEqual(['https://x.com', 'https://y.com']);
	});
	it('never links a javascript: URL', () => {
		expect(hrefs('javascript:alert(1)')).toEqual([]);
	});
});
