// Header auto matching and row shaping. Pure, unit tested.

import { coerce } from './coerce';
import type { ColumnSpec, Mapping } from './types';

export function normalizeHeader(h: string): string {
	return h
		.toLowerCase()
		.replace(/[_\-./]+/g, ' ')
		.replace(/[^a-z0-9 ]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Proposes a mapping from file headers to target columns. Exact key or label
 * match first, then aliases, then a loose match where one contains the other.
 * A header is used at most once and a column is mapped at most once.
 */
export function autoMatch(headers: string[], columns: ColumnSpec[]): Mapping {
	const mapping: Mapping = {};
	const usedHeaders = new Set<string>();
	const norm = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }));

	const take = (col: ColumnSpec, pred: (n: string) => boolean): boolean => {
		for (const h of norm) {
			if (usedHeaders.has(h.raw) || !h.n) continue;
			if (pred(h.n)) {
				mapping[col.key] = h.raw;
				usedHeaders.add(h.raw);
				return true;
			}
		}
		return false;
	};

	// Pass 1: exact key or label.
	for (const col of columns) {
		const candidates = [normalizeHeader(col.key), normalizeHeader(col.label)];
		take(col, (n) => candidates.includes(n));
	}
	// Pass 2: aliases.
	for (const col of columns) {
		if (mapping[col.key]) continue;
		const aliases = (col.aliases ?? []).map(normalizeHeader);
		if (aliases.length) take(col, (n) => aliases.includes(n));
	}
	// Pass 3: loose containment, only for headers of three or more characters.
	for (const col of columns) {
		if (mapping[col.key]) continue;
		const candidates = [normalizeHeader(col.key), normalizeHeader(col.label), ...(col.aliases ?? []).map(normalizeHeader)].filter(
			(c) => c.length >= 3,
		);
		take(col, (n) => n.length >= 3 && candidates.some((c) => n.includes(c) || c.includes(n)));
	}
	return mapping;
}

export interface ShapedRow {
	/** Coerced values by column key. Unmapped columns are absent. */
	values: Record<string, unknown>;
	errors: string[];
}

/**
 * Applies a mapping to one file row: reads each mapped header, coerces by
 * the column type, flags required columns that end up empty.
 */
export function shapeRow(row: string[], headers: string[], mapping: Mapping, columns: ColumnSpec[]): ShapedRow {
	const values: Record<string, unknown> = {};
	const errors: string[] = [];
	const index = new Map(headers.map((h, i) => [h, i]));
	for (const col of columns) {
		const header = mapping[col.key];
		if (!header) {
			if (col.required) errors.push(`${col.label} is required and not mapped`);
			continue;
		}
		const i = index.get(header);
		const raw = i == null ? '' : row[i] ?? '';
		const r = coerce(raw, col.type, col);
		if (!r.ok) {
			errors.push(`${col.label}: ${r.error}`);
			continue;
		}
		if (r.value == null) {
			if (col.required) errors.push(`${col.label} is required`);
			continue;
		}
		values[col.key] = r.value;
	}
	return { values, errors };
}

export function missingRequired(mapping: Mapping, columns: ColumnSpec[]): ColumnSpec[] {
	return columns.filter((c) => c.required && !mapping[c.key]);
}

/**
 * Picks the natural key for a shaped row: the first group whose columns are
 * all present. Returns the group and a stable string key.
 */
export function naturalKeyFor(values: Record<string, unknown>, groups: string[][]): { group: string[]; key: string } | null {
	for (const group of groups) {
		if (group.every((c) => values[c] != null && values[c] !== '')) {
			const key = group.map((c) => `${c}=${String(values[c]).toLowerCase()}`).join('|');
			return { group, key };
		}
	}
	return null;
}

/** Deep equality for the jsonb snapshots (arrays compared as sets of strings). */
export function snapshotEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return (a ?? null) === (b ?? null);
	if (Array.isArray(a) && Array.isArray(b)) {
		const sa = [...a].map(String).sort();
		const sb = [...b].map(String).sort();
		return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const ka = Object.keys(a as object);
		const kb = Object.keys(b as object);
		const keys = new Set([...ka, ...kb]);
		for (const k of keys) {
			if (!snapshotEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
		}
		return true;
	}
	if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
	if (typeof a === 'string' && typeof b === 'number') return a === String(b);
	return false;
}

/** Column keys whose value differs between two snapshots. */
export function driftedKeys(expected: Record<string, unknown> | null, actual: Record<string, unknown> | null): string[] {
	if (!expected) return actual ? Object.keys(actual) : [];
	if (!actual) return Object.keys(expected);
	const out: string[] = [];
	for (const k of Object.keys(expected)) {
		if (!snapshotEqual(expected[k], actual[k])) out.push(k);
	}
	return out;
}
