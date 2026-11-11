// XLSX reader, server side only. exceljs is the one dependency Data Imports
// adds: it is maintained, typed, streams large workbooks, and has no known
// prototype pollution advisories, which the SheetJS community build carried
// unpatched on npm at the time of writing.

import ExcelJS from 'exceljs';
import { MAX_ROWS, type ParsedFile } from './parse';

function cellToString(value: ExcelJS.CellValue): string {
	if (value == null) return '';
	if (value instanceof Date) {
		return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
	}
	if (typeof value === 'object') {
		if ('richText' in value) return value.richText.map((t) => t.text).join('');
		if ('text' in value && value.text != null) return typeof value.text === 'string' ? value.text : cellToString(value.text as ExcelJS.CellValue);
		if ('result' in value) return cellToString(value.result as ExcelJS.CellValue);
		if ('error' in value) return '';
		return String(value);
	}
	return String(value);
}

export async function parseXlsx(buffer: ArrayBuffer, opts: { sheet?: string; maxRows?: number } = {}): Promise<ParsedFile> {
	const maxRows = opts.maxRows ?? MAX_ROWS;
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(buffer);
	const sheets = workbook.worksheets.map((w) => w.name);
	const sheet = (opts.sheet && workbook.getWorksheet(opts.sheet)) || workbook.worksheets[0];
	if (!sheet) return { headers: [], rows: [], sheets };

	const raw: string[][] = [];
	sheet.eachRow({ includeEmpty: false }, (row) => {
		if (raw.length > maxRows) return;
		const values = row.values as ExcelJS.CellValue[];
		// exceljs row.values is 1 indexed; index 0 is always empty.
		const cells: string[] = [];
		for (let i = 1; i < values.length; i++) cells.push(cellToString(values[i]).trim());
		raw.push(cells);
	});

	const nonEmpty = raw.filter((r) => r.some((v) => v !== ''));
	if (nonEmpty.length === 0) return { headers: [], rows: [], sheets };
	const headers = nonEmpty[0].map((h) => h.trim());
	const width = headers.length;
	const rows = nonEmpty.slice(1, maxRows + 1).map((r) => {
		const out = r.slice(0, width);
		while (out.length < width) out.push('');
		return out;
	});
	return { headers, rows, sheets };
}
