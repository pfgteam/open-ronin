import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './safeRedirect';

// Pins the open redirect in the auth callback: `new URL(next, origin)` does
// NOT force the origin, so "//evil.com" and "https://evil.com" both won over
// the base. The victim authenticated for real, got a session cookie, then
// landed on an attacker page feeling logged in.

describe('safeInternalPath rejects', () => {
	const hostile: [string, string][] = [
		['a protocol-relative URL', '//evil.com'],
		['a protocol-relative URL with a path', '//evil.com/steal'],
		['an https absolute URL', 'https://evil.com'],
		['an http absolute URL', 'http://evil.com'],
		['a backslash network-path reference', '/\\evil.com'],
		['a backslash anywhere in the path', '/clients\\..\\admin'],
		['a raw newline', '/clients\nSet-Cookie: x=1'],
		['a raw carriage return', '/clients\rLocation: https://evil.com'],
		['a raw tab', '/clients\tfoo'],
		['a NUL byte', '/clients\u0000'],
		['an empty string', ''],
		['a javascript: URL', 'javascript:alert(1)'],
		['a bare host', 'evil.com'],
		['a relative path', 'clients'],
	];

	for (const [label, value] of hostile) {
		it(`returns the fallback for ${label}`, () => {
			expect(safeInternalPath(value)).toBe('/');
		});
	}

	it('returns the fallback for null and undefined', () => {
		expect(safeInternalPath(null)).toBe('/');
		expect(safeInternalPath(undefined)).toBe('/');
	});
});

describe('safeInternalPath passes through', () => {
	const legit = ['/', '/clients', '/team/abc?tab=metrics', '/the-work/123#comments'];

	for (const value of legit) {
		it(`keeps ${value}`, () => {
			expect(safeInternalPath(value)).toBe(value);
		});
	}
});

describe('safeInternalPath fallback', () => {
	it('honours a custom fallback', () => {
		expect(safeInternalPath('https://evil.com', '/dashboard')).toBe('/dashboard');
		expect(safeInternalPath(null, '/dashboard')).toBe('/dashboard');
		expect(safeInternalPath('', '/dashboard')).toBe('/dashboard');
	});

	it('does not apply the fallback to a safe path', () => {
		expect(safeInternalPath('/clients', '/dashboard')).toBe('/clients');
	});
});
