import { describe, expect, it } from 'vitest';
import { resolveSignInMethods } from './signInMethods';

describe('resolveSignInMethods', () => {
	it('fresh install: email + password only (no Google provider, no email provider)', () => {
		expect(resolveSignInMethods({ googleProviderEnabled: false, authEmailEnabled: undefined, orgMethods: null })).toEqual({
			password: true,
			google: false,
			magicLink: false,
			email: false,
		});
	});

	it('hides Google when Supabase Auth cannot be reached', () => {
		expect(resolveSignInMethods({ googleProviderEnabled: null, authEmailEnabled: 'true', orgMethods: null }).google).toBe(false);
	});

	it('shows Google once the provider is enabled in Supabase Auth', () => {
		expect(resolveSignInMethods({ googleProviderEnabled: true, authEmailEnabled: '', orgMethods: null }).google).toBe(true);
	});

	it('shows the magic link only when an email provider is set', () => {
		expect(resolveSignInMethods({ googleProviderEnabled: false, authEmailEnabled: 'false', orgMethods: null }).magicLink).toBe(false);
		expect(resolveSignInMethods({ googleProviderEnabled: false, authEmailEnabled: 'true', orgMethods: null }).magicLink).toBe(true);
		expect(resolveSignInMethods({ googleProviderEnabled: false, authEmailEnabled: '1', orgMethods: [] }).magicLink).toBe(true);
	});

	it("the org's choice can switch a configured method off, never on", () => {
		const off = resolveSignInMethods({ googleProviderEnabled: true, authEmailEnabled: 'true', orgMethods: ['password'] });
		expect(off).toMatchObject({ password: true, google: false, magicLink: false, email: true });
		const notConfigured = resolveSignInMethods({ googleProviderEnabled: false, authEmailEnabled: undefined, orgMethods: ['google', 'magic_link'] });
		expect(notConfigured).toMatchObject({ password: true, google: false, magicLink: false });
	});
});
