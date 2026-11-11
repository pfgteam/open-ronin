// Self → Sales (spec 2026-10-15-self-sales-design.md): the rules behind the
// Sales tab and the Overview's sales cards. Pure — no React, no Supabase —
// so every rule is unit-tested; salesData.ts loads, the components render.
//
// Day math is Chicago (the revenue engine's day, rev_daily_metrics and
// rev_my_day both use America/Chicago). Snooze presets are the VIEWER's
// local 9:00, because the rep picks them in their own browser.

import type { MyDayRow, TargetRow } from '@/lib/revenue/server';
import { addDays, chicagoDay, rangeFor, withDerived, type Totals } from '@/lib/revenue/metrics';
import { TRACKED_METRICS } from '@/lib/revenue/adminOptions';

export interface SalesRow extends MyDayRow {
	person_id: string | null;
	pipeline_id: string | null;
	stage_id: string | null;
	/** A rep has sent an outbound touch. Inbound GHL messages also set first_touch_at, so that column can't say this. */
	answered: boolean;
	ghl_url: string | null;
}

export type SalesGroupKey = 'new' | 'calls' | 'overdue' | 'today' | 'week' | 'later' | 'hold' | 'none';

export const SALES_GROUPS: { key: SalesGroupKey; label: string; collapsed: boolean }[] = [
	{ key: 'new', label: 'New leads', collapsed: false },
	{ key: 'calls', label: 'Calls today', collapsed: false },
	{ key: 'overdue', label: 'Overdue', collapsed: false },
	{ key: 'today', label: 'Today', collapsed: false },
	{ key: 'week', label: 'This week', collapsed: true },
	{ key: 'later', label: 'Later', collapsed: true },
	{ key: 'hold', label: 'On hold', collapsed: true },
	{ key: 'none', label: 'No next action', collapsed: true },
];

export interface SalesGroup {
	key: SalesGroupKey;
	label: string;
	rows: SalesRow[];
}

const ms = (iso: string) => Date.parse(iso);

/** First match wins; the order here is the rule order (spec §4.2), not the display order. */
export function salesGroupOf(r: SalesRow, now: Date, callDeals: Readonly<Record<string, string>>): SalesGroupKey {
	if (r.reason === 'new lead' && !r.answered) return 'new';
	if (callDeals[r.deal_id]) return 'calls';
	if (r.delay_until && ms(r.delay_until) > now.getTime()) return 'hold';
	if (r.reason === 'follow-up overdue' || (r.next_action_at && ms(r.next_action_at) < now.getTime())) return 'overdue';
	if (!r.next_action_at) return 'none';
	const today = chicagoDay(now);
	const day = chicagoDay(new Date(r.next_action_at));
	if (day === today) return 'today';
	const sunday = addDays(rangeFor('week', today).from, 6);
	return day <= sunday ? 'week' : 'later';
}

export function groupSalesRows(rows: SalesRow[], now: Date, callDeals: Readonly<Record<string, string>>): SalesGroup[] {
	const by = new Map<SalesGroupKey, SalesRow[]>();
	for (const r of rows) {
		const k = salesGroupOf(r, now, callDeals);
		const list = by.get(k);
		if (list) list.push(r);
		else by.set(k, [r]);
	}
	by.get('calls')?.sort((a, b) => callDeals[a.deal_id].localeCompare(callDeals[b.deal_id]));
	return SALES_GROUPS.filter((g) => by.has(g.key)).map((g) => ({ key: g.key, label: g.label, rows: by.get(g.key) as SalesRow[] }));
}

/** Readable names for every tracked metric (admin target options are the source of truth). */
export const METRIC_LABELS: Record<string, string> = Object.fromEntries(TRACKED_METRICS.map((m) => [m.value, m.label]));

export interface TargetTile {
	key: string;
	metric: string;
	label: string;
	period: 'day' | 'week';
	done: number;
	target: number;
}

/** Personal target beats the lane baseline; day targets before week; month targets are dashboard material. */
export function pickTargets(targets: TargetRow[], lanes: readonly string[], userId: string, dayRaw: Totals, weekRaw: Totals, max = 4): TargetTile[] {
	const day = withDerived(dayRaw);
	const week = withDerived(weekRaw);
	const laneSet = new Set(lanes);
	const byKey = new Map<string, TargetRow>();
	for (const t of targets) {
		if (!laneSet.has(t.lane) || t.period === 'month') continue;
		if (t.user_id !== null && t.user_id !== userId) continue;
		const k = `${t.metric}:${t.period}`;
		if (!byKey.has(k) || t.user_id === userId) byKey.set(k, t);
	}
	return [...byKey.values()]
		.sort((a, b) => (a.period === b.period ? 0 : a.period === 'day' ? -1 : 1))
		.slice(0, max)
		.map((t) => ({
			key: `${t.metric}:${t.period}`,
			metric: t.metric,
			label: METRIC_LABELS[t.metric] ?? t.metric,
			period: t.period as 'day' | 'week',
			done: (t.period === 'day' ? day : week)[t.metric] ?? 0,
			target: t.target,
		}));
}

