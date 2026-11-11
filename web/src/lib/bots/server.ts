// Server-side readers for /admin/bots. Every table is admin-read under RLS
// (0112); the page also checks role for the readable refusal.

import { createClient } from '@/lib/supabase/server';
import { catalogOrFallback, type BotConsumer, type BotRow, type FleetCatalog } from './shared';

export type BotsPageData =
	| { applied: false }
	| {
			applied: true;
			bots: BotRow[];
			consumers: BotConsumer[];
			catalog: FleetCatalog;
			lastSync: { host: string; at: string; hermes_version?: string; profile_count?: number } | null;
			pending: number;
	  };

const NOT_APPLIED_RE = /bot_profiles|bot_fleet_state|does not exist|schema cache/i;

export async function loadBotsPage(): Promise<BotsPageData> {
	const supabase = await createClient();
	const [botsRes, stateRes, consumersRes, pendingRes] = await Promise.all([
		supabase
			.from('bot_profiles')
			.select(
				'id, name, display_name, role_description, desired, desired_updated_at, observed, observed_at, gateway_running, mcp_consumer_slug, spine_identity_slug, status, last_error, updated_at',
			)
			.order('name'),
		supabase.from('bot_fleet_state').select('key, value'),
		supabase.from('mcp_consumers').select('slug, name, scopes, identity_slug, last_used_at').is('revoked_at', null).order('slug'),
		supabase.from('bot_provision_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
	]);

	if (botsRes.error && NOT_APPLIED_RE.test(botsRes.error.message)) return { applied: false };
	if (botsRes.error) throw new Error(botsRes.error.message);

	const state = new Map<string, unknown>((stateRes.data ?? []).map((r) => [r.key as string, r.value]));
	const sync = state.get('last_sync') as BotsPageData extends { lastSync: infer T } ? T : never;

	return {
		applied: true,
		bots: (botsRes.data ?? []) as BotRow[],
		consumers: (consumersRes.data ?? []) as BotConsumer[],
		catalog: catalogOrFallback(state.get('catalog')),
		lastSync: sync && typeof sync === 'object' && 'at' in sync ? sync : null,
		pending: pendingRes.count ?? 0,
	};
}
