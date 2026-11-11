// A goal never TYPES its health — it INHERITS the worst health among its
// active children (spec 2026-08-25, "one chassis, three emphases": Goal
// health = "computed = worst active child health, never typed"). If a goal
// could declare "On track" while one of its priorities is "Off track", the
// page would lie; this function is the reason it cannot.
//
// Pure by construction, same house style as ./activity.ts: no Date.now(),
// no I/O, no formatting. The caller resolves each child's CURRENT health
// (newest work_item_updates row for that child) and whether the child sits
// in a terminal status, and hands both in.

export type WorkHealth = 'on_track' | 'at_risk' | 'off_track';

export interface HealthChild {
	/** The child's current health — null when it has never posted an update. */
	health: WorkHealth | null;
	/** True when the child's status is terminal (done/cancelled/…). */
	isTerminal: boolean;
}

// Severity ladder. Higher wins, so "worst" is a plain max — off_track beats
// at_risk beats on_track.
const SEVERITY: Record<WorkHealth, number> = {
	on_track: 1,
	at_risk: 2,
	off_track: 3,
};

/**
 * The worst health among the ACTIVE children.
 *
 * - Terminal children are ignored outright: work that is already finished
 *   cannot drag a goal down, whatever its last update said.
 * - Children with no health at all are skipped (silence is not a signal).
 * - `null` when nothing is left to judge — no children, all terminal, or
 *   none of the active ones ever posted an update. The caller renders that
 *   as "no child health yet", never as "On track".
 */
export function worstActiveHealth(children: HealthChild[]): WorkHealth | null {
	let worst: WorkHealth | null = null;
	for (const c of children) {
		if (c.isTerminal) continue;
		if (!c.health) continue;
		if (worst === null || SEVERITY[c.health] > SEVERITY[worst]) worst = c.health;
	}
	return worst;
}
