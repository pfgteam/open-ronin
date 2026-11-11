// Line diff for the change-review screen. Plain LCS over lines; wiki pages
// are a few hundred lines at most, so O(n*m) is fine and no dependency is
// worth carrying for this. Pure; unit tested.

export type DiffOp = { kind: 'same' | 'add' | 'del'; text: string };

export function diffLines(before: string, after: string): DiffOp[] {
	const a = before.split('\n');
	const b = after.split('\n');
	const n = a.length;
	const m = b.length;
	// lcs[i][j] = LCS length of a[i..] and b[j..]
	const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const out: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ kind: 'same', text: a[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			out.push({ kind: 'del', text: a[i] });
			i++;
		} else {
			out.push({ kind: 'add', text: b[j] });
			j++;
		}
	}
	while (i < n) out.push({ kind: 'del', text: a[i++] });
	while (j < m) out.push({ kind: 'add', text: b[j++] });
	return out;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const op of ops) {
		if (op.kind === 'add') added++;
		else if (op.kind === 'del') removed++;
	}
	return { added, removed };
}
