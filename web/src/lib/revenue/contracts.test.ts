import { describe, expect, it } from 'vitest';
import { lineItemsTable, markdownToHtml, renderContract, totals } from './contracts';

const items = [
	{ name: 'Kickstarter', qty: 1, unit_cents: 475000, billing: 'monthly' as const },
	{ name: 'PR Foundations', qty: 1, unit_cents: 975000, billing: 'one_time' as const },
	{ name: 'Extra client', qty: 2, unit_cents: 20000, billing: 'per_unit' as const },
];

describe('contract rendering', () => {
	it('totals split monthly vs one-time, per-unit counts as monthly', () => {
		expect(totals(items)).toEqual({ mrr_cents: 515000, one_time_cents: 975000 });
	});
	it('fills every placeholder and renders the line-item table', () => {
		const md = renderContract({
			template: '# A\n{{brand_name}} / {{signer_name}}{{signer_title}} / {{start_date}} / {{term_months}}\n{{line_items}}\n{{mrr_total}}{{one_time_line}}\n{{deposit_line}}{{terms}}',
			brand_name: 'Acme', signer_name: 'Jane', signer_title: 'CEO', start_date: '2026-11-01', term_months: 6, line_items: items, deposit_cents: 100000, terms: 'TN law.',
		});
		expect(md).toContain('Acme / Jane (CEO) / 2026-11-01 / 6');
		expect(md).toContain('| Kickstarter | 1 | $4,750 | monthly | $4,750 |');
		expect(md).toContain('$5,150 / month · **One-time: $9,750**');
		expect(md).toContain('A deposit of $1,000 is due on signature.');
		expect(md).toContain('TN law.');
		expect(md).not.toContain('{{');
	});
	it('table helper and html conversion', () => {
		expect(lineItemsTable([])).toBe('_No line items._');
		const html = markdownToHtml('# Title\n\nHello **world**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- one\n- two');
		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<strong>world</strong>');
		expect(html).toContain('<td style="padding:4px 8px;border:1px solid #ccc">1</td>');
		expect(html).toContain('<li>two</li>');
		expect(markdownToHtml('<script>')).toContain('&lt;script&gt;');
	});
});
