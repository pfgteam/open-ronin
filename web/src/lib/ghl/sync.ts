// Server-side sync helpers for GHL data into our mirror tables.
// Called from server actions (admin UI) and scheduled jobs.

import { createServiceRoleClient } from '@/lib/supabase/server';
import { ghlFetch, getActiveAccessToken } from './client';

export interface SyncStats {
	resource: string;
	connectionId: string;
	locationId: string | null;
	fetched: number;
	upserted: number;
	error?: string;
}

interface GhlLocationListItem {
	id: string;
	name?: string;
	business?: { name?: string };
	address?: string;
	city?: string;
	state?: string;
	country?: string;
	email?: string;
	phone?: string;
	website?: string;
	timezone?: string;
	companyId?: string;
}

interface GhlContact {
	id: string;
	firstName?: string;
	lastName?: string;
	contactName?: string;
	email?: string;
	phone?: string;
	companyName?: string;
	type?: string;
	source?: string;
	tags?: string[];
	dateAdded?: string;
	lastActivity?: string;
	customFields?: { id: string; value: unknown }[] | Record<string, unknown>;
	assignedTo?: string;
	locationId?: string;
}

interface GhlOpportunity {
	id: string;
	name?: string;
	status?: string;
	monetaryValue?: number;
	source?: string;
	pipelineId?: string;
	pipelineStageId?: string;
	contact?: { id?: string };
	contactId?: string;
	assignedTo?: string;
	createdAt?: string;
	updatedAt?: string;
	closedAt?: string;
	locationId?: string;
}

async function recordSyncState(
	connectionId: string,
	resource: string,
	locationId: string | null,
	patch: Partial<{ status: string; last_count: number; last_error: string | null; last_synced_at: string; last_cursor: string | null }>,
): Promise<void> {
	const sb = createServiceRoleClient();
	await sb.from('ghl_sync_state').upsert(
		{
			connection_id: connectionId,
			resource,
			ghl_location_id: locationId,
			...patch,
		},
		{ onConflict: 'connection_id,resource,ghl_location_id' },
	);
}

/**
 * Sync the list of sub-accounts (Locations) visible to this connection.
 * Only valid for company-scoped installs (location-scoped already knows its
 * single location).
 */
export async function syncLocations(connectionId: string): Promise<SyncStats> {
	const stats: SyncStats = { resource: 'locations', connectionId, locationId: null, fetched: 0, upserted: 0 };
	try {
		await recordSyncState(connectionId, 'locations', null, { status: 'running', last_error: null });
		const conn = await getActiveAccessToken(connectionId);
		if (conn.scope !== 'company') {
			// Single-location install - just upsert the one location it represents
			if (conn.locationId) {
				const loc = await ghlFetch<{ location?: GhlLocationListItem }>(connectionId, '/locations/' + conn.locationId);
				if (loc.location) {
					await upsertLocation(connectionId, loc.location, conn.label);
					stats.fetched = 1;
					stats.upserted = 1;
				}
			}
		} else {
			const data = await ghlFetch<{ locations?: GhlLocationListItem[] }>(connectionId, '/locations/search?companyId=' + (conn.companyId ?? '') + '&limit=500');
			for (const loc of data.locations ?? []) {
				await upsertLocation(connectionId, loc, conn.label);
				stats.fetched++;
				stats.upserted++;
			}
		}
		await recordSyncState(connectionId, 'locations', null, {
			status: 'idle',
			last_synced_at: new Date().toISOString(),
			last_count: stats.upserted,
			last_error: null,
		});
		return stats;
	} catch (e) {
		stats.error = (e as Error).message;
		await recordSyncState(connectionId, 'locations', null, { status: 'error', last_error: stats.error });
		return stats;
	}
}

async function upsertLocation(connectionId: string, loc: GhlLocationListItem, label: string | null): Promise<void> {
	const sb = createServiceRoleClient();
	await sb.from('ghl_locations').upsert(
		{
			ghl_location_id: loc.id,
			ghl_company_id: loc.companyId ?? null,
			name: loc.name ?? '(unnamed)',
			business_name: loc.business?.name ?? null,
			address: loc.address ?? null,
			city: loc.city ?? null,
			state: loc.state ?? null,
			country: loc.country ?? null,
			email: loc.email ?? null,
			phone: loc.phone ?? null,
			website: loc.website ?? null,
			timezone: loc.timezone ?? null,
			source_connection_id: connectionId,
			label,
			active: true,
			raw: loc as unknown as Record<string, unknown>,
			fetched_at: new Date().toISOString(),
		},
		{ onConflict: 'ghl_location_id' },
	);
}

/**
 * Sync contacts for a single location. GHL's contact search API is paginated
 * via a startAfter cursor.
 */
