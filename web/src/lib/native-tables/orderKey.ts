/**
 * Fractional order keys for native table rows (0096 `order_key text`).
 *
 * Lowercase a-z strings compared lexically. `keyBetween(a, b)` returns a key
 * strictly between a and b writing ONE value, never touching neighbours.
 * `null` on the left means "before everything", `null` on the right means
 * "after everything". Generated keys never end in 'a' (the zero digit), which
 * is the invariant that makes "between" always solvable; the SQL twin
 * `public.nt_key_for_index(integer)` in 0109 is the same algorithm and the
 * two must stay in step.
 */

const A = 97; // 'a'
const RADIX = 26;

export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: "${a}" is not before "${b}"`);
  }
  if (b !== null && (b === '' || b.endsWith('a'))) {
    // Nothing sorts strictly between "" and "a…": the caller must renormalise.
    throw new Error(`keyBetween: upper bound "${b}" ends in the zero digit`);
  }
  let out = '';
  let i = 0;
  let hi: string | null = b;
  for (;;) {
    const ca = a !== null && i < a.length ? a.charCodeAt(i) - A : -1;
    const cb = hi !== null && i < hi.length ? hi.charCodeAt(i) - A : RADIX;
    if (ca === cb) {
      out += String.fromCharCode(A + ca);
      i++;
      continue;
    }
    if (cb - ca > 1) {
      const m = ca + Math.ceil((cb - ca) / 2);
      if (m === 0) {
        // Only 'a' fits here; keep going so we never end on it.
        out += 'a';
        hi = null;
        i++;
        continue;
      }
      out += String.fromCharCode(A + m);
      return out;
    }
    // Adjacent digits: echo the low one, the upper bound stops constraining.
    if (ca === -1) {
      out += 'a';
      i++;
      continue;
    }
    out += String.fromCharCode(A + ca);
    hi = null;
    i++;
  }
}

/**
 * Fixed-width key for position n when a table is renormalised (ties from the
 * 'z' default). Four chars, last digit from 'b'..'z' so no key ends in 'a'.
 * Capacity 26^3 * 25 = 439,400 rows, above the largest Airtable base in
 * AIRTABLE_SUNSET_PLAN.md (41k).
 */
export function keyForIndex(n: number): string {
  if (n < 0 || n >= 26 * 26 * 26 * 25) throw new Error('keyForIndex: out of range');
  const last = n % 25;
  let rest = Math.floor(n / 25);
  let s = String.fromCharCode(A + 1 + last);
  for (let k = 0; k < 3; k++) {
    s = String.fromCharCode(A + (rest % RADIX)) + s;
    rest = Math.floor(rest / RADIX);
  }
  return s;
}