export function slowNewLeads(rows: SalesRow[], now: Date, goalMinutes: number): number {
	return rows.filter((r) => r.reason === 'new lead' && !r.answered && now.getTime() - ms(r.created_at) > goalMinutes * 60_000).length;
}

// ------------------------------------------------------------ calendar

export interface SalesCallEvent {
	id: string;
	title: string;
	starts_at: string;
	category_key: string | null;
	attendee_external: string[] | null;
	location: string | null;
}

const INTERNAL_DOMAIN = '@example.com';

export function isSalesCall(e: Pick<SalesCallEvent, 'category_key'>): boolean {
	return e.category_key === 'sales_call';
}

export function callKindLabel(title: string): 'Discovery' | 'Sales call' {
	return /discovery/i.test(title) ? 'Discovery' : 'Sales call';
}

function externalEmails(e: SalesCallEvent): string[] {
	return (e.attendee_external ?? []).map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@') && !x.endsWith(INTERNAL_DOMAIN));
}

export function salesCallEmails(events: SalesCallEvent[]): string[] {
	return [...new Set(events.filter(isSalesCall).flatMap(externalEmails))];
}

export interface CallMatch {
	dealId: string;
	dealTitle: string;
}

export function matchCallsToDeals(
	events: SalesCallEvent[],
	people: { id: string; email: string | null }[],
	deals: { id: string; title: string; primary_person_id: string | null; updated_at: string }[],
): Record<string, CallMatch> {
	const personByEmail = new Map<string, string>();
	for (const p of people) if (p.email) personByEmail.set(p.email.toLowerCase(), p.id);
	const dealByPerson = new Map<string, { id: string; title: string; updated_at: string }>();
	for (const d of deals) {
		if (!d.primary_person_id) continue;
		const cur = dealByPerson.get(d.primary_person_id);
		if (!cur || d.updated_at > cur.updated_at) dealByPerson.set(d.primary_person_id, d);
	}
	const out: Record<string, CallMatch> = {};
	for (const e of events) {
		if (!isSalesCall(e)) continue;
		for (const email of externalEmails(e)) {
			const pid = personByEmail.get(email);
			const deal = pid ? dealByPerson.get(pid) : undefined;
			if (deal) {
				out[e.id] = { dealId: deal.id, dealTitle: deal.title };
				break;
			}
		}
	}
	return out;
}

/** dealId → earliest start among today's (Chicago) matched calls. */
export function todayCallDeals(events: SalesCallEvent[], matches: Record<string, CallMatch>, now: Date): Record<string, string> {
	const today = chicagoDay(now);
	const out: Record<string, string> = {};
	for (const e of events) {
		const m = matches[e.id];
		if (!m || chicagoDay(new Date(e.starts_at)) !== today) continue;
		if (!out[m.dealId] || e.starts_at < out[m.dealId]) out[m.dealId] = e.starts_at;
	}
	return out;
}

// ------------------------------------------------------------ snooze

export type SnoozePreset = 'tomorrow' | 'two_days' | 'next_week';
export const SNOOZE_PRESETS: { key: SnoozePreset; label: string }[] = [
	{ key: 'tomorrow', label: 'Tomorrow 9am' },
	{ key: 'two_days', label: 'In 2 days' },
	{ key: 'next_week', label: 'Next week' },
];

export function presetAt(p: SnoozePreset, now: Date): Date {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
	if (p === 'tomorrow') d.setDate(d.getDate() + 1);
	else if (p === 'two_days') d.setDate(d.getDate() + 2);
	else d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); // next Monday
	return d;
}

// ------------------------------------------------------------ labels

// Every label is Chicago time: it matches the Chicago grouping and renders the
// same on the UTC server and in the browser (no hydration mismatch).
const TZ = 'America/Chicago';
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
const dayDiff = (fromIso: string, now: Date) => {
	const a = new Date(`${chicagoDay(new Date(fromIso))}T12:00:00Z`).getTime();
	const b = new Date(`${chicagoDay(now)}T12:00:00Z`).getTime();
	return Math.round((b - a) / 86_400_000);
};

/** Right-hand "Due" text for a queue row. `goalMinutes` only matters for the New group. */
export function salesDueLabel(r: SalesRow, group: SalesGroupKey, now: Date, callStart?: string, goalMinutes = 5): { text: string; late: boolean } {
	if (group === 'new') {
		const mins = Math.max(0, Math.floor((now.getTime() - ms(r.created_at)) / 60_000));
		return { text: mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`, late: mins > goalMinutes };
	}
	if (group === 'calls' && callStart) return { text: time(callStart), late: false };
	if (group === 'hold' && r.delay_until) return { text: `until ${shortDate(r.delay_until)}`, late: false };
	if (!r.next_action_at) return { text: '—', late: false };
	if (group === 'overdue') {
		const d = dayDiff(r.next_action_at, now);
		return { text: d <= 0 ? time(r.next_action_at) : d === 1 ? 'yesterday' : `${d}d late`, late: true };
	}
	if (group === 'today') return { text: time(r.next_action_at), late: false };
	if (group === 'week') return { text: new Date(r.next_action_at).toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ }), late: false };
	return { text: shortDate(r.next_action_at), late: false };
}
