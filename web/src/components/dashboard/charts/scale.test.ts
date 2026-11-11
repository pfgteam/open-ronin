import { describe, expect, it } from 'vitest';
import { barSlots, domain, finite, linePath, scale, tickLabel, yTicks, type Frame } from './scale';

const frame: Frame = { width: 100, height: 50, pad: 5, labelGutter: 0 };

describe('domain', () => {
	it('spans the finite values across every series', () => {
		expect(domain([[3, null, 9], [1]])).toEqual({ min: 1, max: 9 });
	});
	it('pins the baseline at zero when asked', () => {
		expect(domain([[4, 8]], true)).toEqual({ min: 0, max: 8 });
	});
	it('never collapses to a zero span', () => {
		expect(domain([[5, 5]])).toEqual({ min: 5, max: 6 });
		expect(domain([[]])).toEqual({ min: 0, max: 1 });
	});
});

describe('scale', () => {
	it('maps the domain onto the inner frame, y inverted', () => {
		const s = scale(3, frame, { min: 0, max: 10 });
		expect(s.x(0)).toBe(5);
		expect(s.x(2)).toBe(95);
		expect(s.y(10)).toBe(5);
		expect(s.y(0)).toBe(45);
		expect(s.zeroY).toBe(45);
	});
	it('reserves the label gutter at the bottom', () => {
		const s = scale(2, { ...frame, labelGutter: 10 }, { min: 0, max: 1 });
		expect(s.y(0)).toBe(35);
	});
	it('centres a single point', () => {
		expect(scale(1, frame, { min: 0, max: 1 }).x(0)).toBe(50);
	});
	it('has no zero line when zero is outside the domain', () => {
		expect(scale(2, frame, { min: 3, max: 9 }).zeroY).toBeNull();
	});
});

describe('linePath', () => {
	it('breaks the line at a gap', () => {
		const s = scale(4, frame, { min: 0, max: 10 });
		expect(linePath([0, 10, null, 5], s)).toBe('M 5.0 45.0 L 35.0 5.0 M 95.0 25.0');
	});
	it('bridges a gap when asked', () => {
		const s = scale(4, frame, { min: 0, max: 10 });
		expect(linePath([0, 10, null, 5], s, true)).toBe('M 5.0 45.0 L 35.0 5.0 L 95.0 25.0');
	});
	it('is empty with no points', () => {
		expect(linePath([null, null], scale(2, frame, { min: 0, max: 1 }))).toBe('');
	});
});

describe('barSlots', () => {
	it('splits the inner width evenly and centres bars', () => {
		const b = barSlots(3, frame, 0.5);
		expect(b.slot).toBe(30);
		expect(b.bar).toBe(15);
		expect(b.left(0)).toBe(12.5);
		expect(b.left(2)).toBe(72.5);
	});
});

describe('ticks and labels', () => {
	it('yields evenly spaced ticks including both ends', () => {
		expect(yTicks({ min: 0, max: 10 }, 3)).toEqual([0, 5, 10]);
	});
	it('abbreviates thousands and millions', () => {
		expect(tickLabel(950)).toBe('950');
		expect(tickLabel(1200)).toBe('1.2k');
		expect(tickLabel(2000)).toBe('2k');
		expect(tickLabel(3_500_000)).toBe('3.5m');
		expect(tickLabel(2.5)).toBe('2.5');
	});
	it('finite drops nulls and NaN', () => {
		expect(finite([1, null, Number.NaN, 2])).toEqual([1, 2]);
	});
});
