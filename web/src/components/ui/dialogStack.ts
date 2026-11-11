// Open dialogs, innermost last. A confirmation opened from inside an edit
// dialog must be the only one that reacts to ESC — otherwise ESC closed both
// and a shown-once token could be lost (review 2026-10-19).

const stack: number[] = [];
let seq = 0;

export function pushDialog(): number {
	const id = ++seq;
	stack.push(id);
	return id;
}

export function popDialog(id: number): void {
	const i = stack.lastIndexOf(id);
	if (i >= 0) stack.splice(i, 1);
}

export function isTopDialog(id: number): boolean {
	return stack[stack.length - 1] === id;
}

/**
 * Tab inside an open dialog wraps around its own controls instead of walking
 * out to the page behind the backdrop. Returns the index to focus, or null to
 * let the browser move focus normally.
 */
export function trapTab(count: number, current: number, shift: boolean): number | null {
	if (count === 0) return null;
	if (current < 0) return shift ? count - 1 : 0;
	if (shift && current === 0) return count - 1;
	if (!shift && current === count - 1) return 0;
	return null;
}
