// Builds a dashboard's tile catalog straight from the 2026 CEO Metrics sheet,
// instead of hand-listing tiles.
//
// Rules (decided with Sam 13/08):
//   1. EVERY metric row of the Daily tab in the page's sections becomes a card
//      — add a row to the sheet and the card shows up on the next request.
//   2. Each card carries the weekly numbers for the SAME metric on its bottom
//      line ("Week $395.87 ▲ +34%"), so there is no separate weekly table.
//   3. Metrics that only exist on the Weekly tab still become cards, grouped
//      into "<group> (weekly)" sections at the end — nothing in the sheet is
//      invisible in the app.
//   4. Daily rows that have never been filled (Smartlead, Leadify) are skipped
//      until the team starts filling them.
//
// The tabs disagree on names for the same metric ("1st Calls Calendar Open Ronin" vs
// "1st Calls Booked Open Ronin", "GHL Sent (emails)" vs "GHL Sent"), so pairing daily
// and weekly rows takes a canonical form plus a small explicit map. When a
// daily row has no weekly twin the card simply shows no week line — pairing is
// never guessed between two candidates.

import {
	Award,
	CheckCircle,
	DollarSign,
	Facebook,
	FileText,
	Headphones,
	Instagram,
	Linkedin,
	MessageSquare,
	MousePointerClick,
	Music2,
	Newspaper,
	Percent,
	PhoneCall,
	Send,
	Sparkles,
	Star,
	Target,
	TrendingUp,
	UserPlus,
	Users,
	type LucideIcon,
} from 'lucide-react';

import {
	formatCurrency,
	formatCurrencyPrecise,
	formatMetricNumber,
	formatPercent,
} from '@/lib/format';
import { net7, type DailyMetrics, type DailyPoint, type DailyRow } from '@/lib/metrics/daily';
import { rowsFor, type MetricPoint, type WeeklyMetrics, type WeeklyRow } from '@/lib/metrics/sheets';

import type { TileFormat, TileSpec } from './catalog';
import type { DashboardPeriod } from './layout';

// ---------------------------------------------------------------------------
// Units, tone and icon inferred from the metric name
// ---------------------------------------------------------------------------

// The sheet has no unit column. Order matters: "Run Rate" is dollars while
// "Run Rate ROAS" is a multiple, and "Client Retention" is a number of months.
export function formatForLabel(label: string): TileFormat {
	const l = label.toLowerCase();
	if (/roas|retention|score|count|\(hrs\)|\(amount\)|ltv\/|database/.test(l)) return 'number';
	if (/^run rate/.test(l)) return 'currency';
	if (/rate|ratio|growth|margin|%/.test(l)) return 'percent';
	if (/cpc|cpl|cost per click|cost per conv|spend/.test(l)) return 'currency2';
	if (
		/spend|cash|rev\b|revenue|mrr|\bmr\b|value|dollars|cac|cost|payroll|commission|profit|rpe|price|expenses/.test(
			l,
		)
	)
		return 'currency';
	return 'number';
}

// Spend has no inherent good direction; cost-per-X is better when it falls.
export function toneForLabel(label: string): 'normal' | 'inverted' | 'neutral' {
	const l = label.toLowerCase();
	if (/spend|expenses|payroll|commission|database/.test(l)) return 'neutral';
	if (/cost|cpc|cpl|cac|loss/.test(l)) return 'inverted';
	return 'normal';
}

// Follower counts and database sizes are levels, not daily volumes: their
// useful second reading is the 7-day net change, not a 7-day average.
function isStock(label: string): boolean {
	return /followers|database|nurture|total lead count|client health|retention/i.test(label);
}

