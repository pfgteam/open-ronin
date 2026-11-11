'use server';

// Server actions for /data/spreadsheets. sheet_sources is admin write by RLS
// (0001: sheet_sources_write_admin); the actions check the same gate up
// front so the person gets a sentence instead of a policy error, and the
// sync itself runs with the service role because sheet_snapshots has no
// insert policy for users (read only, the sync writes).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { isElevatedRole } from '@/lib/permissions/constants';
import { getSpreadsheetMeta, parseSpreadsheetId } from '@/lib/sheets/client';
import { syncSource, syncSources, type SheetSourceRow } from '@/lib/sheets/sync';

const PATH = '/data/spreadsheets';

export interface ActionResult {
	ok: boolean;
	message: string;
}

async function requireAdmin() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error('Not signed in.');
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
	if (!isElevatedRole(profile?.role)) throw new Error('Only admins and execs can manage connected sheets.');
	return { supabase, user };
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

const SOURCE_COLUMNS =
	'id, google_sheet_id, display_name, tabs, sync_interval_minutes, last_synced_at, last_sync_status, last_sync_error';

/** Sync now for one source. */
export async function syncSourceAction(sourceId: string): Promise<ActionResult> {
	try {
		const { supabase, user } = await requireAdmin();
		const id = z.string().uuid().parse(sourceId);
		const { data, error } = await supabase.from('sheet_sources').select(SOURCE_COLUMNS).eq('id', id).maybeSingle();
		if (error || !data) return { ok: false, message: 'That sheet is not connected any more.' };
		const result = await syncSource(data as SheetSourceRow);
		await recordAudit({
			actor_id: user.id,
			entity_kind: 'supabase',
			entity_ref: `sheet_sources:${id}`,
			action: 'sheet_sync',
			diff: result,
			status: result.status === 'error' ? 'error' : 'success',
		});
		revalidatePath(PATH);
		revalidatePath('/data/sheets');
		const rows = result.tabs.reduce((n, t) => n + t.rows, 0);
		const changed = result.tabs.reduce((n, t) => n + t.changed, 0);
		if (result.status === 'error') return { ok: false, message: result.error ?? 'Sync failed.' };
		return {
			ok: true,
			message:
				result.status === 'partial'
					? `Synced with errors: ${result.error}`
					: `Synced ${rows} rows, ${changed} changed.`,
		};
	} catch (e) {
		return { ok: false, message: message(e) };
	}
}

/** Sync every source regardless of its interval. */
export async function syncAllAction(): Promise<ActionResult> {
	try {
		const { user } = await requireAdmin();
		const results = await syncSources({ onlyDue: false });
		await recordAudit({
			actor_id: user.id,
			entity_kind: 'supabase',
			entity_ref: 'sheet_sources:*',
			action: 'sheet_sync_all',
			diff: results.map((r) => ({ sourceId: r.sourceId, status: r.status, error: r.error })),
		});
		revalidatePath(PATH);
		revalidatePath('/data/sheets');
		const failed = results.filter((r) => r.status !== 'ok');
		return failed.length === 0
			? { ok: true, message: `Synced ${results.length} sheets.` }
			: { ok: false, message: `${failed.length} of ${results.length} sheets reported a problem; see the rows.` };
	} catch (e) {
		return { ok: false, message: message(e) };
	}
}

const AddInput = z.object({
	url: z.string().trim().min(1, 'Paste a Google Sheets URL.').max(500),
	interval: z.coerce.number().int().min(5).max(1440).default(30),
});

/**
 * Connect a sheet by URL. Reads the title and tab list from Google first, so
 * a sheet that is not shared with the service account is refused with the
 * share instruction instead of being saved and failing every sync after.
 * Tabs are stored empty, meaning "every tab"; the row can be narrowed later.
 */
export async function addSourceAction(formData: FormData): Promise<ActionResult> {
	try {
		const { supabase, user } = await requireAdmin();
		const parsed = AddInput.safeParse({
			url: formData.get('url'),
			interval: formData.get('interval') || undefined,
		});
		if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
		const sheetId = parseSpreadsheetId(parsed.data.url);
		if (!sheetId) return { ok: false, message: 'That does not look like a Google Sheets URL or id.' };

		const { data: existing } = await supabase
			.from('sheet_sources')
			.select('id, display_name')
			.eq('google_sheet_id', sheetId)
			.maybeSingle();
		if (existing) return { ok: false, message: `Already connected as "${existing.display_name}".` };

		const meta = await getSpreadsheetMeta(sheetId);
		const { data, error } = await supabase
			.from('sheet_sources')
			.insert({
				google_sheet_id: sheetId,
				display_name: meta.title,
				tabs: meta.tabs.map((t) => t.title),
				sync_interval_minutes: parsed.data.interval,
			})
			.select(SOURCE_COLUMNS)
			.single();
		if (error) return { ok: false, message: `Could not save the sheet: ${error.message}` };

		await recordAudit({
			actor_id: user.id,
			entity_kind: 'supabase',
			entity_ref: `sheet_sources:${data.id}`,
			action: 'sheet_source_add',
			diff: { google_sheet_id: sheetId, display_name: meta.title, tabs: meta.tabs.length },
		});
		// First snapshot right away so the Snapshots tab has something to show.
		const result = await syncSource(data as SheetSourceRow);
		revalidatePath(PATH);
		revalidatePath('/data/sheets');
		return result.status === 'error'
			? { ok: false, message: `Connected "${meta.title}" but the first sync failed: ${result.error}` }
			: { ok: true, message: `Connected "${meta.title}" (${meta.tabs.length} tabs) and took the first snapshot.` };
	} catch (e) {
		return { ok: false, message: message(e) };
	}
}

/** Disconnect a sheet; its snapshots go with it (on delete cascade, 0001). */
export async function removeSourceAction(sourceId: string): Promise<ActionResult> {
	try {
		const { supabase, user } = await requireAdmin();
		const id = z.string().uuid().parse(sourceId);
		const { data: row } = await supabase.from('sheet_sources').select('display_name').eq('id', id).maybeSingle();
		const { error } = await supabase.from('sheet_sources').delete().eq('id', id);
		if (error) return { ok: false, message: `Could not disconnect: ${error.message}` };
		await recordAudit({
			actor_id: user.id,
			entity_kind: 'supabase',
			entity_ref: `sheet_sources:${id}`,
			action: 'sheet_source_remove',
			diff: { display_name: row?.display_name ?? null },
		});
		revalidatePath(PATH);
		revalidatePath('/data/sheets');
		return { ok: true, message: `Disconnected "${row?.display_name ?? 'sheet'}".` };
	} catch (e) {
		return { ok: false, message: message(e) };
	}
}
