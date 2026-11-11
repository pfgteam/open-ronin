import { describe, expect, it } from 'vitest';
import { shouldSyncSearchFromUrl } from './searchSync';

describe('shouldSyncSearchFromUrl', () => {
	it('ignores the echo of our own push, follows other URL changes (Back, Clear filters)', () => {
		expect(shouldSyncSearchFromUrl('john', 'john')).toBe(false);
		expect(shouldSyncSearchFromUrl(null, 'john')).toBe(true);
		expect(shouldSyncSearchFromUrl('acme', undefined)).toBe(true);
	});
});
