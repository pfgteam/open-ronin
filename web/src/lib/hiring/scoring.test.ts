import { describe, expect, it } from 'vitest';
import { htmlToText } from './scoring';

describe('htmlToText', () => {
	it('strips scripts/styles, keeps block breaks, decodes entities and caps length', () => {
		const html = '<html><head><title>T</title><style>.x{}</style><script>var a=1</script></head><body><h1>Hi &amp; welcome</h1><p>One</p><ul><li>a</li><li>b &lt;c&gt;</li></ul></body></html>';
		const t = htmlToText(html);
		expect(t).toContain('Hi & welcome');
		expect(t).toContain('b <c>');
		expect(t).not.toContain('var a=1');
		expect(t).not.toContain('.x{}');
		expect(t.split('\n').length).toBeGreaterThanOrEqual(3);
		expect(htmlToText('<p>' + 'x'.repeat(50_000) + '</p>', 100).length).toBe(100);
	});
});
