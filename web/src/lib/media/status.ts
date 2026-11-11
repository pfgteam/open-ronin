// The media-opportunity status vocabulary — R3 of openronin-decisions.md
// (Alex, 2026-08-24: secured = "the media member shows interest in doing
// something for the client"), mapping Airtable's 17 Status values onto five
// stages. This is the ONE place the counting rule lives; UI chips, counters
// and reports must import from here rather than re-testing tokens (the old
// chips tested 'Live'/'Pending'/'Secured' — tokens Airtable never uses — and
// showed 0 · 0 · 0 over rows visibly reading "Secured Coverage").
//
// Counting rule: `secured` and `client_lost` COUNT toward the monthly goal
// (the playbook counts Client Decline; Unresponsive/Missed Deadline are the
// same class). `pitched` and `media_lost` do not. LIVE is a property, not a
// status: a row is live when its Live Link is non-empty, whatever the status
// says, and is reported separately.
//
// Open sub-question (decisions doc "Still open" #1): "Warm lead (responded)"
// is included as secured per Alex's wording — flip it here if he rules
// otherwise.

export type MediaStage = 'pitched' | 'secured' | 'client_lost' | 'media_lost' | 'unmapped';

const STAGE_BY_STATUS: Record<string, MediaStage> = {
	// pitched, no interest yet — does NOT count
	'Pending Coverage': 'pitched',
	'Future Consideration': 'pitched',
	// secured (interest shown) — counts
	'Warm lead (responded)': 'secured',
	'Product Request': 'secured',
	'Sent Product': 'secured',
	'Paid Opp': 'secured',
	'Scheduled': 'secured',
	'Waiting to go Live': 'secured',
	// Airtable spells this with an ASCII hyphen. This map used to carry an
	// en-dash, so the row fell through to `unmapped`, dropped out of "Secured"
	// counts and rendered a gray chip. `normalizeStatus` now folds dash
	// variants so either spelling resolves.
	'Live - Pending Client Approval': 'secured',
	'Secured Coverage': 'secured',
	// secured, lost on the client side — still counts
	'Client Decline': 'client_lost',
	'Client Unresponsive': 'client_lost',
	'Client Missed Deadline': 'client_lost',
	// lost on the media side — does NOT count
	'Media Decline': 'media_lost',
	'Media Unresponsive': 'media_lost',
	'Canceled': 'media_lost',
	'Not Fit': 'media_lost',
};

/**
 * Fold the cosmetic differences between what a human typed into an Airtable
 * select and what this map spells. Two have actually bitten us:
 *   - trailing spaces ("Warm lead (responded) ", "Future Consideration ")
 *   - dash variants (en-dash vs ASCII hyphen in "Live - Pending…")
 * Case is folded too, so a re-cased option does not silently stop counting.
 */
function normalizeStatus(status: string): string {
	return status
		.replace(/[\u2010-\u2015\u2212]/g, '-') // hyphen/en/em/figure dash, minus sign
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

const STAGE_BY_NORMALIZED: Map<string, MediaStage> = new Map(
	Object.entries(STAGE_BY_STATUS).map(([label, stage]) => [normalizeStatus(label), stage]),
);

/**
 * Status values seen at runtime that this map does not know. An unmapped value
 * counts toward nothing and renders gray, which is exactly the silent-drift
 * failure that showed 0 · 0 · 0 once before — so it is logged the first time
 * each distinct value appears instead of being swallowed.
 */
const reportedUnmapped = new Set<string>();

export function stageOf(status: string | undefined): MediaStage {
	if (!status) return 'unmapped';

	const stage = STAGE_BY_NORMALIZED.get(normalizeStatus(status));
	if (stage) return stage;

	const raw = status.trim();
	if (raw && !reportedUnmapped.has(raw)) {
		reportedUnmapped.add(raw);
		console.warn(
			`[media/status] unmapped Status value ${JSON.stringify(raw)} — it counts toward no goal and renders gray. Add it to STAGE_BY_STATUS in src/lib/media/status.ts.`,
		);
	}
	return 'unmapped';
}

/** Distinct unmapped Status values seen so far this process. For diagnostics. */
export function unmappedStatusesSeen(): string[] {
	return [...reportedUnmapped].sort();
}

/** Every Status value this module knows, in its canonical Airtable spelling. */
export function knownStatuses(): string[] {
	return Object.keys(STAGE_BY_STATUS);
}

/** Does this row count toward the client's monthly media-opp goal? (R3) */
export function countsTowardGoal(status: string | undefined): boolean {
	const s = stageOf(status);
	return s === 'secured' || s === 'client_lost';
}

/** Live is a property of the row, not a status value (R3). */
export function isLive(liveLink: string | undefined): boolean {
	return !!liveLink && liveLink.trim().length > 0;
}

/**
 * The ONE badge color per stage, so a media status reads the same on the
 * Media table, the client detail page, and anywhere else a status chip
 * appears. secured is success-green: a win is green everywhere else in the
 * app (won deals, approved requests, paid invoices), and Media was the lone
 * module painting it blue.
 */
export function stageColor(
	status: string | undefined,
): 'default' | 'success' | 'warning' | 'danger' {
	switch (stageOf(status)) {
		case 'secured':
			return 'success';
		case 'pitched':
			return 'warning';
		case 'client_lost':
		case 'media_lost':
			return 'danger';
		default:
			return 'default';
	}
}
