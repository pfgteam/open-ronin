/**
 * Formula columns (phase 4). A formula column stores its source in
 * `config.expression` and is read-only: the value is computed at
 * serialization time in the server action from the row's other cells, never
 * stored in nt_cells. (NATIVE_TABLES_PLAN.md said "evaluated in SQL via a
 * view"; evaluating at serialization keeps the RPC whitelist closed and lets
 * the same evaluator run in the grid for instant preview. Cost: formula cells
 * cannot be filtered or sorted server-side. Revisit if that bites.)
 *
 * Grammar (Airtable-flavoured, deliberately small):
 *   expr    := or
 *   or      := and ('||' and)*           -- string concat, like Airtable '&'
 *   and     := cmp
 *   cmp     := add (('=' | '!=' | '<' | '<=' | '>' | '>=') add)?
 *   add     := mul (('+' | '-' | '&') mul)*
 *   mul     := unary (('*' | '/') unary)*
 *   unary   := '-' unary | primary
 *   primary := number | string | '{' name '}' | ident '(' args ')' | '(' expr ')'
 * Functions: IF, AND, OR, NOT, CONCAT, UPPER, LOWER, TRIM, LEN, ROUND, ABS,
 * MIN, MAX, SUM, BLANK, ISBLANK, TODAY, NOW, DATEDIFF_DAYS, YEAR, MONTH.
 * Pure module, unit-tested in formula.test.ts.
 */

export type FormulaValue = string | number | boolean | null;

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

