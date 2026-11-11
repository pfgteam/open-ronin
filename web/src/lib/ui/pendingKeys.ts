// Immutable set helpers for per-button pending state: overlapping actions each
// keep their own spinner (review 2026-10-20 — a single key let the first
// button be clicked again while its request was still running).

export function withKey(s: ReadonlySet<string>, key: string): Set<string> {
	const next = new Set(s);
	next.add(key);
	return next;
}

export function withoutKey(s: ReadonlySet<string>, key: string): Set<string> {
	const next = new Set(s);
	next.delete(key);
	return next;
}
