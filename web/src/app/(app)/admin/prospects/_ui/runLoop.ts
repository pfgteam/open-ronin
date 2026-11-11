// Client-driven batch loops (Rescore, Backfill, scraper backlog). One run at a
// time — the button only disabled itself after the first batch came back, so a
// second click in those seconds started a parallel loop — and the outcome says
// whether it ended on an error, so no success toast follows a failure
// (review 2026-10-19).

export type LoopStep = { ok: false; error: string } | { ok: true; done: boolean };

export async function runLoop(step: (i: number) => Promise<LoopStep>, max: number): Promise<{ error: string | null; steps: number; capped: boolean }> {
	for (let i = 0; i < max; i++) {
		let r: LoopStep;
		try {
			r = await step(i);
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e), steps: i, capped: false };
		}
		if (!r.ok) return { error: r.error, steps: i + 1, capped: false };
		if (r.done) return { error: null, steps: i + 1, capped: false };
	}
	return { error: null, steps: max, capped: true };
}

/** Synchronous single-flight flag: React state lands a render late, this does not. */
export function createRunGuard() {
	let busy = false;
	return {
		tryStart(): boolean {
			if (busy) return false;
			busy = true;
			return true;
		},
		finish(): void {
			busy = false;
		},
	};
}