const OPS = ['<=', '>=', '!=', '<>', '=', '<', '>', '+', '-', '*', '/', '&', '(', ')', ','];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new Error('Unclosed { in formula');
      out.push({ t: 'ref', v: src.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new Error('Unclosed string in formula');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i));
      if (!m) throw new Error('Bad number in formula');
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0].toUpperCase() });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected "${ch}" in formula`);
    out.push({ t: 'op', v: op === '<>' ? '!=' : op });
    i += op.length;
  }
  out.push({ t: 'eof' });
  return out;
}

export type Node =
  | { k: 'lit'; v: FormulaValue }
  | { k: 'ref'; name: string }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node }
  | { k: 'call'; fn: string; args: Node[] };

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok { return this.toks[this.i]; }
  private next(): Tok { return this.toks[this.i++]; }
  private isOp(v: string): boolean { const t = this.peek(); return t.t === 'op' && t.v === v; }
  private expect(v: string) { if (!this.isOp(v)) throw new Error(`Expected "${v}" in formula`); this.i++; }

  parse(): Node {
    const n = this.cmp();
    if (this.peek().t !== 'eof') throw new Error('Unexpected trailing input in formula');
    return n;
  }
  private cmp(): Node {
    const l = this.add();
    for (const op of ['<=', '>=', '!=', '=', '<', '>']) {
      if (this.isOp(op)) { this.i++; return { k: 'bin', op, l, r: this.add() }; }
    }
    return l;
  }
  private add(): Node {
    let l = this.mul();
    while (this.isOp('+') || this.isOp('-') || this.isOp('&')) {
      const op = (this.next() as { v: string }).v;
      l = { k: 'bin', op, l, r: this.mul() };
    }
    return l;
  }
  private mul(): Node {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as { v: string }).v;
      l = { k: 'bin', op, l, r: this.unary() };
    }
    return l;
  }
  private unary(): Node {
    if (this.isOp('-')) { this.i++; return { k: 'neg', e: this.unary() }; }
    return this.primary();
  }
  private primary(): Node {
    const t = this.next();
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'ref') return { k: 'ref', name: t.v };
    if (t.t === 'id') {
      if (t.v === 'TRUE') return { k: 'lit', v: true };
      if (t.v === 'FALSE') return { k: 'lit', v: false };
      if (!FUNCS.has(t.v)) throw new Error(`Unknown function ${t.v}`);
      this.expect('(');
      const args: Node[] = [];
      if (!this.isOp(')')) {
        args.push(this.cmp());
        while (this.isOp(',')) { this.i++; args.push(this.cmp()); }
      }
      this.expect(')');
      return { k: 'call', fn: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.cmp();
      this.expect(')');
      return e;
    }
    throw new Error('Unexpected token in formula');
  }
}

const FUNCS = new Set(['IF', 'AND', 'OR', 'NOT', 'CONCAT', 'UPPER', 'LOWER', 'TRIM', 'LEN', 'ROUND', 'ABS', 'MIN', 'MAX', 'SUM', 'BLANK', 'ISBLANK', 'TODAY', 'NOW', 'DATEDIFF_DAYS', 'YEAR', 'MONTH']);

/** Parse once per column; throws with a readable message on bad input. */
export function parseFormula(expression: string): Node {
  if (expression.trim() === '') throw new Error('Formula is empty');
  if (expression.length > 2000) throw new Error('Formula too long');
  return new Parser(tokenize(expression)).parse();
}

/** Column names referenced by the formula ({Name} tokens). */
export function formulaRefs(node: Node): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'ref') out.add(n.name);
    else if (n.k === 'bin') { walk(n.l); walk(n.r); }
    else if (n.k === 'neg') walk(n.e);
    else if (n.k === 'call') n.args.forEach(walk);
  };
  walk(node);
  return [...out];
}

function num(v: FormulaValue): number {
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function str(v: FormulaValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
function truthy(v: FormulaValue): boolean {
  if (v === null || v === '' || v === 0 || v === false) return false;
  return true;
}
function toDate(v: FormulaValue): Date | null {
  if (v === null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Evaluate against a row. `lookup(name)` returns the cell value of the named
 * column (arrays are joined, objects reduced to their `name`). Never throws
 * on data; returns null for anything undefined.
 */
export function evaluateFormula(node: Node, lookup: (name: string) => FormulaValue, now: Date = new Date()): FormulaValue {
  const ev = (n: Node): FormulaValue => {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref': return lookup(n.name);
      case 'neg': return -num(ev(n.e));
      case 'bin': {
        const l = ev(n.l); const r = ev(n.r);
        switch (n.op) {
          case '+': return typeof l === 'string' || typeof r === 'string' ? str(l) + str(r) : num(l) + num(r);
          case '&': return str(l) + str(r);
          case '-': return num(l) - num(r);
          case '*': return num(l) * num(r);
          case '/': { const d = num(r); return d === 0 ? null : num(l) / d; }
          case '=': return typeof l === 'number' || typeof r === 'number' ? num(l) === num(r) : str(l) === str(r);
          case '!=': return typeof l === 'number' || typeof r === 'number' ? num(l) !== num(r) : str(l) !== str(r);
          case '<': return num(l) < num(r);
          case '<=': return num(l) <= num(r);
          case '>': return num(l) > num(r);
          case '>=': return num(l) >= num(r);
        }
        return null;
      }
      case 'call': {
        const a = n.args;
        switch (n.fn) {
          case 'IF': return truthy(ev(a[0])) ? (a[1] ? ev(a[1]) : null) : (a[2] ? ev(a[2]) : null);
          case 'AND': return a.every((x) => truthy(ev(x)));
          case 'OR': return a.some((x) => truthy(ev(x)));
          case 'NOT': return !truthy(ev(a[0]));
          case 'CONCAT': return a.map((x) => str(ev(x))).join('');
          case 'UPPER': return str(ev(a[0])).toUpperCase();
          case 'LOWER': return str(ev(a[0])).toLowerCase();
          case 'TRIM': return str(ev(a[0])).trim();
          case 'LEN': return str(ev(a[0])).length;
          case 'ROUND': { const p = a[1] ? num(ev(a[1])) : 0; const f = 10 ** p; return Math.round(num(ev(a[0])) * f) / f; }
          case 'ABS': return Math.abs(num(ev(a[0])));
          case 'MIN': return a.length ? Math.min(...a.map((x) => num(ev(x)))) : null;
          case 'MAX': return a.length ? Math.max(...a.map((x) => num(ev(x)))) : null;
          case 'SUM': return a.reduce((s, x) => s + num(ev(x)), 0);
          case 'BLANK': return null;
          case 'ISBLANK': { const v = ev(a[0]); return v === null || v === ''; }
          case 'TODAY': return now.toISOString().slice(0, 10);
          case 'NOW': return now.toISOString();
          case 'DATEDIFF_DAYS': { const d1 = toDate(ev(a[0])); const d2 = toDate(ev(a[1])); return d1 && d2 ? Math.round((d1.getTime() - d2.getTime()) / 86400000) : null; }
          case 'YEAR': { const d = toDate(ev(a[0])); return d ? d.getUTCFullYear() : null; }
          case 'MONTH': { const d = toDate(ev(a[0])); return d ? d.getUTCMonth() + 1 : null; }
        }
        return null;
      }
    }
  };
  try {
    return ev(node);
  } catch {
    return null;
  }
}

/** Reduce a stored cell value to a scalar for formula input. */
export function cellToFormulaValue(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : String(x))).join(', ');
  if (typeof v === 'object' && 'name' in v) return String((v as { name: unknown }).name ?? '');
  return String(v);
}
