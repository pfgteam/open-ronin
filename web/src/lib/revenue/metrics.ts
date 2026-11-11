// Tracker math (0124, spec §11). Pure: takes the rows rev_daily_metrics()
// returns and reproduces the sheets' derived columns. No server imports.

export interface MetricRow {
	day: string;
	user_id: string;
	metric: string;
	value: number;
}

export type Totals = Record<string, number>;

export function sumBy(rows: MetricRow[], pick?: (r: MetricRow) => boolean): Totals {
	const out: Totals = {};
	for (const r of rows) {
		if (pick && !pick(r)) continue;
		out[r.metric] = (out[r.metric] ?? 0) + r.value;
	}
	return out;
}

/** Metrics the tracker sheets derive instead of counting (same rule as closerDerived). Admin targets can use them. */
export const DERIVED_METRICS: Record<string, (t: Totals) => number> = {
	sales_taken: (t) => Math.max(t.shows ?? 0, t.offers_sent ?? 0),
};

export function withDerived(t: Totals): Totals {
	const out: Totals = { ...t };
	for (const [k, fn] of Object.entries(DERIVED_METRICS)) out[k] = fn(t);
	return out;
}

export function pct(num: number, den: number): number | null {
	if (!den) return null;
	return Math.round((num / den) * 1000) / 10;
}

/** V1 Setter Tracker columns. */
export function setterDerived(t: Totals) {
	const dials = t.dials ?? 0;
	const convos = t.conversations ?? 0;
	const sets = t.sets ?? 0;
	const shows = t.shows ?? 0;
	const offers = t.offers ?? 0;
	const closes = t.closes ?? 0;
	return {
		leads_assigned: t.new_leads ?? 0,
		dials,
		answers: t.answers ?? 0,
		conversations: convos,
		conversation_pct: pct(convos, dials),
		sets,
		convo_to_set_pct: pct(sets, convos),
		sets_on_calendar: t.discovery_booked ?? sets,
		live_calls: shows,
		offered: offers,
		closed: closes,
		show_pct: pct(shows, sets),
		offer_pct: pct(offers, shows),
		set_to_close_pct: pct(closes, sets),
		show_to_close_pct: pct(closes, shows),
		offer_to_close_pct: pct(closes, offers),
		fe_cash: (t.fe_cash_cents ?? 0) / 100,
		follow_ups: t.follow_ups ?? 0,
		no_shows: t.no_shows ?? 0,
	};
}

/** 2026 2-Call Close Tracker columns. */
export function closerDerived(t: Totals) {
	const dBooked = t.discovery_booked ?? 0;
	const dTaken = t.discovery_taken ?? 0;
	const sBooked = t.sales_booked ?? 0;
	const sTaken = (t.offers_sent ?? 0) + (t.shows ?? 0) > 0 ? Math.max(t.shows ?? 0, t.offers_sent ?? 0) : 0;
	const offers = Math.max(t.offers ?? 0, t.offers_sent ?? 0);
	const signed = t.agreements_signed ?? t.won ?? 0;
	return {
		discovery_booked: dBooked,
		discovery_taken: dTaken,
		sales_booked: sBooked,
		sales_taken: sTaken,
		call1_show_pct: pct(dTaken, dBooked),
		call2_sched_pct: pct(sBooked, dTaken),
		call2_show_pct: pct(sTaken, sBooked),
		offers,
		deposits: t.fe_cash_cents ? Math.round(t.fe_cash_cents / 100) : 0,
		agreements_signed: signed,
		offer_pct: pct(offers, sTaken),
		offer_commit_pct: pct(signed, offers),
		close_pct: pct(signed, dTaken),
		cash_collected: (t.fe_cash_cents ?? 0) / 100,
		mrr_sold: (t.mrr_sold_cents ?? 0) / 100,
	};
}

/** Exec funnel (CEO Metrics). */
export function execFunnel(t: Totals, dbSize: number) {
	const newLeads = t.new_leads ?? 0;
	const first = t.discovery_booked ?? 0;
	const firstShown = t.discovery_taken ?? 0;
	const second = t.sales_booked ?? 0;
	const secondShown = Math.max(t.shows ?? 0, t.offers_sent ?? 0);
	const offers = Math.max(t.offers ?? 0, t.offers_sent ?? 0);
	const won = t.won ?? 0;
	return {
		new_leads: newLeads,
		database_size: dbSize,
		first_calls_booked: first,
		first_calls_shown: firstShown,
		secondary_calls_booked: second,
		secondary_calls_shown: secondShown,
		offers,
		units_sold: won,
		mrr_added: (t.mrr_sold_cents ?? 0) / 100,
		total_sales: ((t.mrr_sold_cents ?? 0) + (t.fe_cash_cents ?? 0)) / 100,
		leads_to_first_pct: pct(first, newLeads),
		first_to_sales_pct: pct(second, firstShown),
		sales_to_client_pct: pct(won, secondShown),
	};
}

export function fmtPct(v: number | null): string {
	return v == null ? '—' : `${v}%`;
}

/** Chicago-day ISO date for a Date. */
export function chicagoDay(d: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
	const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return `${g('year')}-${g('month')}-${g('day')}`;
}

export function addDays(iso: string, n: number): string {
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

export function rangeFor(period: 'day' | 'week' | 'month', today = chicagoDay()): { from: string; to: string } {
	if (period === 'day') return { from: today, to: today };
	if (period === 'week') {
		const d = new Date(`${today}T12:00:00Z`);
		const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
		return { from: addDays(today, -dow), to: today };
	}
	return { from: `${today.slice(0, 7)}-01`, to: today };
}
