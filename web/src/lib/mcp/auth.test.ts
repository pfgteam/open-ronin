import { describe, expect, it } from 'vitest';
import { hashToken } from './auth';

describe('hashToken', () => {
	it('is sha-256 hex, byte-identical to Postgres digest(...,"sha256")', () => {
		// echo -n abc | sha256sum
		expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
	it('is deterministic and lowercase hex of length 64', () => {
		const h = hashToken('tPuWi8gP12IPs3A9jR2nD0c8qr5hj3E6');
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(hashToken('tPuWi8gP12IPs3A9jR2nD0c8qr5hj3E6')).toBe(h);
	});
});
