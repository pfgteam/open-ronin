// Row model for a client's Media Opportunities in one month. Pure: takes the
// Airtable records the server loader fetched and groups them by the R3 stage
// (lib/media/status.ts is the ONE counting rule — nothing here re-tests a
// status token). Live is a property of the row (Live Link non-empty), never
// read from Status.

import type { DataRecord } from '@/lib/data';
import { isLive, type MediaStage, stageOf } from '@/lib/media/status';

export interface OppFields {
	'Media Opp'?: string;
	Outlet?: string;
	'Outlet URL'?: string;
	Reach?: number;
	'Live Date'?: string;
	'Live Link'?: string;
	'Date Secured'?: string;
	'Date Sent to Client'?: string;
	'Date Added'?: string;
	Status?: string;
	'Media Tier'?: string;
	'Secured By'?: string;
	/** The REST API returns multipleRecordLinks as record ids, not objects. */
	Client?: string[];
}

/** Exactly the fields the tab renders — a narrower read is a faster read. */
export const OPP_FIELDS: string[] = [
	'Media Opp', 'Outlet', 'Outlet URL', 'Reach', 'Live Date', 'Live Link',
	'Date Secured', 'Date Sent to Client', 'Date Added', 'Status', 'Media Tier', 'Secured By', 'Client',
];

export interface OppRow {
	id: string;
	outlet: string;
	title: string;
	status: string;
	stage: MediaStage;
	live: boolean;
	liveLink: string | null;
	dateSecured: string | null;
	liveDate: string | null;
	tier: string | null;
	securedBy: string | null;
	reach: number | null;
}

/** Display order of the stage groups; every key is always rendered. */
export const STAGE_ORDER: MediaStage[] = ['secured', 'pitched', 'client_lost', 'media_lost', 'unmapped'];

export function toOppRow(r: DataRecord<OppFields>): OppRow {
	const f = r.fields;
	const outlet = f.Outlet?.trim() || f['Media Opp']?.trim() || '—';
	return {
		id: r.id,
		outlet,
		title: f['Media Opp']?.trim() ?? outlet,
		status: f.Status?.trim() ?? '',
		stage: stageOf(f.Status),
		live: isLive(f['Live Link']),
		liveLink: f['Live Link']?.trim() || null,
		dateSecured: f['Date Secured'] ?? null,
		liveDate: f['Live Date'] ?? null,
		tier: f['Media Tier'] ?? null,
		securedBy: f['Secured By'] ?? null,
		reach: typeof f.Reach === 'number' ? f.Reach : null,
	};
}

/** The native table's columns the tab reads (0116). */
export interface NativeOppRow {
	id: string;
	airtable_record_id: string | null;
	title: string | null;
	outlet_name: string | null;
	status_raw: string | null;
	live_link: string | null;
	date_secured: string | null;
	live_date: string | null;
	media_tier: string | null;
	secured_by: string | null;
	reach: number | null;
}

export const NATIVE_OPP_SELECT = 'id, airtable_record_id, title, outlet_name, status_raw, live_link, date_secured, live_date, media_tier, secured_by, reach';

/** Same row model from a media_opportunities row; id stays the Airtable rec id where known so links do not change. */
export function nativeToOppRow(r: NativeOppRow): OppRow {
	const outlet = r.outlet_name?.trim() || r.title?.trim() || '—';
	return {
		id: r.airtable_record_id ?? r.id,
		outlet,
		title: r.title?.trim() ?? outlet,
		status: r.status_raw?.trim() ?? '',
		stage: stageOf(r.status_raw ?? undefined),
		live: isLive(r.live_link ?? undefined),
		liveLink: r.live_link?.trim() || null,
		dateSecured: r.date_secured,
		liveDate: r.live_date,
		tier: r.media_tier,
		securedBy: r.secured_by,
		reach: r.reach,
	};
}

/** First and last day of a `YYYY-MM` as ISO dates, for a range filter on the native table. */
export function monthBounds(month: string): { from: string; to: string } {
	const [y, m] = month.split('-').map(Number);
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function groupOpps(rows: OppRow[]): Record<MediaStage, OppRow[]> {
	const g: Record<MediaStage, OppRow[]> = { secured: [], pitched: [], client_lost: [], media_lost: [], unmapped: [] };
	for (const r of rows) g[r.stage].push(r);
	return g;
}

/**
 * filterByFormula for one client's month. Name match is the same FIND over
 * the Client link's primary field the Overview's "Recent media" block uses —
 * Client Media's opps link to its own Client Metrics table, so there is no
 * id to join on. The month matches on any of the three dates the mirror's
 * importer keys by, so the list and the KPI count the same rows as closely
 * as a name match allows.
 */
export function oppsFormula(clientName: string, month: string): string {
	const name = clientName.replace(/"/g, '\\"');
	const on = (field: string) => `DATETIME_FORMAT({${field}}, 'YYYY-MM') = '${month}'`;
	return `AND(FIND("${name}", ARRAYJOIN({Client})) > 0, OR(${on('Date Sent to Client')}, ${on('Date Secured')}, ${on('Live Date')}))`;
}

/** "Top Tier" → "Top"; the column header already says Tier. */
export function tierLabel(tier: string | null): string {
	return tier ? tier.replace(/\s*Tier\s*$/i, '') : '—';
}

export function sumReach(rows: OppRow[]): number {
	return rows.reduce((s, r) => s + (r.live && r.reach ? r.reach : 0), 0);
}
