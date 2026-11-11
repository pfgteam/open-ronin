const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-16" → "Oct 16" (adds the year when it isn't this year). Parsed
 *  as a local date — never `new Date('YYYY-MM-DD')`, which is UTC midnight
 *  and shows the previous day for every US viewer. */
export function formatShortDate(iso: string, now = new Date()): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) return iso;
	const [, y, mo, d] = m;
	const base = `${MON[Number(mo) - 1]} ${Number(d)}`;
	return Number(y) === now.getFullYear() ? base : `${base}, ${y}`;
}
