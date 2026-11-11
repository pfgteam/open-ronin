import { describe, it, expect } from 'vitest';
import { planSquareCrop } from './squareResize';

describe('planSquareCrop', () => {
	it('crops a landscape image to the centre square', () => {
		expect(planSquareCrop({ width: 1000, height: 600, max: 512 }))
			.toEqual({ sx: 200, sy: 0, size: 600, out: 512 });
	});

	it('crops a portrait image to the centre square', () => {
		expect(planSquareCrop({ width: 600, height: 1000, max: 512 }))
			.toEqual({ sx: 0, sy: 200, size: 600, out: 512 });
	});

	it('leaves a square image alone but still caps the output', () => {
		expect(planSquareCrop({ width: 2000, height: 2000, max: 512 }))
			.toEqual({ sx: 0, sy: 0, size: 2000, out: 512 });
	});

	it('never upscales: a small image keeps its own size as the output', () => {
		expect(planSquareCrop({ width: 200, height: 300, max: 512 }))
			.toEqual({ sx: 0, sy: 50, size: 200, out: 200 });
	});

	it('handles an odd-pixel offset without a fractional crop origin', () => {
		const p = planSquareCrop({ width: 101, height: 100, max: 512 });
		expect(Number.isInteger(p.sx)).toBe(true);
		expect(Number.isInteger(p.sy)).toBe(true);
		expect(p.size).toBe(100);
	});

	it('is pure — the same input twice gives the same plan', () => {
		const a = planSquareCrop({ width: 1234, height: 777, max: 512 });
		const b = planSquareCrop({ width: 1234, height: 777, max: 512 });
		expect(a).toEqual(b);
	});
});
