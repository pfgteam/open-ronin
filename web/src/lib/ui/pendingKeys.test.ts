import { describe, expect, it } from 'vitest';
import { withKey, withoutKey } from './pendingKeys';

describe('pending keys', () => {
	it('tracks overlapping actions independently, so the first button keeps spinning', () => {
		let s = withKey(new Set<string>(), 'send:1');
		s = withKey(s, 'portal:2');
		expect([...s].sort()).toEqual(['portal:2', 'send:1']);
		s = withoutKey(s, 'portal:2');
		expect(s.has('send:1')).toBe(true);
	});
	it('returns new sets (React state must not be mutated)', () => {
		const a = new Set<string>();
		expect(withKey(a, 'x')).not.toBe(a);
		expect(a.size).toBe(0);
	});
});