function iconForLabel(label: string): LucideIcon {
	const l = label.toLowerCase();
	if (/followers/.test(l)) {
		if (/instagram/.test(l)) return Instagram;
		if (/facebook/.test(l)) return Facebook;
		if (/linkedin/.test(l)) return Linkedin;
		if (/tiktok/.test(l)) return Music2;
		return Users;
	}
	if (/cost per|cpc|cpl|cac|cost \//.test(l)) return Target;
	if (/roas|run rate|rpe|profit|margin/.test(l)) return TrendingUp;
	if (/spend|cash|rev\b|revenue|mrr|dollars|payroll|commission|expenses|value/.test(l))
		return DollarSign;
	if (/rate|ratio|growth|%/.test(l)) return Percent;
	if (/shown|show|qual/.test(l)) return CheckCircle;
	if (/call|dial|convo|inbound|set\b/.test(l)) return PhoneCall;
	if (/sent|dms|sms|invite|pitch/.test(l)) return Send;
	if (/repl|received|message/.test(l)) return MessageSquare;
	if (/offer|contract|report|survey/.test(l)) return FileText;
	if (/close|upsell|secured|win/.test(l)) return Award;
	if (/podcast/.test(l)) return Headphones;
	if (/live link|media opp|placement|link/.test(l)) return Newspaper;
	if (/conversion|click/.test(l)) return MousePointerClick;
	if (/nps|health|score/.test(l)) return Star;
	if (/lead|signup|user|contact|database|influencer/.test(l)) return Users;
	if (/instagram/.test(l)) return Instagram;
	if (/facebook/.test(l)) return Facebook;
	if (/linkedin/.test(l)) return Linkedin;
	if (/added|new\b/.test(l)) return UserPlus;
	return Sparkles;
}

// Exported so the metric table formats a value exactly like the card does.
export function formatValue(v: number | null, format: TileFormat): string {
	return FMT[format](v);
}

const FMT: Record<TileFormat, (n: number | null) => string> = {
	number: (n) => formatMetricNumber(n),
	currency: (n) => formatCurrency(n),
	currency2: (n) => formatCurrencyPrecise(n),
	percent: (n) => formatPercent(n),
};

// ---------------------------------------------------------------------------
// Tile keys
// ---------------------------------------------------------------------------

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

// Keys are persisted in user_dashboard_layout, so they must be stable across
// deploys: they come from the sheet's own section/group/metric path. The
// aliases keep the layouts saved before this refactor working.
const LEGACY_KEYS: Record<string, string> = {
	'd:marketing.google-ads.app.spend': 'google_spend',
	'd:marketing.google-ads.org.conversions': 'google_conversions',
	'd:marketing.google-ads.org.cost-per-click': 'google_cpc',
	'd:marketing.meta-ads.app.spend': 'meta_spend',
	'd:marketing.meta-ads.org.leads': 'meta_leads',
	'd:marketing.meta-ads.org.cost-per-conversion': 'meta_cost_per_conv',
	'd:lead-gen.leadhype.leadhype-sent': 'leadhype_sent',
	'd:lead-gen.leadhype.leadhype-calls-booked': 'leadhype_calls_booked',
	'd:lead-gen.linkedin.linkedin-dms-sent': 'linkedin_dms_sent',
	"d:lead-gen.linkedin.linkedin-dm-s-calls-booked": 'linkedin_calls_booked',
	'd:lead-gen.instagram.instagram-dms-sent': 'instagram_dms_sent',
	'd:lead-gen.internal.ghl-sent-emails': 'ghl_emails_sent',
	'd:crm.ghl-contacts-added': 'ghl_contacts_added',
	'd:crm.new-mql-leads': 'new_mql_leads',
	'd:sales.1st-calls-calendar-org': 'first_calls_booked',
	'd:sales.1st-calls-shown-org': 'first_calls_shown',
	'd:sales.show-rate': 'show_rate',
	'd:sales.beacon-calls-booked': 'beacon_calls_booked',
	'd:sales.offers.or-offers': 'or_offers',
	'd:sales.offers.beacon-offers': 'beacon_offers',
	'd:sales.offers.closes-org': 'closes',
	'd:sales.offers.contract-mrr-value': 'contract_mrr_value',
	'd:finances.total-sales-dollars': 'total_sales_dollars',
	'd:social.org.instagram-followers': 'or_ig_followers',
	'd:social.org.facebook-followers': 'or_fb_followers',
	'd:social.beacon.instagram-followers': 'beacon_ig_followers',
	'd:social.jamie.instagram-followers': 'heather_ig_followers',
	'd:social.jamie.facebook-followers': 'heather_fb_followers',
	'd:social.alex.instagram-followers': 'owner_ig_followers',
	'w:crm.total-lead-count': 'total_lead_count',
	'w:lead-gen.internal.email-calls-booked': 'email_calls_booked',
	'w:sales.tracked-monthly.new-or-mrr-added': 'new_or_mrr',
	'w:sales.offers.new-beacon-subs': 'new_beacon_subs',
	'w:social.internal.or-linkedin.total-followers': 'or_li_followers',
	'w:social.internal.or-tiktok.total-followers': 'or_tt_followers',
};

function tileKey(
	prefix: 'd' | 'w',
	row: { section: string; g1: string | null; g2: string | null },
	label: string,
): string {
	const path = [row.section, row.g1 ?? '', row.g2 ?? '', label]
		.filter((p) => p && p.trim() !== '')
		.map(slug)
		.join('.');
	const key = `${prefix}:${path}`;
	return LEGACY_KEYS[key] ?? key;
}

// Grid group: the sheet's own grouping column, falling back to the section.
function groupOf(row: { section: string; g1: string | null; g2: string | null }): string {
	return row.g1 ?? row.g2 ?? row.section;
}

// ---------------------------------------------------------------------------
// Pairing a Daily row with its Weekly twin
// ---------------------------------------------------------------------------

// Drops parenthesised qualifiers and punctuation: "GHL Sent (emails)" and
// "GHL Sent" both collapse to "ghl sent".
const canon = (s: string) =>
	s
		.toLowerCase()
		.replace(/\([^)]*\)/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

// Only pairs we are sure about. Anything not listed relies on `canon`, and an
// ambiguous match is dropped rather than guessed.
const DAILY_TO_WEEKLY_LABEL: Record<string, string> = {
	'1st calls calendar org': '1st calls booked org',
	'1st calls qual sql org': '1st calls qual',
	'meaningful convos': 'meaninful convos', // the Weekly tab has the typo
	'dial booked': 'sets',
	'upsell value': 'upsell mrr value',
	'new cash collected': 'new cash collected org',
	'org rev': 'org earned rev',
	'client health avg': 'client health score',
};

// The two tabs invert the Social key: the Daily tab puts the account in column
// B and the network in the metric name, the Weekly tab merges both ("Open Ronin IG")
// and calls the metric "Total Followers".
const SOCIAL_ACCOUNT: Record<string, string> = {
	'org|instagram followers': 'Open Ronin IG',
	'org|facebook followers': 'Open Ronin FB',
	'beacon|instagram followers': 'Beacon IG',
	'beacon|facebook followers': 'Beacon FB',
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

interface WeeklyMatch {
	row: WeeklyRow;
	point: MetricPoint;
}

function matchWeekly(pool: WeeklyRow[], d: DailyRow): WeeklyMatch | null {
	let wantedLabel = DAILY_TO_WEEKLY_LABEL[canon(d.label)] ?? canon(d.label);
	let wantedG2: string | null = null;

	const socialKey = `${norm(d.g2 ?? '')}|${norm(d.label)}`;
	if (SOCIAL_ACCOUNT[socialKey]) {
		wantedG2 = SOCIAL_ACCOUNT[socialKey];
		wantedLabel = 'total followers';
	}

	let candidates = pool.filter((r) => !r.isGroupHeader && canon(r.label) === wantedLabel);
	if (wantedG2) candidates = candidates.filter((r) => norm(r.g2 ?? '') === norm(wantedG2));
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return { row: candidates[0], point: candidates[0].point };

	// Several rows share the metric name ("Spend" exists under Google Ads, Meta
	// Ads, Beacon and Promo), so only the group can disambiguate. Precedence
	// matters: matching on the sub-label alone would pair Meta's daily spend with
	// Google's weekly spend, since both sit under "Main".
	const sameSection = candidates.filter((r) => norm(r.section) === norm(d.section));
	const pool2 = sameSection.length ? sameSection : candidates;
	const eq = (a: string | null | undefined, b: string | null | undefined) =>
		a != null && b != null && norm(a) === norm(b);
	const pick =
		pool2.find((r) => eq(r.g1, d.g1) && eq(r.g2, d.g2)) ??
		pool2.find((r) => eq(r.g1, d.g1)) ??
		pool2.find((r) => eq(r.g2, d.g2) && d.g1 == null) ??
		null;
	return pick ? { row: pick, point: pick.point } : null;
}

// ---------------------------------------------------------------------------
// Catalog builder
// ---------------------------------------------------------------------------

/** A card the Daily tab doesn't provide directly (e.g. total ad spend). */
export interface DerivedTile {
	key: string;
	label: string;
	section: string;
	/** Already-summed daily point (see sumDailyPoints). */
	daily: DailyPoint;
	/** Metric name on the Weekly tab, for the card's week line. */
	weeklyLabel?: string;
	format?: TileFormat;
	deltaTone?: 'normal' | 'inverted' | 'neutral';
	icon?: LucideIcon;
	subtitleNote?: string;
}

export interface SheetCatalogOptions {
	daily: DailyMetrics;
	weekly: WeeklyMetrics;
	/** Daily-tab sections owned by the page, e.g. ['Sales', 'Finances']. */
	sections: string[];
	/** Weekly-tab sections, when they are named differently (Media -> Media Relations). */
	weeklySections?: string[];
	derived?: DerivedTile[];
	/** Set false to leave weekly-only metrics out of the page. */
	includeWeeklyOnly?: boolean;
	/** Which period leads the KPI cards. Defaults to 'daily'. */
	period?: DashboardPeriod;
}

// `Data` is only here so the result can be concatenated with a hand-written
// catalog (delivery): generated tiles read the sheet through closures and
// ignore the data argument entirely.
interface Entry {
	key: string;
	label: string;
	section: string;
	format: TileFormat;
	tone: 'normal' | 'inverted' | 'neutral';
	icon: LucideIcon;
	/** Sheet sub-label, used only to disambiguate repeated metric names. */
	sub: string | null;
	daily: DailyPoint | null;
	weekly: MetricPoint | null;
	/** Follower counts and database sizes: a 7-day NET change, not an average. */
	stock: boolean;
	note?: string;
}

// Walk the sheet once and produce the page's metric list. Both the KPI cards
// (buildSheetCatalog) and the metric table (buildSheetSections) are views of it,
// so a metric can never appear in one and not the other.
function collect(opts: SheetCatalogOptions): Entry[] {
	const { daily, weekly, sections, derived = [], includeWeeklyOnly = true } = opts;
	const weeklyPool = rowsFor(weekly, opts.weeklySections ?? sections);
	const entries: Entry[] = [];
	const usedWeekly = new Set<WeeklyRow>();

	// --- derived tiles (totals the Daily tab doesn't carry) ------------------
	for (const d of derived) {
		const twin = d.weeklyLabel
			? (weeklyPool.find(
					(r) => !r.isGroupHeader && canon(r.label) === canon(d.weeklyLabel as string),
				) ?? null)
			: null;
		if (twin) usedWeekly.add(twin);
		entries.push({
			key: d.key,
			label: d.label,
			section: d.section,
			format: d.format ?? formatForLabel(d.label),
			tone: d.deltaTone ?? toneForLabel(d.label),
			icon: d.icon ?? iconForLabel(d.label),
			sub: null,
			daily: d.daily,
			weekly: twin?.point ?? null,
			stock: false,
			note: d.subtitleNote,
		});
	}

	// --- one entry per Daily row --------------------------------------------
	const wanted = new Set(sections.map(norm));
	for (const row of daily.rows) {
		if (row.isGroupHeader || !wanted.has(norm(row.section))) continue;
		// Channels that were switched off (Smartlead and Leadify, last filled
		// 05/12) stay out until someone fills them again — a permanently empty
		// card is noise. hasRecentData looks at the last 30 days, so this still
		// holds while the requested day itself is pending.
		if (!row.point.hasRecentData) continue;

		const twin = matchWeekly(weeklyPool, row);
		if (twin) usedWeekly.add(twin.row);
		const section = groupOf(row);
		entries.push({
			key: tileKey('d', row, row.label),
			label: row.label,
			section,
			format: formatForLabel(row.label),
			tone: toneForLabel(row.label),
			icon: iconForLabel(row.label),
			sub: row.g2 !== null && norm(row.g2) !== norm(section) ? row.g2 : row.g1,
			daily: row.point,
			weekly: twin?.point ?? null,
			stock: isStock(row.label),
		});
	}

	// --- metrics that exist only on the Weekly tab --------------------------
	if (includeWeeklyOnly) {
		for (const row of weeklyPool) {
			if (row.isGroupHeader || usedWeekly.has(row)) continue;
			if (row.point.week == null && row.point.prevWeek == null) continue;
			entries.push({
				key: tileKey('w', row, row.label),
				label: row.label,
				// The sheet's carried-down group column mislabels the total rows, so
				// the section name is the reliable one for this group.
				section: `${row.section} (weekly)`,
				format: formatForLabel(row.label),
				tone: toneForLabel(row.label),
				icon: iconForLabel(row.label),
				sub: row.g2 ?? row.g1,
				daily: null,
				weekly: row.point,
				stock: isStock(row.label),
			});
		}
	}

	return disambiguate(entries);
}

// The sheet repeats metric names across accounts and channels ("Added/lost"
// exists for six Social accounts, "Spend" for four ad groups). Keys already
// carry the full path; labels only get the sub-label prefixed when they would
// otherwise be identical inside the same section.
function disambiguate(entries: Entry[]): Entry[] {
	const seen = new Map<string, number>();
	for (const e of entries) {
		const k = `${e.section}|${norm(e.label)}`;
		seen.set(k, (seen.get(k) ?? 0) + 1);
	}

	const usedKeys = new Set<string>();
	return entries.map((e) => {
		const k = `${e.section}|${norm(e.label)}`;
		const label =
			(seen.get(k) ?? 0) > 1 && e.sub && !norm(e.label).includes(norm(e.sub))
				? `${e.sub} · ${e.label}`
				: e.label;
		// Two sheet rows with the same section, group and name would collide on the
		// key and break both the saved layout and the drag list.
		let key = e.key;
		for (let i = 2; usedKeys.has(key); i++) key = `${e.key}~${i}`;
		usedKeys.add(key);
		return { ...e, key, label };
	});
}

// ---------------------------------------------------------------------------
// View 1 — KPI cards
// ---------------------------------------------------------------------------

// `Data` is only here so the result can be concatenated with a hand-written
// catalog (delivery): generated tiles read the sheet through closures and
// ignore the data argument entirely.
export function buildSheetCatalog<Data>(opts: SheetCatalogOptions): TileSpec<Data>[] {
	const weeklyFocus = opts.period === 'weekly';
	const pending = !opts.daily.hasRequestedDay;
	const dayLabel = opts.daily.requestedDay;

	return collect(opts).map((e) => {
		const f = FMT[e.format];

		// Bottom line of a daily-focused card: 7-day average for flows, 7-day net
		// change for stocks. Weekly focus shows month-to-date instead — the sheet's
		// Targets column is empty for these sections, so MTD is the useful context.
		const bottom = (): string => {
			if (!e.daily) {
				const month = e.weekly?.month;
				const base = month != null ? `Weekly only · MTD ${f(month)}` : 'Weekly only';
				return e.note ? `${base} · ${e.note}` : base;
			}
			if (weeklyFocus) {
				if (!e.weekly) return 'No weekly row in the sheet · daily only';
				const month = e.weekly.month;
				const base = month != null ? `MTD ${f(month)}` : `Week ${e.weekly.week == null ? '—' : ''}`;
				return e.note ? `${base} · ${e.note}` : base;
			}
			if (pending) return `Awaiting ${dayLabel} data`;
			let line: string;
			if (e.stock) {
				const n = net7(e.daily);
				line = n == null ? '7d change —' : `7d ${n < 0 ? '−' : '+'}${f(Math.abs(n))}`;
			} else {
				line = e.daily.avg7 == null ? '7d avg —' : `7d avg ${f(e.daily.avg7)}`;
			}
			return e.note ? `${line} · ${e.note}` : line;
		};

		// The focused period is the big number. A metric never borrows the other
		// period's number to avoid an empty card: under daily focus a pending day
		// shows "—" (with the banner saying why), and only a metric with no daily
		// row at all falls back to its week.
		const main = weeklyFocus
			? (e.weekly ? e.weekly.week : (e.daily?.day ?? null))
			: (e.daily ? e.daily.day : (e.weekly?.week ?? null));

		// The pinned row is a flat grid — four cards from four different sheet
		// groups would otherwise each get their own one-card section header — so the
		// group rides in the label instead ("Meta Ads · Leads", "Open Ronin · Instagram
		// Followers"). The table below keeps the groups as section headings.
		const scope = e.section.replace(/ \(weekly\)$/, '');
		const qualified =
			scope === 'Overview' || norm(e.label).includes(norm(scope))
				? e.label
				: `${scope} · ${e.label}`;

		return {
			key: e.key,
			defaultLabel: qualified,
			icon: e.icon,
			format: e.format,
			deltaTone: e.tone,
			...(e.daily ? { dailyPoint: () => e.daily as DailyPoint } : {}),
			...(e.weekly ? { point: () => e.weekly as MetricPoint } : {}),
			render: () => f(main),
			subtitle: bottom,
		};
	});
}

// ---------------------------------------------------------------------------
// View 2 — metric table (KPI | Daily | Δ daily | Weekly | Δ weekly | Bi-weekly)
// ---------------------------------------------------------------------------

export interface SheetRow {
	key: string;
	label: string;
	format: TileFormat;
	tone: 'normal' | 'inverted' | 'neutral';
	daily: DailyPoint | null;
	weekly: MetricPoint | null;
}

export interface SheetSection {
	title: string;
	/** True for the "<section> (weekly)" groups — their Daily cells are empty. */
	weeklyOnly: boolean;
	rows: SheetRow[];
}

export function buildSheetSections(opts: SheetCatalogOptions): SheetSection[] {
	const out: SheetSection[] = [];
	const index = new Map<string, number>();
	for (const e of collect(opts)) {
		let i = index.get(e.section);
		if (i === undefined) {
			i = out.length;
			index.set(e.section, i);
			out.push({ title: e.section, weeklyOnly: /\(weekly\)$/.test(e.section), rows: [] });
		}
		out[i].rows.push({
			key: e.key,
			label: e.label,
			format: e.format,
			tone: e.tone,
			daily: e.daily,
			weekly: e.weekly,
		});
	}
	return out;
}
