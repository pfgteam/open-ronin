// Due-date helpers for the Home queue (Self). Pure; unit-tested.
//
// Timezone rule: `projects.ends_at` is a bare `date`. Parsed with
// `new Date('YYYY-MM-DD')` it would be UTC midnight, which is the previous
// evening for every US viewer and mislabels "due today" as "overdue". So a
// bare date is read as LOCAL midnight; a full timestamp parses normally.

export function parseDueLocal(d: string): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
	if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return new Date(d);
}

export function startOfDay(d: Date): Date {
	const c = new Date(d);
	c.setHours(0, 0, 0, 0);
	return c;
}

const DAY_MS = 86_400_000;

/** End of the viewer's current week: the coming Sunday (today when today is Sunday), local midnight. */
export function weekEndOf(today: Date): Date {
	const d = startOfDay(today);
	d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
	return d;
}

/**
 * Date buckets shared by Self → Overview (KPI counts) and Self → My work (the
 * queue groups), spec §4.3: Overdue → Today → This week → Next week → Later →
 * No date. ONE definition, so the number on the KPI is the number in the group.
 */
export type DueBucket = 'overdue' | 'today' | 'week' | 'next' | 'later' | 'none';
export const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'next', 'later', 'none'];
export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
	overdue: 'Overdue', today: 'Today', week: 'This week', next: 'Next week', later: 'Later', none: 'No date',
};

export function dueBucket(dueDate: string | null, today: Date): DueBucket {
	if (!dueDate) return 'none';
	const t0 = startOfDay(today);
	const t = startOfDay(parseDueLocal(dueDate)).getTime();
	if (t < t0.getTime()) return 'overdue';
	if (t === t0.getTime()) return 'today';
	const weekEnd = weekEndOf(t0);
	if (t <= weekEnd.getTime()) return 'week';
	const nextEnd = new Date(weekEnd);
	nextEnd.setDate(nextEnd.getDate() + 7);
	if (t <= nextEnd.getTime()) return 'next';
	return 'later';
}

/**
 * The queue row's due column: how far a date is from `today`, in the words a
 * person would use — "4d late", "Today", "Tomorrow", a weekday for the rest of
 * the coming week, then a short date (with the year only when it differs).
 * `today` is the viewer's local midnight (startOfDay(new Date())).
 */
export function relativeDue(dueDate: string | null, today: Date): string {
	if (!dueDate) return '—';
	const due = startOfDay(parseDueLocal(dueDate));
	// Round, not floor: a DST shift makes a "day" 23 or 25 hours long.
	const days = Math.round((due.getTime() - startOfDay(today).getTime()) / DAY_MS);
	if (days < 0) return `${-days}d late`;
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	// en-US on purpose — the UI is English-only, and the default locale would
	// leak the viewer's browser language into the page.
	if (days < 7) return due.toLocaleDateString('en-US', { weekday: 'short' });
	return due.toLocaleDateString(
		'en-US',
		due.getFullYear() === today.getFullYear()
			? { month: 'short', day: 'numeric' }
			: { month: 'short', day: 'numeric', year: 'numeric' },
	);
}
