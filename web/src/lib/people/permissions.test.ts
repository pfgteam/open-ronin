import { describe, expect, it } from 'vitest';
import type { SensitiveAccessContext } from './permissions';
import {
	canEditStructure,
	canEditWiki,
	canManagePeople,
	canViewSensitive,
	isVisibleTo,
} from './permissions';

// Pins the privilege bug: the access context did not carry `profiles.is_active`,
// so DEACTIVATING an admin / exec / people-manager stripped their nav and
// /admin access while leaving comp-editing rights intact until their JWT
// expired. Every elevation path now requires an active viewer.
//
// Only the pure functions are covered — `loadSensitiveAccessContext` needs
// Supabase and belongs to integration tests.

const VIEWER = 'user-viewer';
const SUBJECT = 'user-subject';

function ctx(over: Partial<SensitiveAccessContext> = {}): SensitiveAccessContext {
	return {
		viewerId: VIEWER,
		viewerRole: 'member',
		viewerIsPeopleManager: false,
		viewerIsActive: true,
		...over,
	};
}

const SIGNED_OUT: SensitiveAccessContext = {
	viewerId: null,
	viewerRole: null,
	viewerIsPeopleManager: false,
	viewerIsActive: false,
};

const ELEVATED: [string, Partial<SensitiveAccessContext>][] = [
	['admin', { viewerRole: 'admin' }],
	['exec', { viewerRole: 'exec' }],
	['people-manager', { viewerRole: 'member', viewerIsPeopleManager: true }],
];

describe('deactivation revokes elevation', () => {
	for (const [label, role] of ELEVATED) {
		it(`grants an active ${label} the full set`, () => {
			const c = ctx({ ...role, viewerIsActive: true });
			expect(canManagePeople(c)).toBe(true);
			expect(canEditStructure(c)).toBe(true);
			expect(canEditWiki(c)).toBe(true);
			expect(canViewSensitive(c, SUBJECT)).toBe(true);
		});

		it(`refuses a deactivated ${label} everywhere`, () => {
			const c = ctx({ ...role, viewerIsActive: false });
			expect(canManagePeople(c)).toBe(false);
			expect(canEditStructure(c)).toBe(false);
			expect(canEditWiki(c)).toBe(false);
			expect(canViewSensitive(c, SUBJECT)).toBe(false);
		});
	}
});

describe('canViewSensitive', () => {
	it('lets a viewer read their OWN record even while deactivated', () => {
		// Deliberate: someone mid-offboarding still needs their own record.
		expect(canViewSensitive(ctx({ viewerIsActive: false }), VIEWER)).toBe(true);
		expect(canViewSensitive(ctx({ viewerRole: 'member', viewerIsActive: false }), VIEWER)).toBe(
			true,
		);
	});

	it('refuses a plain active member on someone else', () => {
		expect(canViewSensitive(ctx(), SUBJECT)).toBe(false);
	});

	it('refuses a manager on someone else (managing is not comp access)', () => {
		expect(canViewSensitive(ctx({ viewerRole: 'manager' }), SUBJECT)).toBe(false);
	});

	it('refuses a signed-out context, even for the matching id', () => {
		expect(canViewSensitive(SIGNED_OUT, SUBJECT)).toBe(false);
		expect(canViewSensitive(SIGNED_OUT, '')).toBe(false);
	});
});

describe('canManagePeople / canEditStructure', () => {
	it('refuses a plain member and a manager', () => {
		expect(canManagePeople(ctx())).toBe(false);
		expect(canManagePeople(ctx({ viewerRole: 'manager' }))).toBe(false);
		expect(canEditStructure(ctx({ viewerRole: 'manager' }))).toBe(false);
	});

	it('refuses a signed-out context', () => {
		expect(canManagePeople(SIGNED_OUT)).toBe(false);
		expect(canEditStructure(SIGNED_OUT)).toBe(false);
	});

	it('stays an alias of canManagePeople', () => {
		for (const c of [ctx(), ctx({ viewerRole: 'admin' }), ctx({ viewerRole: 'manager' }), SIGNED_OUT]) {
			expect(canEditStructure(c)).toBe(canManagePeople(c));
		}
	});
});

describe('canEditWiki', () => {
	it('lets a manager edit the wiki without managing people', () => {
		const c = ctx({ viewerRole: 'manager' });
		expect(canEditWiki(c)).toBe(true);
		expect(canManagePeople(c)).toBe(false);
	});

	it('refuses a deactivated manager', () => {
		expect(canEditWiki(ctx({ viewerRole: 'manager', viewerIsActive: false }))).toBe(false);
	});

	it('refuses a plain member and a signed-out context', () => {
		expect(canEditWiki(ctx())).toBe(false);
		expect(canEditWiki(SIGNED_OUT)).toBe(false);
	});
});

describe('isVisibleTo', () => {
	it('shows public content to anyone, signed out included', () => {
		expect(isVisibleTo(SIGNED_OUT, 'public')).toBe(true);
		expect(isVisibleTo(SIGNED_OUT, null)).toBe(true);
		expect(isVisibleTo(SIGNED_OUT, undefined)).toBe(true);
		expect(isVisibleTo(SIGNED_OUT, '')).toBe(true);
	});

	it('shows team content to any signed-in viewer only', () => {
		expect(isVisibleTo(ctx(), 'team')).toBe(true);
		expect(isVisibleTo(SIGNED_OUT, 'team')).toBe(false);
	});

	it('gates managers content on canManagePeople', () => {
		expect(isVisibleTo(ctx({ viewerRole: 'admin' }), 'managers')).toBe(true);
		expect(isVisibleTo(ctx({ viewerIsPeopleManager: true }), 'managers')).toBe(true);
		expect(isVisibleTo(ctx({ viewerRole: 'manager' }), 'managers')).toBe(false);
		expect(isVisibleTo(ctx(), 'managers')).toBe(false);
		// The deactivation rule reaches wiki visibility too.
		expect(isVisibleTo(ctx({ viewerRole: 'admin', viewerIsActive: false }), 'managers')).toBe(false);
	});

	it('hides self-visibility content (no subject id to compare)', () => {
		expect(isVisibleTo(ctx({ viewerRole: 'admin' }), 'self')).toBe(false);
	});

	it('hides content with an unknown visibility (fail closed)', () => {
		expect(isVisibleTo(ctx({ viewerRole: 'admin' }), 'board-only')).toBe(false);
	});
});
