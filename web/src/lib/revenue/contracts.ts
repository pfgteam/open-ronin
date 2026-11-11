// Contract rendering (0126). Pure: template markdown + contract fields ->
// filled markdown / html. No server imports; tested.

export interface LineItem {
	product_id?: string | null;
	name: string;
	qty: number;
	unit_cents: number;
	billing: 'monthly' | 'one_time' | 'per_unit';
	kind?: string;
}

export function totals(items: LineItem[]): { mrr_cents: number; one_time_cents: number } {
	let mrr = 0, once = 0;
	for (const li of items) {
		const line = Math.round((li.qty || 0) * (li.unit_cents || 0));
		if (li.billing === 'one_time') once += line;
		else mrr += line;
	}
	return { mrr_cents: mrr, one_time_cents: once };
}

export function money(cents: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

export function lineItemsTable(items: LineItem[]): string {
	if (!items.length) return '_No line items._';
	const rows = items.map((li) => `| ${li.name} | ${li.qty} | ${money(li.unit_cents)} | ${li.billing === 'one_time' ? 'one-time' : li.billing === 'per_unit' ? 'per unit / month' : 'monthly'} | ${money(li.qty * li.unit_cents)} |`);
	return ['| Item | Qty | Unit | Billing | Total |', '|---|---|---|---|---|', ...rows].join('\n');
}

export interface RenderInput {
	template: string;
	terms?: string | null;
	brand_name: string;
	signer_name: string;
	signer_title?: string | null;
	start_date: string;
	term_months?: number | null;
	line_items: LineItem[];
	deposit_cents?: number | null;
}

export function renderContract(i: RenderInput): string {
	const t = totals(i.line_items);
	const vars: Record<string, string> = {
		brand_name: i.brand_name,
		signer_name: i.signer_name,
		signer_title: i.signer_title ? ` (${i.signer_title})` : '',
		start_date: i.start_date,
		term_months: String(i.term_months ?? 1),
		line_items: lineItemsTable(i.line_items),
		mrr_total: `${money(t.mrr_cents)} / month`,
		one_time_line: t.one_time_cents ? ` · **One-time: ${money(t.one_time_cents)}**` : '',
		deposit_line: i.deposit_cents ? `A deposit of ${money(i.deposit_cents)} is due on signature. ` : '',
		terms: i.terms ?? '',
	};
	return i.template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Minimal markdown → HTML for the e-sign document (headings, bold, tables, paragraphs, lists). */
export function markdownToHtml(md: string): string {
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>');
	const lines = md.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const l = lines[i];
		if (/^\|/.test(l)) {
			const rows: string[] = [];
			while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
			const cells = (r: string) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
			const head = cells(rows[0]);
			const body = rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td style="padding:4px 8px;border:1px solid #ccc">${c}</td>`).join('')}</tr>`);
			out.push(`<table style="border-collapse:collapse;margin:12px 0"><thead><tr>${head.map((h) => `<th style="padding:4px 8px;border:1px solid #ccc;text-align:left">${h}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table>`);
			continue;
		}
		if (/^#\s/.test(l)) out.push(`<h1>${inline(l.slice(2))}</h1>`);
		else if (/^##\s/.test(l)) out.push(`<h2>${inline(l.slice(3))}</h2>`);
		else if (/^\s*[-*]\s/.test(l)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s/, ''))}</li>`);
			out.push(`<ul>${items.join('')}</ul>`);
			continue;
		} else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
		i++;
	}
	return `<div style="font-family:Georgia,serif;font-size:14px;line-height:1.5;max-width:720px">${out.join('\n')}</div>`;
}
