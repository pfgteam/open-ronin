// File parsing for Data Imports. CSV is parsed here (RFC 4180: quoted
// fields, doubled quotes, newlines inside quotes, a UTF 8 BOM). XLSX goes
// through exceljs in parseXlsx, server side only, because the workbook
// reader is the one dependency this module adds.

export interface ParsedFile {
	headers: string[];
	/** Row values by column position, as strings. Empty rows are dropped. */
	rows: string[][];
	/** Sheet names for XLSX, so the wizard can offer a picker. */
	sheets?: string[];
}

export const MAX_ROWS = 50_000;

export function parseCsv(text: string, opts: { maxRows?: number } = {}): ParsedFile {
	const maxRows = opts.maxRows ?? MAX_ROWS;
	let s = text;
	if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

	const records: string[][] = [];
	let field = '';
	let record: string[] = [];
	let inQuotes = false;
	let i = 0;
	const n = s.length;
	const delimiter = sniffDelimiter(s);

	while (i < n) {
		const c = s[i];
		if (inQuotes) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += c;
			i++;
			continue;
		}
		if (c === '"') {
			inQuotes = true;
			i++;
			continue;
		}
		if (c === delimiter) {
			record.push(field);
			field = '';
			i++;
			continue;
		}
		if (c === '\r' || c === '\n') {
			record.push(field);
			field = '';
			records.push(record);
			record = [];
			if (c === '\r' && s[i + 1] === '\n') i += 2;
			else i++;
			if (records.length > maxRows + 1) break;
			continue;
		}
		field += c;
		i++;
	}
	if (field.length > 0 || record.length > 0) {
		record.push(field);
		records.push(record);
	}

	const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
	if (nonEmpty.length === 0) return { headers: [], rows: [] };
	const headers = nonEmpty[0].map((h) => h.trim());
	const width = headers.length;
	const rows = nonEmpty.slice(1, maxRows + 1).map((r) => {
		const out = r.slice(0, width).map((v) => v.trim());
		while (out.length < width) out.push('');
		return out;
	});
	return { headers, rows };
}

/** Comma unless the first line has more semicolons or tabs than commas. */
function sniffDelimiter(s: string): string {
	const firstLine = s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n'));
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
	let inQuotes = false;
	for (const c of firstLine) {
		if (c === '"') inQuotes = !inQuotes;
		else if (!inQuotes && c in counts) counts[c]++;
	}
	let best = ',';
	for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
	return best;
}

export function isXlsxName(name: string): boolean {
	return /\.xlsx$/i.test(name);
}

export function isCsvName(name: string): boolean {
	return /\.(csv|txt|tsv)$/i.test(name);
}

/** Serializes rows back to CSV (the reject list download). */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
	const esc = (v: string | number | null | undefined) => {
		const s = v == null ? '' : String(v);
		return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const lines = [headers.map(esc).join(',')];
	for (const r of rows) lines.push(r.map(esc).join(','));
	return lines.join('\r\n') + '\r\n';
}
