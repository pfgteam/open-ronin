import { describe, expect, it } from 'vitest';
import { offsetsAfterMove } from './boardOffsets';

describe('offsetsAfterMove', () => {
	it('a loaded card leaving a column moves that column’s server window back by one; arriving changes nothing (dedupe absorbs the overlap)', () => {
		expect(offsetsAfterMove({ a: 50, b: 50 }, 'a', 'b')).toEqual({ a: 49, b: 50 });
		expect(offsetsAfterMove({ a: 50 }, 'a', null)).toEqual({ a: 49 });
		expect(offsetsAfterMove({ a: 0 }, 'a', 'b')).toEqual({ a: 0 });
	});
});
