import { describe, expect, it } from 'vitest';
import { shortName } from './cells';

describe('shortName', () => {
	it('keeps the first name and the last name initial', () => {
		expect(shortName('Sam Carter')).toBe('Sam C.');
		expect(shortName('Ana  de  Souza')).toBe('Ana S.');
	});
	it('leaves single names and emails alone', () => {
		expect(shortName('Kai')).toBe('Kai');
		expect(shortName('ops@example.com')).toBe('ops@example.com');
	});
});
