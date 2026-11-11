import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BarChart, LineChart, StackedBarChart } from './index';

describe('BarChart', () => {
	it('draws the quota overlay as a dashed amber line at the quota height', () => {
		// A Kickstarter client: quota 5 every month, secured varies.
		const html = renderToStaticMarkup(
			createElement(BarChart, {
				values: [0, 10, 6, 4],
				overlay: { label: 'Package quota (5/mo)', values: [5, 5, 5, 5], tone: 'warning', dashed: true },
				labels: ['a', 'b', 'c', 'd'],
				width: 100,
				height: 60,
			}),
		);
		expect(html).toContain('<title>Package quota (5/mo)</title>');
		expect(html).toContain('stroke-dasharray="4 4"');
		expect(html).toContain('stroke-amber-500');
		// Frame: pad 8, gutter 14, inner height 60 - 16 - 14 = 30, domain 0..10.
		// y(5) = 8 + 30 - 15 = 23, flat across the whole path.
		expect(html).toMatch(/d="M 8\.0 23\.0 L [0-9.]+ 23\.0 L [0-9.]+ 23\.0 L 92\.0 23\.0"/);
		// Four bars, the zero bar collapsed to no height.
		expect(html.match(/<rect/g)?.length).toBe(4);
		expect(html).toContain('height="0.0"');
	});
	it('renders nothing with no values', () => {
		expect(renderToStaticMarkup(createElement(BarChart, { values: [] }))).toBe('');
	});
});

describe('LineChart', () => {
	it('draws one path per series and a marker on the last point of solid lines', () => {
		const html = renderToStaticMarkup(
			createElement(LineChart, {
				series: [
					{ label: 'Secured', values: [1, 2, 3] },
					{ label: 'Goal', values: [2, 2, 2], dashed: true, tone: 'warning' },
				],
				width: 100,
				height: 50,
			}),
		);
		expect(html.match(/<path/g)?.length).toBe(2);
		expect(html.match(/<circle/g)?.length).toBe(1);
		expect(html).toContain('<title>Secured</title>');
	});
});

describe('StackedBarChart', () => {
	it('stacks the series per index in order', () => {
		const html = renderToStaticMarkup(
			createElement(StackedBarChart, {
				series: [
					{ label: 'Kickstarter', values: [10], tone: 'primary' },
					{ label: 'Beacon', values: [19], tone: 'accent' },
				],
				width: 100,
				height: 50,
			}),
		);
		expect(html).toContain('<title>Kickstarter: 10</title>');
		expect(html).toContain('<title>Beacon: 19</title>');
		expect(html.match(/<rect/g)?.length).toBe(2);
	});
});
