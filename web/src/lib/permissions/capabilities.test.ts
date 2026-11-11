import { describe, it, expect } from 'vitest';
import {
	CAPABILITIES,
	CAPABILITY_LABELS,
	CAPABILITY_DESCRIPTIONS,
	hasAdminFloor,
	type CapabilityKey,
} from './constants';

// getCapabilities() is a Supabase round trip behind React's cache() and is not
// unit-testable without mocking the client, which would test the mock. Its two
// behaviours that matter — admin/exec pass without a row, and an unreadable
// table DENIES rather than falling back to a permissive default — are asserted
// in SQL by the 0055 behaviour suite and by the browser walkthrough.
//
// What IS testable here is the vocabulary: every key must carry the UI strings
// the granting screen renders, or a capability added later shows up in the
// admin UI as a blank row with no explanation of what it hands over.

describe('capability vocabulary', () => {
	it('has at least the scraper capability', () => {
		expect(CAPABILITIES).toContain('run_scrapers');
	});

	// 0060: the acquisitions capability is the only gate on M&A sourcing and
	// deliberately has no admin floor — the SQL gate (can_view_acquisitions)
	// has no is_admin() shortcut, and the UI must agree or admins see a tab
	// the database refuses.
	it('registers acquisitions without an admin floor', () => {
		expect(CAPABILITIES).toContain('acquisitions');
		expect(hasAdminFloor('acquisitions')).toBe(false);
		expect(hasAdminFloor('run_scrapers')).toBe(true);
	});

	it('gives every capability a label', () => {
		for (const key of CAPABILITIES) {
			expect(CAPABILITY_LABELS[key], `missing label for ${key}`).toBeTruthy();
		}
	});

	// The description is what tells an admin they are handing over third-party
	// contact details. A capability without one is a toggle with no stakes shown.
	it('gives every capability a description', () => {
		for (const key of CAPABILITIES) {
			expect(CAPABILITY_DESCRIPTIONS[key], `missing description for ${key}`).toBeTruthy();
		}
	});

	it('says plainly that the scraper capability exposes third-party contact data', () => {
		expect(CAPABILITY_DESCRIPTIONS.run_scrapers.toLowerCase()).toContain('third-party');
	});

	it('carries no duplicate keys', () => {
		expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
	});

	// The key is a text column in user_capabilities and travels through URLs and
	// form posts; keeping it to a conservative charset avoids encoding surprises.
	it('uses snake_case keys only', () => {
		for (const key of CAPABILITIES) {
			expect(key, `${key} is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	// Guards the cast in getCapabilities(), which filters the DB rows against
	// this list before trusting them.
	it('types a known key without widening', () => {
		const key: CapabilityKey = 'run_scrapers';
		expect((CAPABILITIES as readonly string[]).includes(key)).toBe(true);
	});
});
