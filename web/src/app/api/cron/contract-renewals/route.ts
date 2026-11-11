// GET /api/cron/contract-renewals — Vercel Cron, daily (see web/vercel.json).
//
// Contract renewal alerts at 30 / 60 / 90 days out (BOT_ROSTER_SYNTHESIS
// Tier B #12). Reads v_client_analytics_contracts (renewal_on is computed
// there from starts_on + term), and writes one in-app notification per
// (recipient, contract, window) to every active admin/exec. There is no
// account-lead mapping in the schema yet, so the people who own contracts
// today are the recipients; when client ownership lands, swap the recipient
// query and nothing else changes.
//
// Idempotent through the deterministic dedupe key on (user_id, dedupe_key):
// a contract inside the 30-day window is told once for that window, not
// once per day. Service role is used on purpose: the job writes
// notifications for other people (0039), gated by CRON_SECRET.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { withCronRun } from '@/lib/cron/auth';
import { businessToday } from '@/lib/format';
import { CONTRACT_COLUMNS, mapContract, type ContractRow } from '@/lib/mcp/mappers/finance';
import { contractsToAlert, renewalCopy, renewalDedupeKey } from '@/lib/contracts/renewals';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
	return withCronRun(request, '/api/cron/contract-renewals', async () => {
		const supabase = createServiceRoleClient();
		const today = businessToday();

		const [{ data: rows, error }, { data: recipients, error: rErr }] = await Promise.all([
			supabase.from('v_client_analytics_contracts').select(CONTRACT_COLUMNS).eq('status', 'active').returns<ContractRow[]>(),
			supabase.from('profiles').select('id').in('role', ['admin', 'exec']).eq('is_active', true).returns<{ id: string }[]>(),
		]);
		if (error) {
			console.error('[cron/contract-renewals] contracts read failed:', error.message);
			return NextResponse.json({ error: 'Could not read contracts.' }, { status: 500 });
		}
		if (rErr) {
			console.error('[cron/contract-renewals] recipients read failed:', rErr.message);
			return NextResponse.json({ error: 'Could not read recipients.' }, { status: 500 });
		}

		const alerts = contractsToAlert((rows ?? []).map((r) => mapContract(r, today)));
		const userIds = (recipients ?? []).map((r) => r.id);
		if (alerts.length === 0 || userIds.length === 0) {
			return NextResponse.json({ today, alerts: alerts.length, recipients: userIds.length, sent: 0 });
		}

		const payload = alerts.flatMap(({ contract, window }) => {
			const { title, body } = renewalCopy(contract);
			return userIds.map((user_id) => ({
				user_id,
				kind: 'contract_renewal',
				title,
				body,
				href: contract.url ?? '/clients',
				dedupe_key: renewalDedupeKey(contract.id, window),
			}));
		});

		const { data: inserted, error: insertError } = await supabase
			.from('notifications')
			.upsert(payload, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
			.select('id');
		if (insertError) {
			console.error('[cron/contract-renewals] insert failed:', insertError.message);
			return NextResponse.json({ error: 'Could not write notifications.' }, { status: 500 });
		}

		const sent = inserted?.length ?? 0;
		return NextResponse.json({
			today,
			alerts: alerts.length,
			windows: { '30': alerts.filter((a) => a.window === '30').length, '60': alerts.filter((a) => a.window === '60').length, '90': alerts.filter((a) => a.window === '90').length },
			recipients: userIds.length,
			sent,
			already_told: payload.length - sent,
		});
	});
}
