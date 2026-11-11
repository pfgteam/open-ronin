import { describe, expect, it } from 'vitest';
import { hashToken, mintToken, pick, tokenMatches, trimPayload } from './intake';
import { scoreWebsite } from './enrichment';

describe('intake tokens', () => {
	it('mints a recognisable, url-safe token and matches only its own hash', () => {
		const t = mintToken('manychat');
		expect(t.startsWith('or_manychat_')).toBe(true);
		expect(/^[A-Za-z0-9_\-]+$/.test(t)).toBe(true);
		const h = hashToken(t);
		expect(h).toHaveLength(64);
		expect(tokenMatches(t, h)).toBe(true);
		expect(tokenMatches(`${t}x`, h)).toBe(false);
		expect(tokenMatches(t, null)).toBe(false);
		expect(tokenMatches(null, h)).toBe(false);
	});
});

describe('pick', () => {
	it('walks dotted paths through objects and arrays', () => {
		const p = { contact: { email: 'a@b.com' }, fields: [{ value: 'x' }, { value: 'y' }], flat: 'z' };
		expect(pick(p, 'contact.email')).toBe('a@b.com');
		expect(pick(p, 'fields.1.value')).toBe('y');
		expect(pick(p, 'flat')).toBe('z');
		expect(pick(p, 'contact.phone')).toBeUndefined();
		expect(pick(p, 'fields.9.value')).toBeUndefined();
		expect(pick(null, 'a')).toBeUndefined();
	});
});

describe('trimPayload', () => {
	it('caps strings, depth and key count', () => {
		const long = 'x'.repeat(5000);
		const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
		expect((trimPayload(long) as string).length).toBe(2001);
		expect(JSON.stringify(trimPayload(deep))).toContain('[…]');
		const wide: Record<string, number> = {};
		for (let i = 0; i < 300; i++) wide[`k${i}`] = i;
		expect(Object.keys(trimPayload(wide) as object)).toHaveLength(200);
	});
});

describe('scoreWebsite', () => {
	it('scores the MQL checklist 1..3 by hits', () => {
		const thin = '<html><title>Hi</title><p>hello</p></html>';
		expect(scoreWebsite(thin).score).toBe(1);
		const rich = `<html><title>Acme</title>
			<p>Testimonials from our clients</p><a href="tel:+16155550100">Call</a>
			<p>Trusted by brands we love</p><p>As seen in the press</p><p>Meet the team</p>
			<a href="/shop">Shop products</a><a href="https://www.instagram.com/acme">IG</a>
			${'<p>filler</p>'.repeat(3000)}</html>`;
		const r = scoreWebsite(rich);
		expect(r.score).toBe(3);
		expect(r.checks.socials).toBe(true);
		expect(r.checks.testimonials).toBe(true);
		const mid = '<html><p>Testimonials</p><p>Our team</p><p>Pricing</p><a href="https://facebook.com/x">fb</a></html>';
		expect(scoreWebsite(mid).score).toBe(2);
	});
});
