import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A source-order test, deliberately.
//
// dispatch() talks to both Postgres and Apify, so exercising it would mean
// mocking both — and a test of two mocks proves nothing about whether we get
// billed twice. What it CAN prove is the invariant that stops the double
// billing: the row is claimed BEFORE Apify is asked to start a run.
//
// The bug this locks down: dispatch used to call startRun() first and claim
// afterwards, with the claim's status guard described in a comment as the
// reason we could not pay twice. It was not. Two overlapping ticks — the
// Vercel cron and a "Run now" click, or two people clicking at once — both
// reached the start call before either claimed, so Apify started two billed
// runs and the loser's was orphaned: still executing, still costing, with no
// run id stored for anyone to abort it.
//
// If someone reorders these two calls, this test fails and says why.

const source = readFileSync(join(__dirname, 'advance.ts'), 'utf8');

/**
 * dispatch()'s body with comments stripped.
 *
 * Stripping matters: the function's own header explains the bug by naming the
 * start call, and a naive scan would find that mention first and report the
 * calls as mis-ordered. The test must read code, not prose.
 */
function dispatchBody(): string {
	const start = source.indexOf('async function dispatch(');
	expect(start, 'dispatch() not found — was it renamed?').toBeGreaterThan(-1);
	// The next top-level `async function` after it bounds the body.
	const next = source.indexOf('\nasync function ', start + 1);
	const body = source.slice(start, next === -1 ? undefined : next);
	const withoutBlockComments = body.split(/\/\*[\s\S]*?\*\//).join('');
	return withoutBlockComments
		.split('\n')
		.map((line) => {
			const at = line.indexOf('//');
			return at === -1 ? line : line.slice(0, at);
		})
		.join('\n');
}

describe('dispatch() claims before it spends', () => {
	it('updates the row to running before calling startRun', () => {
		const body = dispatchBody();
		const claimAt = body.indexOf("status: 'running'");
		const startAt = body.indexOf('startRun(');

		expect(claimAt, "no claim to 'running' found in dispatch()").toBeGreaterThan(-1);
		expect(startAt, 'no startRun() call found in dispatch()').toBeGreaterThan(-1);
		expect(
			claimAt,
			'dispatch() calls startRun() before claiming the row. Two overlapping ticks ' +
				'will each start a BILLED Apify run, and the loser is orphaned with no ' +
				'apify_run_id to abort it. Claim first, then start.',
		).toBeLessThan(startAt);
	});

	it('guards the claim on the row still being queued', () => {
		const body = dispatchBody();
		// Without this the claim is not atomic against a concurrent tick: both
		// would "claim" and both would start a run.
		expect(body).toContain("eq('status', 'queued')");
	});

	it('returns without starting a run when the claim matches nothing', () => {
		const body = dispatchBody();
		const claimCheck = body.indexOf('already claimed');
		const startAt = body.indexOf('startRun(');
		expect(claimCheck, 'no early return for a lost claim').toBeGreaterThan(-1);
		expect(
			claimCheck,
			'the lost-claim return must come before startRun(), or the loser still pays',
		).toBeLessThan(startAt);
	});
});
