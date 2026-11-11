/**
 * Filter + sort vocabulary for native tables (Beacon dp_query pattern): a
 * closed whitelist of operators per column type. The client builds a
 * `GridQuery`, the server action validates it with `validateQuery()` against
 * the table's real columns, and `public.nt_query_rows()` (0109) applies it in
 * SQL. The SQL function re-checks the same whitelist, so a forged call from
 * PostgREST gets the same refusal as a bad UI request.
 *
 * Pure module: no server imports, unit-tested in query.test.ts.
 */
import type { ColumnType } from './values';

export const FILTER_OPS = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with',
  'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty',
  'is_true', 'is_false', 'has_any', 'before', 'after', 'on',
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

const TEXT_OPS: FilterOp[] = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty'];
const NUMBER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
const BOOL_OPS: FilterOp[] = ['is_true', 'is_false'];
const DATE_OPS: FilterOp[] = ['on', 'before', 'after', 'is_empty', 'is_not_empty'];
const ARRAY_OPS: FilterOp[] = ['has_any', 'is_empty', 'is_not_empty'];
const REF_OPS: FilterOp[] = ['eq', 'neq', 'is_empty', 'is_not_empty'];

/** Operators each column type accepts. Mirrors nt_query_rows() in 0109. */
export const OPS_BY_TYPE: Record<ColumnType, readonly FilterOp[]> = {
  text: TEXT_OPS,
  long_text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  formula: TEXT_OPS,
  number: NUMBER_OPS,
  currency: NUMBER_OPS,
  percent: NUMBER_OPS,
  rating: NUMBER_OPS,
  duration: NUMBER_OPS,
  boolean: BOOL_OPS,
  datetime: DATE_OPS,
  select: ARRAY_OPS,
  link: ARRAY_OPS,
  user: REF_OPS,
  brand: REF_OPS,
};

/** Operators that take no value. */
export const UNARY_OPS: ReadonlySet<FilterOp> = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false']);

export const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is', neq: 'is not', contains: 'contains', not_contains: 'does not contain',
  starts_with: 'starts with', gt: '>', gte: '≥', lt: '<', lte: '≤',
  is_empty: 'is empty', is_not_empty: 'is not empty', is_true: 'is checked',
  is_false: 'is unchecked', has_any: 'has any of', before: 'is before',
  after: 'is after', on: 'is on',
};

export interface FilterClause {
  column_id: string;
  op: FilterOp;
  /** Text for text/number/date ops, string[] for has_any, omitted for unary ops. */
  value?: string | string[];
}

export interface SortClause {
  column_id: string;
  dir: 'asc' | 'desc';
}

export interface GridQuery {
  filters: FilterClause[];
  /** AND (default) or OR across filters. */
  conjunction: 'and' | 'or';
  sorts: SortClause[];
  /** Free-text search across every visible text-like column (ILIKE). */
  search: string;
}

export const EMPTY_QUERY: GridQuery = { filters: [], conjunction: 'and', sorts: [], search: '' };

export function isEmptyQuery(q: GridQuery): boolean {
  return q.filters.length === 0 && q.sorts.length === 0 && q.search.trim() === '';
}

export interface ColumnLike {
  id: string;
  type: ColumnType;
}

/**
 * Validate a query against the table's columns. Returns the cleaned query or
 * an error string. Unknown columns, operators outside the type's whitelist,
 * missing values on binary ops and non-numeric values on numeric ops are all
 * refused here (and again in SQL).
 */
export function validateQuery(q: GridQuery, columns: ColumnLike[]): { ok: true; query: GridQuery } | { ok: false; error: string } {
  const byId = new Map(columns.map((c) => [c.id, c]));
  if (q.filters.length > 20) return { ok: false, error: 'At most 20 filters.' };
  if (q.sorts.length > 5) return { ok: false, error: 'At most 5 sorts.' };
  const filters: FilterClause[] = [];
  for (const f of q.filters) {
    const col = byId.get(f.column_id);
    if (!col) return { ok: false, error: 'Filter references an unknown column.' };
    if (!(FILTER_OPS as readonly string[]).includes(f.op)) return { ok: false, error: `Unknown operator "${f.op}".` };
    if (!OPS_BY_TYPE[col.type].includes(f.op)) return { ok: false, error: `Operator "${OP_LABEL[f.op]}" does not apply to a ${col.type} column.` };
    if (UNARY_OPS.has(f.op)) {
      filters.push({ column_id: f.column_id, op: f.op });
      continue;
    }
    if (f.op === 'has_any') {
      const arr = Array.isArray(f.value) ? f.value.map(String).filter(Boolean) : typeof f.value === 'string' ? f.value.split(',').map((s) => s.trim()).filter(Boolean) : [];
      if (arr.length === 0) return { ok: false, error: 'Choose at least one option.' };
      filters.push({ column_id: f.column_id, op: f.op, value: arr });
      continue;
    }
    const v = typeof f.value === 'string' ? f.value.trim() : Array.isArray(f.value) ? f.value.join(',') : '';
    if (v === '') return { ok: false, error: 'Filter needs a value.' };
    if (OPS_BY_TYPE[col.type] === NUMBER_OPS && isNaN(Number(v))) return { ok: false, error: 'Filter value must be a number.' };
    if (col.type === 'datetime' && isNaN(new Date(v).getTime())) return { ok: false, error: 'Filter value must be a date.' };
    if (v.length > 500) return { ok: false, error: 'Filter value too long.' };
    filters.push({ column_id: f.column_id, op: f.op, value: v });
  }
  const sorts: SortClause[] = [];
  for (const s of q.sorts) {
    if (!byId.has(s.column_id)) return { ok: false, error: 'Sort references an unknown column.' };
    if (s.dir !== 'asc' && s.dir !== 'desc') return { ok: false, error: 'Sort direction must be asc or desc.' };
    sorts.push({ column_id: s.column_id, dir: s.dir });
  }
  const search = q.search.trim().slice(0, 200);
  return { ok: true, query: { filters, conjunction: q.conjunction === 'or' ? 'or' : 'and', sorts, search } };
}

/** Canonical JSON shape sent to nt_query_rows(). Kept separate so the wire format can change without touching the UI type. */
export function toRpcPayload(q: GridQuery): Record<string, unknown> {
  return {
    filters: q.filters.map((f) => ({ column_id: f.column_id, op: f.op, value: f.value ?? null })),
    conjunction: q.conjunction,
    sorts: q.sorts,
    search: q.search,
  };
}
