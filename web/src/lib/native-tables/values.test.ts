import { describe, it, expect } from 'vitest';
import { inferColumnType, coerceValue, COLUMN_TYPES } from './values';

describe('native tables: inferColumnType', () => {
  it('defaults to text when every sample is empty', () => {
    expect(inferColumnType(['', '  ', ''])).toBe('text');
  });
  it('detects numbers including currency/thousands punctuation', () => {
    expect(inferColumnType(['1', '2.5', '$1,200'])).toBe('number');
  });
  it('detects booleans from yes/no/x style values', () => {
    expect(inferColumnType(['yes', 'no', 'Y', 'x'])).toBe('boolean');
  });
  it('detects dates', () => {
    expect(inferColumnType(['2026-09-19', '2026-01-01T10:00:00Z'])).toBe('datetime');
  });
  it('falls back to text for mixed content', () => {
    expect(inferColumnType(['1', 'hello', '2026-01-01'])).toBe('text');
  });
});

describe('native tables: coerceValue', () => {
  it('returns null for blank input regardless of type', () => {
    for (const t of COLUMN_TYPES) expect(coerceValue(t, '   ')).toBeNull();
  });
  it('strips currency and percent punctuation from numeric types', () => {
    expect(coerceValue('currency', '$1,234.50')).toBe(1234.5);
    expect(coerceValue('percent', '12%')).toBe(12);
    expect(coerceValue('number', 'abc')).toBeNull();
  });
  it('maps boolean words', () => {
    expect(coerceValue('boolean', 'Yes')).toBe(true);
    expect(coerceValue('boolean', 'no')).toBe(false);
  });
  it('normalises datetime to ISO', () => {
    expect(coerceValue('datetime', '2026-09-19T00:00:00Z')).toBe('2026-09-19T00:00:00.000Z');
    expect(coerceValue('datetime', 'not a date')).toBeNull();
  });
  it('splits select on commas', () => {
    expect(coerceValue('select', 'Open, Done ,')).toEqual(['Open', 'Done']);
  });
  it('validates email and prefixes url', () => {
    expect(coerceValue('email', 'nope')).toBeNull();
    expect(coerceValue('email', 'a@b.co')).toBe('a@b.co');
    expect(coerceValue('url', 'example.com')).toBe('https://example.com');
    expect(coerceValue('url', 'HTTP://x.y')).toBe('HTTP://x.y');
  });
  it('keeps only dialable characters in phones', () => {
    expect(coerceValue('phone', '+1 (555) 123-4567 ext')).toBe('+1(555)123-4567');
  });
});
