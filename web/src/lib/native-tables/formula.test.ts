import { describe, it, expect } from 'vitest';
import { parseFormula, evaluateFormula, formulaRefs, cellToFormulaValue } from './formula';

const row: Record<string, unknown> = { Amount: 120.456, Qty: 3, Name: 'Widget', Done: true, When: '2026-09-01T00:00:00Z', Tags: ['a', 'b'], Owner: { id: 'u1', name: 'Ada' } };
const lookup = (n: string) => cellToFormulaValue(row[n]);
const now = new Date('2026-09-19T12:00:00Z');
const run = (src: string) => evaluateFormula(parseFormula(src), lookup, now);

describe('formula', () => {
  it('arithmetic, precedence, unary minus', () => {
    expect(run('{Amount} * {Qty}')).toBeCloseTo(361.368);
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('-{Qty} + 10')).toBe(7);
    expect(run('10 / 0')).toBeNull();
  });

  it('strings, concat, comparisons', () => {
    expect(run('{Name} & " x" & {Qty}')).toBe('Widget x3');
    expect(run('CONCAT(UPPER({Name}), "!")')).toBe('WIDGET!');
    expect(run('{Qty} >= 3')).toBe(true);
    expect(run('{Name} = "Widget"')).toBe(true);
    expect(run('{Name} <> "Widget"')).toBe(false);
    expect(run('LEN(TRIM("  ab "))')).toBe(2);
  });

  it('IF / AND / OR / NOT / blanks', () => {
    expect(run('IF({Done}, "yes", "no")')).toBe('yes');
    expect(run('IF(AND({Done}, {Qty} > 5), 1, 0)')).toBe(0);
    expect(run('OR(FALSE, {Qty} > 1)')).toBe(true);
    expect(run('NOT({Done})')).toBe(false);
    expect(run('ISBLANK({Missing})')).toBe(true);
    expect(run('IF(ISBLANK({Missing}), BLANK(), 1)')).toBeNull();
  });

  it('numeric functions', () => {
    expect(run('ROUND({Amount}, 2)')).toBe(120.46);
    expect(run('ROUND({Amount})')).toBe(120);
    expect(run('ABS(-5)')).toBe(5);
    expect(run('MIN(3, 1, 2)')).toBe(1);
    expect(run('MAX({Qty}, 10)')).toBe(10);
    expect(run('SUM(1, 2, {Qty})')).toBe(6);
  });

  it('dates', () => {
    expect(run('TODAY()')).toBe('2026-09-19');
    expect(run('DATEDIFF_DAYS(TODAY(), {When})')).toBe(18);
    expect(run('YEAR({When})')).toBe(2026);
    expect(run('MONTH({When})')).toBe(9);
    expect(run('YEAR({Name})')).toBeNull();
  });

  it('array and object cells reduce to text', () => {
    expect(run('{Tags}')).toBe('a, b');
    expect(run('{Owner}')).toBe('Ada');
  });

  it('refs and parse errors', () => {
    expect(formulaRefs(parseFormula('IF({A} > {B}, {C}, 0)')).sort()).toEqual(['A', 'B', 'C']);
    expect(() => parseFormula('')).toThrow();
    expect(() => parseFormula('FOO(1)')).toThrow(/Unknown function/);
    expect(() => parseFormula('{Open')).toThrow();
    expect(() => parseFormula('1 +')).toThrow();
    expect(() => parseFormula('"abc')).toThrow();
    expect(() => parseFormula('1 2')).toThrow();
  });
});
