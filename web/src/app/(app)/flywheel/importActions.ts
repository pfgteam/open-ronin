'use server';

// Flywheel F8 actions (0149): import a Sheets tracker tab (or a pasted CSV)
// into fw_pages / fw_citations with a review list for unmatched rows.
// Preview never writes pages / citations; apply re-reads the source and
// re-plans server side (the client's preview is display only).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { FLYWHEEL_PATH } from '@/lib/flywheel/shared';
import { spreadsheetIdFrom, summarizePlan, type ImportPlan, type PreviewPayload } from '@/lib/flywheel/import';
import { applyPlan, csvToSource, listTrackerTabs, loadPlanContext, planTracker, readSheetTab, type ApplyCounts, type TrackerSource } from '@/lib/flywheel/importServer';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

function toPayload(src: TrackerSource, plan: ImportPlan): PreviewPayload {
	return {
		summary: summarizePlan(plan),
		headers: src.headers,
		mapping: Object.fromEntries(Object.entries(plan.header.mapping).filter(([, v]) => v != null)) as Record<string, number>,
		unknown: plan.header.unknown,
		missing: plan.header.missing,
		pages: plan.pages.map((p) => ({ row: p.row_number, cluster_id: p.cluster_id, number: p.number, keyword: p.keyword, status: p.status, url: p.live_url, update: Boolean(p.existing_id) })),
		citations: plan.citations.map((c) => ({ row: c.row_number, channel: c.channel_key, status: c.status, url: c.url, keyword: c.keyword, page_known: Boolean(c.page_id || c.page_import_ref) })),
		review: plan.review.map((r) => ({ row: r.row_number, reason: r.reason })),
		blank: plan.blank,
		source: { kind: src.kind, title: src.kind === 'sheets' ? `${src.spreadsheetId} · ${src.tab}` : src.fileName || 'pasted CSV' },
	};
}

const SourceInput = z.object({
	program_id: uuid,
	source_kind: z.enum(['sheets', 'csv']),
	sheet: z.string().trim().max(400).optional(),
	tab: z.string().trim().max(120).optional(),
	csv: z.string().max(2_000_000).optional(),
	file_name: z.string().trim().max(160).optional(),
	mode: z.enum(['preview', 'apply']).default('preview'),
});

export async function listTabs(formData: FormData): Promise<Result<{ title: string; tabs: string[] }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const sheet = String(formData.get('sheet') ?? '');
	const id = spreadsheetIdFrom(sheet);
	if (!id) return { ok: false, error: 'Paste the Google Sheet URL or its id.' };
	try {
		const meta = await listTrackerTabs(id);
		return { ok: true, ...meta };
	} catch (e) {
		return { ok: false, error: readable(e) };
	}
}

export async function importTracker(formData: FormData): Promise<Result<{ preview: PreviewPayload; applied: ApplyCounts | null; batch_id: string }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const parsed = SourceInput.safeParse(Object.fromEntries(formData));
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const d = parsed.data;
	const supabase = await createClient();

	// The batch row first (RLS: module circle), so a CSV has an id for its import_ref prefix.
	const { data: batch, error: bErr } = await supabase
		.from('fw_import_batches')
		.insert({ program_id: d.program_id, source_kind: d.source_kind, mode: d.mode, file_name: d.source_kind === 'csv' ? d.file_name || null : null, created_by: profile.id })
		.select('id')
		.single();
	if (bErr) return { ok: false, error: friendly(bErr.message) };
	const batchId = (batch as { id: string }).id;

	let src: TrackerSource;
	try {
		if (d.source_kind === 'sheets') {
			const id = spreadsheetIdFrom(d.sheet ?? '');
			if (!id) return { ok: false, error: 'Paste the Google Sheet URL or its id.' };
			if (!d.tab) return { ok: false, error: 'Pick the tab to import.' };
			src = await readSheetTab(id, d.tab);
		} else {
			if (!d.csv || d.csv.trim().length === 0) return { ok: false, error: 'Paste the CSV (header row first).' };
			src = csvToSource(d.csv, d.file_name || null, batchId);
		}
	} catch (e) {
		await supabase.from('fw_import_batches').update({ counts: { error: readable(e) } }).eq('id', batchId);
		return { ok: false, error: readable(e) };
	}

	let plan: ImportPlan;
	try {
		const ctx = await loadPlanContext(supabase, d.program_id);
		plan = planTracker(src, ctx);
	} catch (e) {
		return { ok: false, error: readable(e) };
	}
	if (src.rows.length === 0) return { ok: false, error: 'The tab has a header row and no data rows.' };
	if (plan.header.missing.length) {
		await supabase.from('fw_import_batches').update({ spreadsheet_id: src.kind === 'sheets' ? src.spreadsheetId : null, tab: src.tab, header: src.headers, mapping: plan.header.mapping, unknown_headers: plan.header.unknown, counts: { rows: src.rows.length, error: 'no url / asset type column' } }).eq('id', batchId);
		return { ok: false, error: `No column for the asset URL or type was recognised in the header (${src.headers.filter(Boolean).join(', ')}). Rename the column in the sheet or add a "URL" header; nothing was written.` };
	}

	let applied: ApplyCounts | null = null;
	if (d.mode === 'apply') {
		try {
			applied = await applyPlan(supabase, d.program_id, batchId, plan, profile.id);
		} catch (e) {
			await supabase.from('fw_import_batches').update({ counts: { error: readable(e) } }).eq('id', batchId);
			return { ok: false, error: friendly(readable(e)) };
		}
	}
	await supabase
		.from('fw_import_batches')
		.update({
			spreadsheet_id: src.kind === 'sheets' ? src.spreadsheetId : null,
			tab: src.tab,
			header: src.headers,
			mapping: plan.header.mapping,
			unknown_headers: plan.header.unknown,
			counts: applied ?? { rows: src.rows.length, pages: plan.pages.length, citations: plan.citations.length, review: plan.review.length, blank: plan.blank },
		})
		.eq('id', batchId);
	if (applied) {
		await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `fw_import_batches:${batchId}`, action: 'flywheel.import.apply', diff: { program_id: d.program_id, source: src.kind, tab: src.tab, ...applied } });
		revalidatePath(`${FLYWHEEL_PATH}/${d.program_id}`, 'layout');
	}
	return { ok: true, preview: toPayload(src, plan), applied, batch_id: batchId };
}

export async function setReviewRowStatus(formData: FormData): Promise<Result> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	const p = z.object({ id: uuid, program_id: uuid, status: z.enum(['unmatched', 'ignored']) }).safeParse(Object.fromEntries(formData));
	if (!p.success) return { ok: false, error: 'Invalid input.' };
	const supabase = await createClient();
	const patch = p.data.status === 'ignored' ? { status: 'ignored', resolved_by: profile.id, resolved_at: new Date().toISOString() } : { status: 'unmatched', resolved_by: null, resolved_at: null };
	const { error } = await supabase.from('fw_import_rows').update(patch).eq('id', p.data.id);
	if (error) return { ok: false, error: friendly(error.message) };
	revalidatePath(`${FLYWHEEL_PATH}/${p.data.program_id}`, 'layout');
	return { ok: true };
}

function readable(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function friendly(m: string) {
	if (m.includes('row-level security')) return 'Not allowed: you do not hold the permission for this write.';
	if (m.includes('fw_import_batches') && m.includes('does not exist')) return 'Migration 0149 is not applied yet.';
	return m;
}
