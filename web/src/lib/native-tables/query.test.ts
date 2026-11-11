import { describe, it, expect } from 'vitest';
import { keyBetween, keyForIndex } from './orderKey';
import { validateQuery, EMPTY_QUERY, isEmptyQuery, toRpcPayload, OPS_BY_TYPE, FILTER_OPS } from './query';
import { COLUMN_TYPES } from './values';

describe('keyBetween', () => {
  it('produces a key strictly between its bounds', () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null], [null, 'b'], ['b', null], ['b', 'c'], ['b', 'bb'], ['aaab', 'aaac'], ['z', null], ['zz', null], [null, 'aaab'], ['b', 'bab'],
    ];
    for (const [a, b] of cases) {
      const k = keyBetween(a, b);
      if (a !== null) expect(k > a, `${k} > ${a}`).toBe(true);
      if (b !== null) expect(k < b, `${k} < ${b}`).toBe(true);
      expect(k.endsWith('a')).toBe(false);
      expect(/^[a-z]+$/.test(k)).toBe(true);
    }
  });

  it('stays sortable across 200 consecutive inserts at the front and between', () => {
    let prev: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(null, prev);
      keys.unshift(k);
      prev = k;
    }
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
    let lo = keys[0];
    const hi = keys[1];
    for (let i = 0; i < 100; i++) {
      const k = keyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      lo = k;
    }
  });

  it('refuses inverted bounds and zero-digit upper bounds', () => {
    expect(() => keyBetween('c', 'b')).toThrow();
    expect(() => keyBetween('b', 'b')).toThrow();
    expect(() => keyBetween(null, 'ba')).toThrow();
  });
});

describe('keyForIndex', () => {
  it('matches the SQL twin and never ends in a', () => {
    expect(keyForIndex(0)).toBe('aaab');
    expect(keyForIndex(1)).toBe('aaac');
    expect(keyForIndex(25)).toBe('aabb');
    expect(keyForIndex(24)).toBe('aaaz');
    const ks = Array.from({ length: 2000 }, (_, i) => keyForIndex(i));
    expect([...ks].sort()).toEqual(ks);
    expect(ks.every((k) => !k.endsWith('a'))).toBe(true);
    expect(keyBetween(keyForIndex(0), keyForIndex(1))).toMatch(/^aaab[b-z]/);
  });
});

describe('validateQuery', () => {
  const cols = [
    { id: 'c-text', type: 'text' as const },
    { id: 'c-num', type: 'number' as const },
    { id: 'c-bool', type: 'boolean' as const },
    { id: 'c-sel', type: 'select' as const },
    { id: 'c-date', type: 'datetime' as const },
  ];

  it('covers every column type in the whitelist and only known ops', () => {
    for (const t of COLUMN_TYPES) {
      expect(OPS_BY_TYPE[t].length).toBeGreaterThan(0);
      for (const op of OPS_BY_TYPE[t]) expect(FILTER_OPS).toContain(op);
    }
  });

  it('accepts a well-formed query and trims values', () => {
    const r = validateQuery({
      filters: [
        { column_id: 'c-text', op: 'contains', value: '  foo ' },
        { column_id: 'c-num', op: 'gt', value: '10' },
        { column_id: 'c-bool', op: 'is_true', value: 'ignored' },
        { column_id: 'c-sel', op: 'has_any', value: 'a, b,,' },
      ],
      conjunction: 'or',
      sorts: [{ column_id: 'c-num', dir: 'desc' }],
      search: '  bar ',
    }, cols);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.filters[0]).toEqual({ column_id: 'c-text', op: 'contains', value: 'foo' });
    expect(r.query.filters[2]).toEqual({ column_id: 'c-bool', op: 'is_true' });
    expect(r.query.filters[3]).toEqual({ column_id: 'c-sel', op: 'has_any', value: ['a', 'b'] });
    expect(r.query.search).toBe('bar');
    expect(r.query.conjunction).toBe('or');
  });

  it('refuses ops outside the type whitelist, unknown columns, and bad values', () => {
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'c-text', op: 'gt', value: '1' }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'nope', op: 'eq', value: '1' }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'c-num', op: 'gt', value: 'abc' }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'c-date', op: 'after', value: 'not a date' }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'c-text', op: 'eq' }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'c-sel', op: 'has_any', value: [] }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, sorts: [{ column_id: 'nope', dir: 'asc' }] }, cols).ok).toBe(false);
    expect(validateQuery({ ...EMPTY_QUERY, filters: [{ column_id: 'c-text', op: 'drop' as never, value: 'x' }] }, cols).ok).toBe(false);
  });

  it('isEmptyQuery and toRpcPayload', () => {
    expect(isEmptyQuery(EMPTY_QUERY)).toBe(true);
    expect(isEmptyQuery({ ...EMPTY_QUERY, search: 'x' })).toBe(false);
    const p = toRpcPayload({ ...EMPTY_QUERY, filters: [{ column_id: 'c-bool', op: 'is_true' }] });
    expect(p).toEqual({ filters: [{ column_id: 'c-bool', op: 'is_true', value: null }], conjunction: 'and', sorts: [], search: '' });
  });
});
