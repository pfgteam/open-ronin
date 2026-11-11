/**
 * Pure value helpers for native tables (0096). No server imports so both the
 * server actions and any client component can use them, and vitest can cover
 * them without a Supabase client.
 *
 * Column type lives on the column, never the cell (Beacon dp_column lesson).
 * These helpers take the column type and decide how a raw string becomes the
 * JSON stored in nt_cells.value.
 */

export const COLUMN_TYPES = [
  'text', 'long_text', 'number', 'currency', 'percent', 'rating', 'duration',
  'boolean', 'datetime', 'select', 'url', 'email', 'phone', 'user', 'brand',
  'link', 'formula',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export type CellValue = string | number | boolean | null | Record<string, unknown> | string[];

const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 'x', 'checked']);
const TRUE_WORDS = new Set(['true', 'yes', 'y', 'x', 'checked']);

/** Guess a column type from sample values (CSV import). Order matters: number before boolean before datetime. */
export function inferColumnType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return 'text';
  if (nonEmpty.every((v) => !isNaN(Number(v.replace(/[$,]/g, ''))))) return 'number';
  if (nonEmpty.every((v) => BOOL_WORDS.has(v.toLowerCase().trim()))) return 'boolean';
  if (nonEmpty.every((v) => !isNaN(new Date(v).getTime()))) return 'datetime';
  return 'text';
}

/** Coerce a raw string into the typed cell value; null means "skip this cell". */
export function coerceValue(type: ColumnType, raw: string): CellValue | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating':
    case 'duration': {
      const n = Number(trimmed.replace(/[$,%]/g, ''));
      return isNaN(n) ? null : n;
    }
    case 'boolean':
      return TRUE_WORDS.has(trimmed.toLowerCase());
    case 'datetime': {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'select':
      return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    case 'email':
      return trimmed.includes('@') ? trimmed : null;
    case 'url':
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    case 'phone':
      return trimmed.replace(/[^\d+()-]/g, '');
    default:
      return trimmed;
  }
}