export async function syncContacts(connectionId: string, locationId: string, limit = 500): Promise<SyncStats> {
	const stats: SyncStats = { resource: 'contacts', connectionId, locationId, fetched: 0, upserted: 0 };
	try {
		await recordSyncState(connectionId, 'contacts', locationId, { status: 'running', last_error: null });

		let cursor: string | null = null;
		let safetyCounter = 0;
		while (safetyCounter++ < 200) {
			const url: string = '/contacts/search?locationId=' + locationId + '&limit=' + limit + (cursor ? '&startAfter=' + encodeURIComponent(cursor) : '');
			const data: { contacts?: GhlContact[]; meta?: { startAfter?: string; nextPageUrl?: string } } =
				await ghlFetch<{ contacts?: GhlContact[]; meta?: { startAfter?: string; nextPageUrl?: string } }>(connectionId, url);
			const batch = data.contacts ?? [];
			for (const c of batch) {
				await upsertContact(locationId, c);
				stats.upserted++;
			}
			stats.fetched += batch.length;
			if (batch.length < limit) break;
			cursor = data.meta?.startAfter ?? null;
			if (!cursor) break;
		}

		await recordSyncState(connectionId, 'contacts', locationId, {
			status: 'idle',
			last_synced_at: new Date().toISOString(),
			last_count: stats.upserted,
			last_error: null,
		});
		return stats;
	} catch (e) {
		stats.error = (e as Error).message;
		await recordSyncState(connectionId, 'contacts', locationId, { status: 'error', last_error: stats.error });
		return stats;
	}
}

async function upsertContact(locationId: string, c: GhlContact): Promise<void> {
	const sb = createServiceRoleClient();
	const full = c.contactName ?? [c.firstName, c.lastName].filter(Boolean).join(' ');
	let customFields: Record<string, unknown> = {};
	if (Array.isArray(c.customFields)) {
		for (const f of c.customFields) customFields[f.id] = f.value;
	} else if (c.customFields && typeof c.customFields === 'object') {
		customFields = c.customFields as Record<string, unknown>;
	}
	await sb.from('ghl_contacts').upsert(
		{
			ghl_contact_id: c.id,
			ghl_location_id: locationId,
			first_name: c.firstName ?? null,
			last_name: c.lastName ?? null,
			full_name: full || null,
			email: c.email ?? null,
			phone: c.phone ?? null,
			company_name: c.companyName ?? null,
			type: c.type ?? null,
			source: c.source ?? null,
			tags: c.tags ?? [],
			date_added: c.dateAdded ?? null,
			last_activity: c.lastActivity ?? null,
			custom_fields: customFields,
			assigned_user_id: c.assignedTo ?? null,
			raw: c as unknown as Record<string, unknown>,
			fetched_at: new Date().toISOString(),
		},
		{ onConflict: 'ghl_location_id,ghl_contact_id' },
	);
}

/**
 * Sync opportunities for a location.
 */
export async function syncOpportunities(connectionId: string, locationId: string, limit = 200): Promise<SyncStats> {
	const stats: SyncStats = { resource: 'opportunities', connectionId, locationId, fetched: 0, upserted: 0 };
	try {
		await recordSyncState(connectionId, 'opportunities', locationId, { status: 'running', last_error: null });

		let page = 1;
		let safetyCounter = 0;
		while (safetyCounter++ < 100) {
			const url = '/opportunities/search?location_id=' + locationId + '&limit=' + limit + '&page=' + page;
			const data = await ghlFetch<{ opportunities?: GhlOpportunity[]; meta?: { total?: number; nextPage?: number | null } }>(connectionId, url);
			const batch = data.opportunities ?? [];
			for (const o of batch) {
				await upsertOpportunity(locationId, o);
				stats.upserted++;
			}
			stats.fetched += batch.length;
			if (batch.length < limit) break;
			const next = data.meta?.nextPage;
			if (next == null) break;
			page = next;
		}

		await recordSyncState(connectionId, 'opportunities', locationId, {
			status: 'idle',
			last_synced_at: new Date().toISOString(),
			last_count: stats.upserted,
			last_error: null,
		});
		return stats;
	} catch (e) {
		stats.error = (e as Error).message;
		await recordSyncState(connectionId, 'opportunities', locationId, { status: 'error', last_error: stats.error });
		return stats;
	}
}

async function upsertOpportunity(locationId: string, o: GhlOpportunity): Promise<void> {
	const sb = createServiceRoleClient();
	await sb.from('ghl_opportunities').upsert(
		{
			ghl_opportunity_id: o.id,
			ghl_location_id: locationId,
			ghl_pipeline_id: o.pipelineId ?? null,
			ghl_pipeline_stage_id: o.pipelineStageId ?? null,
			ghl_contact_id: o.contact?.id ?? o.contactId ?? null,
			name: o.name ?? null,
			status: o.status ?? null,
			monetary_value: o.monetaryValue ?? null,
			source: o.source ?? null,
			assigned_user_id: o.assignedTo ?? null,
			created_at: o.createdAt ?? null,
			updated_at: o.updatedAt ?? null,
			closed_at: o.closedAt ?? null,
			raw: o as unknown as Record<string, unknown>,
			fetched_at: new Date().toISOString(),
		},
		{ onConflict: 'ghl_location_id,ghl_opportunity_id' },
	);
}
