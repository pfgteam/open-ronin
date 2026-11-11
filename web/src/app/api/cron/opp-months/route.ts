// GET /api/cron/opp-months — Vercel Cron, daily 08:40 UTC (before
// health-scores at 09:30; see web/vercel.json).
//
// Feeds the health score's opps_vs_goal factor (25% weight, "cited by six
// bots" in BOT_ROSTER_SYNTHESIS Tier A #2). compute_health_scores() (0046)
// reads client_opp_months for the current month and writes "opp counts not
// synced for period" when the row is missing. The importer that fills it
// (scripts/import-opp-months.ts) was last run by hand on 2026-08-24, so
// every September score has the factor unmeasured. This route is that
// importer as a daily job: same R3 counting rule, same name resolution, same
// explicit-zero window, pure aggregation in lib/health/oppMonths.ts.
//
// Airtable via the app's AIRTABLE_PAT (lib/data). Writes with the service
// role (client_opp_months_write is service-role only, 0046). Idempotent:
// upsert on (airtable_contract_id, month). Gated by CRON_SECRET.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { getAdapter, BASE_IDS } from '@/lib/data';
import { aggregateOppMonths, buildNameResolver, type OppRecord } from '@/lib/health/oppMonths';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const OPPS_TABLE = process.env.AIRTABLE_OPPS_TABLE ?? ''; // Client Media / Media Opportunities
// Opps' Client field links to Client Media's "Client Metrics" table (a
// client-month tracker), NOT its Contract Agreement (verified via the meta
// API 2026-08-24). Its Contoso formula carries the client name.
const CM_CLIENTS_TABLE = process.env.AIRTABLE_OPPS_CLIENTS_TABLE ?? '';
const CM_NAME_FIELD = 'Contoso';
const IN_SCOPE = new Set(['active', 'hold', '60-day']);

async function listAll<T extends Record<string, unknown>>(baseId: string, table: string, fields: string[]): Promise<Array<{ id: string; fields: T }>> {
	const adapter = getAdapter();
	const out: Array<{ id: string; fields: T }> = [];
	let cursor: string | undefined;
	do {
		const page = await adapter.list<T>(baseId, table, { fields, pageSize: 100, cursor, noCache: true });
		out.push(...page.rows);
		cursor = page.cursor;
	} while (cursor);
	return out;
}

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/opp-months', async () => {
		if (!process.env.AIRTABLE_PAT) {
			return NextResponse.json({ error: 'AIRTABLE_PAT is not set.' }, { status: 500 });
		}
		const supabase = createServiceRoleClient();

		const [{ data: clients, error: cErr }, { data: aliases }, { data: contracts, error: kErr }] = await Promise.all([
			supabase.from('clients_v2').select('id, display_name').returns<{ id: string; display_name: string }[]>(),
			supabase.from('client_aliases').select('client_id, raw_name').not('raw_name', 'is', null).returns<{ client_id: string; raw_name: string }[]>(),
			supabase.from('contracts').select('airtable_contract_id, client_id, status').returns<{ airtable_contract_id: string | null; client_id: string | null; status: string }[]>(),
		]);
		if (cErr || kErr) {
			console.error('[cron/opp-months] read failed:', cErr?.message ?? kErr?.message);
			return NextResponse.json({ error: 'Could not read clients or contracts.' }, { status: 500 });
		}
		const resolveName = buildNameResolver(clients ?? [], aliases ?? []);
		const contractsByClient = new Map<string, string[]>();
		for (const c of contracts ?? []) {
			if (!IN_SCOPE.has(c.status) || !c.airtable_contract_id || !c.client_id) continue;
			if (!contractsByClient.has(c.client_id)) contractsByClient.set(c.client_id, []);
			contractsByClient.get(c.client_id)!.push(c.airtable_contract_id);
		}

		let oppRecords: OppRecord[];
		try {
			const cmClients = await listAll<Record<string, unknown>>(BASE_IDS.CLIENT_MEDIA, CM_CLIENTS_TABLE, [CM_NAME_FIELD]);
			const cmName = new Map(cmClients.map((r) => [r.id, String(r.fields[CM_NAME_FIELD] ?? '').trim()]));
			const opps = await listAll<Record<string, unknown>>(BASE_IDS.CLIENT_MEDIA, OPPS_TABLE, [
				'Status', 'Client', 'Date Sent to Client', 'Date Secured', 'Date Added', 'Live Link', 'Live Date',
			]);
			oppRecords = opps.map((o) => {
				const link = o.fields['Client'];
				const cmId = Array.isArray(link) && link.length >= 1 ? String(link[0]) : null;
				const str = (k: string) => (typeof o.fields[k] === 'string' ? (o.fields[k] as string) : undefined);
				return {
					status: String(o.fields['Status'] ?? ''),
					clientName: cmId ? cmName.get(cmId) || null : null,
					dateSent: str('Date Sent to Client'),
					dateSecured: str('Date Secured'),
					dateAdded: str('Date Added'),
					liveLink: str('Live Link'),
					liveDate: str('Live Date'),
				};
			});
		} catch (e) {
			console.error('[cron/opp-months] Airtable read failed:', e instanceof Error ? e.message : e);
			return NextResponse.json({ error: 'Airtable read failed.' }, { status: 502 });
		}

		const agg = aggregateOppMonths(oppRecords, resolveName, contractsByClient, new Date());
		let written = 0;
		for (let i = 0; i < agg.rows.length; i += 500) {
			const { error } = await supabase.from('client_opp_months').upsert(agg.rows.slice(i, i + 500), { onConflict: 'airtable_contract_id,month' });
			if (error) {
				console.error('[cron/opp-months] upsert failed:', error.message);
				return NextResponse.json({ error: 'client_opp_months upsert failed.', written }, { status: 500 });
			}
			written += Math.min(500, agg.rows.length - i);
		}
		return NextResponse.json({
			ok: true,
			opp_rows: oppRecords.length,
			contracts_in_scope: [...contractsByClient.values()].filter((v) => v.length === 1).length,
			month_rows_written: written,
			skipped: agg.skipped,
			unresolved_names: agg.unresolved_names,
			secured_month_basis: agg.secured_month_basis,
		});
	});
}
