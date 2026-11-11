'use server';

// Server actions for the Data Imports wizard. The batch and row trail is
// written through the caller's session (RLS: can_import_data(), 0068); the
// target tables are written with the service role after the same gate is
// checked here, because their own policies are admin only (0002) and a
// grantee is not always an admin. See the 0068 header.
//
// The file is parsed on every step that needs rows (dry run, commit) from
// the copy in the imports bucket, never from the browser, so a refresh or a
// second device continues the same batch. Rows are processed in chunks of
// CHUNK_SIZE per call; the client loops until progress reaches row_count.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceRoleClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { recordAudit } from '@/lib/audit';
import { getAdapter } from '@/lib/data';
import type { FieldSchema } from '@/lib/data/adapter';
import { isCsvName, isXlsxName, parseCsv, toCsv, type ParsedFile } from '@/lib/imports/parse';
import { parseXlsx } from '@/lib/imports/xlsx';
import { MEDIA_OPPS_SOURCE, pullHeaders, pullPages, rowsToCsv, type PullState, type SourceSpec } from '@/lib/imports/airtablePull';
import { autoMatch, missingRequired } from '@/lib/imports/match';
import {
	applyAirtable,
	applySupabase,
	columnsForTarget,
	planAirtable,
	planSupabase,
	revertAirtable,
	revertSupabase,
	verifyAirtable,
	verifySupabase,
	type Drift,
} from '@/lib/imports/engine';
import { CHUNK_SIZE, TARGET_KEYS, type BatchRow, type Mapping, type PlannedRow, type TargetKey } from '@/lib/imports/types';
import { explainAndLog } from '@/lib/errors';

const PATH = '/data/imports';
const BUCKET = 'imports';
const MAX_BYTES = 25 * 1024 * 1024;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function gate(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Not signed in.' };
	if (!(await hasCapability('import_data'))) return { ok: false, error: 'You do not have the import_data capability.' };
	return { ok: true, userId: profile.id };
}

async function loadBatch(id: string): Promise<BatchRow | null> {
	const supabase = await createClient();
	const { data } = await supabase.from('import_batches').select('*').eq('id', id).maybeSingle();
	return (data as BatchRow | null) ?? null;
}

async function setBatch(id: string, patch: Partial<BatchRow>): Promise<string | null> {
	const supabase = await createClient();
	const { error } = await supabase.from('import_batches').update(patch).eq('id', id);
	return error ? error.message : null;
}

async function readFile(batch: BatchRow): Promise<ParsedFile> {
	if (!batch.file_path) throw new Error('This batch has no file.');
	const svc = createServiceRoleClient();
	const { data, error } = await svc.storage.from(BUCKET).download(batch.file_path);
	if (error || !data) throw new Error(`Could not read the uploaded file: ${error?.message ?? 'no data'}`);
	const buffer = await data.arrayBuffer();
	if (isXlsxName(batch.file_name ?? '')) {
		return parseXlsx(buffer, { sheet: typeof batch.options.sheet === 'string' ? batch.options.sheet : undefined });
	}
	return parseCsv(new TextDecoder('utf-8').decode(buffer));
}

async function airtableFields(targetRef: string | null): Promise<FieldSchema[]> {
	const i = (targetRef ?? '').indexOf('/');
	if (i < 1) return [];
	const base = await getAdapter().getBaseSchema(targetRef!.slice(0, i));
	const name = targetRef!.slice(i + 1);
	const table = base.tables.find((t) => t.id === name || t.name === name);
	return table?.fields ?? [];
}

// ============================================================================
// Step 1: upload
// ============================================================================

export async function createBatchFromUpload(formData: FormData): Promise<Result<{ id: string }>> {
	const g = await gate();
	if (!g.ok) return g;

	const file = formData.get('file');
	if (!(file instanceof File)) return { ok: false, error: 'Pick a file.' };
	if (file.size === 0) return { ok: false, error: 'The file is empty.' };
	if (file.size > MAX_BYTES) return { ok: false, error: 'Files over 25 MB are not supported.' };
	if (!isCsvName(file.name) && !isXlsxName(file.name)) return { ok: false, error: 'Upload a .csv or .xlsx file.' };

	// Parse once now for the headers and the row count; the bytes are kept
	// in the bucket and parsed again on dry run and commit.
	let parsed: ParsedFile;
	try {
		const buffer = await file.arrayBuffer();
		parsed = isXlsxName(file.name) ? await parseXlsx(buffer) : parseCsv(new TextDecoder('utf-8').decode(buffer));
	} catch (e) {
		return { ok: false, error: `Could not parse the file: ${e instanceof Error ? e.message : String(e)}` };
	}
	if (parsed.headers.length === 0) return { ok: false, error: 'The file has no header row.' };
	if (parsed.rows.length === 0) return { ok: false, error: 'The file has a header row and nothing else.' };

	const supabase = await createClient();
	const { data: created, error: insertError } = await supabase
		.from('import_batches')
		.insert({
			requested_by: g.userId,
			status: 'draft',
			file_name: file.name,
			file_size: file.size,
			headers: parsed.headers,
			sample: parsed.rows.slice(0, 5),
			row_count: parsed.rows.length,
			options: parsed.sheets ? { sheets: parsed.sheets, sheet: parsed.sheets[0] } : {},
		})
		.select('id')
		.single();
	if (insertError || !created) return { ok: false, error: insertError?.message ?? 'Could not create the batch.' };

	const safeName = file.name.replace(/[^\w.\-]+/g, '_');
	const filePath = `${g.userId}/${created.id}/${safeName}`;
	const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, file, { contentType: file.type || undefined });
	if (uploadError) {
		await supabase.from('import_batches').delete().eq('id', created.id);
		return { ok: false, error: `Upload failed: ${uploadError.message}` };
	}

	const err = await setBatch(created.id, { file_path: filePath, status: 'uploaded' });
	if (err) return { ok: false, error: err };

	await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `import_batches:${created.id}`, action: 'import.upload', diff: { file: file.name, rows: parsed.rows.length } });
	revalidatePath(PATH);
	return { ok: true, id: created.id };
}

// ============================================================================
// Step 1b: pull an Airtable table into a batch (the 0116 Media Opps seed)
// ============================================================================
// Same batch lifecycle as an upload, except the file is written by the
// server from Airtable pages. options.pull carries the source and the
// resumable cursor; parts land in the bucket as
// <user>/<batch>/parts/<n>.json and are concatenated into one CSV when the
// pull is done, at which point the batch is 'uploaded' like any other.

type PullOptions = { source: SourceSpec; state: PullState; parts: number; done: boolean };

function pullOptions(batch: BatchRow): PullOptions | null {
	const p = batch.options.pull as PullOptions | undefined;
	return p && p.source ? p : null;
}

export async function createBatchFromAirtable(input: { source: 'media_opportunities' }): Promise<Result<{ id: string }>> {
	const g = await gate();
	if (!g.ok) return g;
	if (input.source !== 'media_opportunities') return { ok: false, error: 'Unknown pull source.' };
	if (!process.env.AIRTABLE_PAT) return { ok: false, error: 'AIRTABLE_PAT is not set on the server.' };
	const source: SourceSpec = MEDIA_OPPS_SOURCE;
	const fileName = `airtable-${source.tableName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
	const pull: PullOptions = { source, state: { cursor: undefined, pulled: 0, linkNames: {} }, parts: 0, done: false };

	const supabase = await createClient();
	const { data: created, error } = await supabase
		.from('import_batches')
		.insert({
			requested_by: g.userId,
			// import_batches.target is NOT NULL (0068) and a pull knows its
			// target up front; without it the insert fails with 23502.
			target: 'media_opportunities',
			status: 'draft',
			file_name: fileName,
			file_size: 0,
			headers: pullHeaders(source),
			sample: [],
			row_count: 0,
			options: { pull },
		})
		.select('id')
		.single();
	if (error || !created) return { ok: false, error: error?.message ?? 'Could not create the batch.' };
	await recordAudit({ actor_id: g.userId, entity_kind: 'airtable', entity_ref: `import_batches:${created.id}`, action: 'import.pull.start', diff: { base: source.baseId, table: source.table } });
	revalidatePath(PATH);
	return { ok: true, id: created.id };
}

export async function pullAirtableChunk(batchId: string): Promise<Result<{ progress: number; total: number; done: boolean }>> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch) return { ok: false, error: 'Batch not found.' };
	const pull = pullOptions(batch);
	if (!pull) return { ok: false, error: 'This batch is not an Airtable pull.' };
	if (batch.status !== 'draft') return { ok: false, error: `Cannot pull into a batch in status ${batch.status}.` };
	if (pull.done) return { ok: true, progress: pull.state.pulled, total: pull.state.pulled, done: true };

	const svc = createServiceRoleClient();
	try {
		const { rows, state, done } = await pullPages(getAdapter(), pull.source, pull.state);
		let parts = pull.parts;
		if (rows.length) {
			const partPath = `${g.userId}/${batchId}/parts/${String(parts).padStart(4, '0')}.json`;
			const { error: upErr } = await svc.storage.from(BUCKET).upload(partPath, JSON.stringify(rows), { contentType: 'application/json', upsert: true });
			if (upErr) throw new Error(`Could not stage the pulled rows: ${upErr.message}`);
			parts++;
		}
		// Keep the link-name map out of the row: it is ~500 entries and only
		// the pull needs it, but it must survive between calls.
		const next: PullOptions = { source: pull.source, state, parts, done };
		const err = await setBatch(batchId, { options: { ...batch.options, pull: next }, row_count: state.pulled, error: null });
		if (err) throw new Error(err);

		if (done) {
			const all: string[][] = [];
			for (let i = 0; i < parts; i++) {
				const partPath = `${g.userId}/${batchId}/parts/${String(i).padStart(4, '0')}.json`;
				const { data, error: dlErr } = await svc.storage.from(BUCKET).download(partPath);
				if (dlErr || !data) throw new Error(`Could not read staged part ${i}: ${dlErr?.message ?? 'no data'}`);
				all.push(...(JSON.parse(await data.text()) as string[][]));
			}
			const csv = rowsToCsv(pull.source, all);
			const filePath = `${g.userId}/${batchId}/${batch.file_name ?? 'airtable-pull.csv'}`;
			const { error: csvErr } = await svc.storage.from(BUCKET).upload(filePath, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: true });
			if (csvErr) throw new Error(`Could not write the pulled CSV: ${csvErr.message}`);
			await svc.storage.from(BUCKET).remove(Array.from({ length: parts }, (_, i) => `${g.userId}/${batchId}/parts/${String(i).padStart(4, '0')}.json`));
			const err2 = await setBatch(batchId, {
				file_path: filePath,
				file_size: csv.length,
				sample: all.slice(0, 5),
				row_count: all.length,
				status: 'uploaded',
				options: { ...batch.options, pull: { ...next, state: { ...state, linkNames: {} } } },
			});
			if (err2) throw new Error(err2);
			await recordAudit({ actor_id: g.userId, entity_kind: 'airtable', entity_ref: `import_batches:${batchId}`, action: 'import.pull.done', diff: { rows: all.length, base: pull.source.baseId, table: pull.source.table } });
			revalidatePath(PATH);
			return { ok: true, progress: all.length, total: all.length, done: true };
		}
		return { ok: true, progress: state.pulled, total: state.pulled, done: false };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await setBatch(batchId, { error: message });
		return { ok: false, error: message };
	}
}

// ============================================================================
// Step 2: target
// ============================================================================

const targetSchema = z.object({
	batchId: z.string().uuid(),
	target: z.enum(TARGET_KEYS as [TargetKey, ...TargetKey[]]),
	targetRef: z.string().max(200).optional(),
	keyField: z.string().max(200).optional(),
});

export async function setTarget(input: z.infer<typeof targetSchema>): Promise<Result<{ mapping: Mapping; columns: ReturnType<typeof columnsForTarget> }>> {
	const g = await gate();
	if (!g.ok) return g;
	const parsed = targetSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
	const { batchId, target, targetRef, keyField } = parsed.data;

	const batch = await loadBatch(batchId);
	if (!batch) return { ok: false, error: 'Batch not found.' };
	if (['committing', 'committed', 'rolled_back'].includes(batch.status)) return { ok: false, error: 'This batch is already committed.' };

	let columns;
	try {
		columns = columnsForTarget(target, target === 'airtable' ? await airtableFields(targetRef ?? null) : undefined);
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	if (target === 'airtable') {
		if (!targetRef) return { ok: false, error: 'Pick an Airtable base and table.' };
		if (!keyField || !columns.some((c) => c.key === keyField)) return { ok: false, error: 'Pick the Airtable field that identifies a record.' };
	}

	const mapping = autoMatch(batch.headers, columns);
	const options = { ...batch.options, ...(target === 'airtable' ? { keyField } : {}) };
	const err = await setBatch(batchId, {
		target,
		target_ref: target === 'airtable' ? targetRef ?? null : null,
		mapping,
		options,
		status: 'targeted',
		insert_count: 0,
		update_count: 0,
		reject_count: 0,
		progress: 0,
		error: null,
	});
	if (err) return { ok: false, error: err };
	revalidatePath(PATH);
	return { ok: true, mapping, columns };
}

export async function listAirtableTables(baseId: string): Promise<Result<{ tables: { id: string; name: string; fields: FieldSchema[] }[] }>> {
	const g = await gate();
	if (!g.ok) return g;
	try {
		const base = await getAdapter().getBaseSchema(baseId);
		return { ok: true, tables: base.tables.map((t) => ({ id: t.id, name: t.name, fields: t.fields })) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ============================================================================
// Step 3: map
// ============================================================================

const mappingSchema = z.object({
	batchId: z.string().uuid(),
	mapping: z.record(z.string().max(200), z.string().max(500)),
});

export async function saveMapping(input: z.infer<typeof mappingSchema>): Promise<Result> {
	const g = await gate();
	if (!g.ok) return g;
	const parsed = mappingSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: 'Invalid mapping.' };
	const { batchId, mapping } = parsed.data;

	const batch = await loadBatch(batchId);
	if (!batch || !batch.target) return { ok: false, error: 'Pick a target first.' };
	if (['committing', 'committed', 'rolled_back'].includes(batch.status)) return { ok: false, error: 'This batch is already committed.' };

	const columns = columnsForTarget(batch.target, batch.target === 'airtable' ? await airtableFields(batch.target_ref) : undefined);
	const known = new Set(columns.map((c) => c.key));
	const headers = new Set(batch.headers);
	const clean: Mapping = {};
	for (const [k, h] of Object.entries(mapping)) {
		if (known.has(k) && headers.has(h)) clean[k] = h;
	}
	const missing = missingRequired(clean, columns);
	if (missing.length) return { ok: false, error: `Map the required columns: ${missing.map((c) => c.label).join(', ')}.` };
	if (batch.target === 'airtable') {
		const keyField = String(batch.options.keyField ?? '');
		if (!clean[keyField]) return { ok: false, error: `Map the key field "${keyField}".` };
	}

	// A new mapping invalidates any dry run.
	const supabase = await createClient();
	await supabase.from('import_rows').delete().eq('batch_id', batchId);
	const err = await setBatch(batchId, { mapping: clean, status: 'mapped', insert_count: 0, update_count: 0, reject_count: 0, progress: 0, error: null });
	if (err) return { ok: false, error: err };
	revalidatePath(PATH);
	return { ok: true };
}

// ============================================================================
// Step 4: dry run (chunked)
// ============================================================================

async function planChunk(batch: BatchRow, file: ParsedFile, from: number): Promise<PlannedRow[]> {
	const target = batch.target!;
	const columns = columnsForTarget(target, target === 'airtable' ? await airtableFields(batch.target_ref) : undefined);
	const slice = file.rows.slice(from, from + CHUNK_SIZE).map((cells, i) => ({ rowNumber: from + i + 1, cells }));
	const input = { target, targetRef: batch.target_ref, options: batch.options, headers: file.headers, mapping: batch.mapping, columns, rows: slice };
	if (target === 'airtable') return planAirtable(getAdapter(), input);
	return planSupabase(createServiceRoleClient(), input);
}

export async function dryRunChunk(batchId: string): Promise<Result<{ progress: number; total: number; done: boolean }>> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch || !batch.target) return { ok: false, error: 'Pick a target first.' };
	if (!['mapped', 'dry_run'].includes(batch.status)) return { ok: false, error: `Cannot dry run a batch in status ${batch.status}.` };

	const from = batch.status === 'mapped' ? 0 : batch.progress;
	try {
		const file = await readFile(batch);
		if (file.rows.length !== batch.row_count) {
			await setBatch(batchId, { row_count: file.rows.length });
			batch.row_count = file.rows.length;
		}
		const supabase = await createClient();
		if (from === 0) await supabase.from('import_rows').delete().eq('batch_id', batchId);

		const planned = await planChunk(batch, file, from);
		if (planned.length) {
			const { error } = await supabase.from('import_rows').insert(
				planned.map((p) => ({ batch_id: batchId, row_number: p.rowNumber, action: p.action, target_id: p.targetId, before: p.before, after: p.after, reason: p.reason })),
			);
			if (error) throw new Error(`Could not save the dry run: ${error.message}`);
		}
		const progress = Math.min(batch.row_count, from + planned.length);
		const done = progress >= batch.row_count;
		const counts = {
			insert_count: batch.status === 'mapped' ? 0 : batch.insert_count,
			update_count: batch.status === 'mapped' ? 0 : batch.update_count,
			reject_count: batch.status === 'mapped' ? 0 : batch.reject_count,
		};
		for (const p of planned) {
			if (p.action === 'insert') counts.insert_count++;
			else if (p.action === 'update') counts.update_count++;
			else if (p.action === 'reject') counts.reject_count++;
		}
		const err = await setBatch(batchId, { ...counts, progress, status: 'dry_run', error: null });
		if (err) throw new Error(err);
		if (done) revalidatePath(PATH);
		return { ok: true, progress, total: batch.row_count, done };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await setBatch(batchId, { status: 'mapped', progress: 0, error: message });
		return { ok: false, error: message };
	}
}

export async function rejectListCsv(batchId: string): Promise<Result<{ csv: string; fileName: string }>> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch) return { ok: false, error: 'Batch not found.' };
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('import_rows')
		.select('row_number, action, reason')
		.eq('batch_id', batchId)
		.in('action', ['reject', 'skip'])
		.order('row_number');
	if (error) return { ok: false, error: explainAndLog(error, 'imports.actions') };
	let file: ParsedFile | null = null;
	try {
		file = await readFile(batch);
	} catch {
		file = null;
	}
	const rows = ((data ?? []) as { row_number: number; action: string; reason: string | null }[]).map((r) => [
		r.row_number,
		r.action,
		r.reason,
		...(file ? file.rows[r.row_number - 1] ?? [] : []),
	]);
	const csv = toCsv(['row', 'action', 'reason', ...(file ? file.headers : [])], rows);
	return { ok: true, csv, fileName: `${(batch.file_name ?? 'import').replace(/\.[^.]+$/, '')}-rejects.csv` };
}

// ============================================================================
// Step 5: commit (chunked) and rollback
// ============================================================================

export async function commitChunk(batchId: string): Promise<Result<{ progress: number; total: number; done: boolean }>> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch || !batch.target) return { ok: false, error: 'Pick a target first.' };
	if (!['dry_run', 'committing'].includes(batch.status)) return { ok: false, error: `Cannot commit a batch in status ${batch.status}.` };
	if (batch.status === 'dry_run' && batch.progress < batch.row_count) return { ok: false, error: 'Finish the dry run first.' };

	const from = batch.status === 'dry_run' ? 0 : batch.progress;
	try {
		const file = await readFile(batch);
		if (file.rows.length !== batch.row_count) throw new Error('The file changed since the dry run. Start again.');
		if (from === 0) {
			const err = await setBatch(batchId, { status: 'committing', progress: 0, error: null });
			if (err) throw new Error(err);
		}

		// Re plan against the live table right before writing: the dry run may
		// be minutes old and a row inserted since would otherwise duplicate.
		const planned = await planChunk(batch, file, from);
		const applied =
			batch.target === 'airtable'
				? await applyAirtable(getAdapter(), batch.target_ref, planned)
				: await applySupabase(createServiceRoleClient(), batch.target, planned);

		const supabase = await createClient();
		const rowNumbers = applied.map((p) => p.rowNumber);
		if (rowNumbers.length) {
			const { error: delError } = await supabase.from('import_rows').delete().eq('batch_id', batchId).in('row_number', rowNumbers);
			if (delError) throw new Error(`Could not replace dry run rows: ${delError.message}`);
			const { error } = await supabase.from('import_rows').insert(
				applied.map((p) => ({ batch_id: batchId, row_number: p.rowNumber, action: p.action, target_id: p.targetId, before: p.before, after: p.after, reason: p.reason })),
			);
			if (error) throw new Error(`Could not save the committed rows: ${error.message}`);
		}

		const progress = Math.min(batch.row_count, from + applied.length);
		const done = progress >= batch.row_count;
		const counts = from === 0 ? { insert_count: 0, update_count: 0, reject_count: 0 } : { insert_count: batch.insert_count, update_count: batch.update_count, reject_count: batch.reject_count };
		for (const p of applied) {
			if (p.action === 'insert') counts.insert_count++;
			else if (p.action === 'update') counts.update_count++;
			else if (p.action === 'reject') counts.reject_count++;
		}
		const err = await setBatch(batchId, {
			...counts,
			progress,
			status: done ? 'committed' : 'committing',
			committed_at: done ? new Date().toISOString() : null,
			error: null,
		});
		if (err) throw new Error(err);
		if (done) {
			await recordAudit({ actor_id: g.userId, entity_kind: batch.target === 'airtable' ? 'airtable' : 'supabase', entity_ref: `import_batches:${batchId}`, action: 'import.commit', diff: { target: batch.target, ...counts } });
			revalidatePath(PATH);
		}
		return { ok: true, progress, total: batch.row_count, done };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		// Rows already written stay written and stay recorded; the batch reads
		// failed with the row it stopped at, and rollback still works for
		// what landed.
		await setBatch(batchId, { status: 'failed', error: message });
		await recordAudit({ actor_id: g.userId, entity_kind: 'supabase', entity_ref: `import_batches:${batchId}`, action: 'import.commit', status: 'error', diff: { error: message } });
		revalidatePath(PATH);
		return { ok: false, error: message };
	}
}

export async function rollbackBatch(batchId: string): Promise<Result<{ reverted: number }> | { ok: false; error: string; drifts: Drift[] }> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch || !batch.target) return { ok: false, error: 'Batch not found.' };
	if (!['committed', 'failed'].includes(batch.status)) return { ok: false, error: `Cannot roll back a batch in status ${batch.status}.` };

	const supabase = await createClient();
	const { data, error } = await supabase
		.from('import_rows')
		.select('row_number, action, target_id, before, after, reason')
		.eq('batch_id', batchId)
		.in('action', ['insert', 'update'])
		.order('row_number');
	if (error) return { ok: false, error: explainAndLog(error, 'imports.actions') };
	const rows: PlannedRow[] = ((data ?? []) as { row_number: number; action: PlannedRow['action']; target_id: string | null; before: PlannedRow['before']; after: PlannedRow['after']; reason: string | null }[]).map(
		(r) => ({ rowNumber: r.row_number, action: r.action, targetId: r.target_id, before: r.before, after: r.after, reason: r.reason }),
	);
	// A failed commit may have planned rows (from the dry run) that were
	// never written: those have no target id for inserts and are skipped.
	const written = rows.filter((r) => r.targetId);

	try {
		const drifts =
			batch.target === 'airtable'
				? await verifyAirtable(getAdapter(), batch.target_ref, written)
				: await verifySupabase(createServiceRoleClient(), batch.target, written);
		if (drifts.length) {
			return { ok: false, error: `${drifts.length} row${drifts.length === 1 ? '' : 's'} changed since the import. Rollback refused.`, drifts: drifts.slice(0, 50) };
		}
		if (batch.target === 'airtable') await revertAirtable(getAdapter(), batch.target_ref, written);
		else await revertSupabase(createServiceRoleClient(), batch.target, written);

		const err = await setBatch(batchId, { status: 'rolled_back', rolled_back_at: new Date().toISOString(), rolled_back_by: g.userId, error: null });
		if (err) throw new Error(err);
		await recordAudit({ actor_id: g.userId, entity_kind: batch.target === 'airtable' ? 'airtable' : 'supabase', entity_ref: `import_batches:${batchId}`, action: 'import.rollback', diff: { reverted: written.length } });
		revalidatePath(PATH);
		return { ok: true, reverted: written.length };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await setBatch(batchId, { error: `Rollback failed: ${message}` });
		return { ok: false, error: message };
	}
}

export async function discardBatch(batchId: string): Promise<Result> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch) return { ok: false, error: 'Batch not found.' };
	if (['committing', 'committed', 'rolled_back'].includes(batch.status)) return { ok: false, error: 'Committed batches stay in the history.' };
	const supabase = await createClient();
	if (batch.file_path) await supabase.storage.from(BUCKET).remove([batch.file_path]);
	const { error } = await supabase.from('import_batches').delete().eq('id', batchId);
	if (error) return { ok: false, error: explainAndLog(error, 'imports.actions') };
	revalidatePath(PATH);
	return { ok: true };
}

export async function setSheet(batchId: string, sheet: string): Promise<Result> {
	const g = await gate();
	if (!g.ok) return g;
	const batch = await loadBatch(batchId);
	if (!batch) return { ok: false, error: 'Batch not found.' };
	const sheets = Array.isArray(batch.options.sheets) ? (batch.options.sheets as string[]) : [];
	if (!sheets.includes(sheet)) return { ok: false, error: 'Unknown sheet.' };
	try {
		const file = await readFile({ ...batch, options: { ...batch.options, sheet } });
		const err = await setBatch(batchId, { options: { ...batch.options, sheet }, headers: file.headers, sample: file.rows.slice(0, 5), row_count: file.rows.length, mapping: {}, status: 'uploaded', progress: 0 });
		if (err) return { ok: false, error: err };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	revalidatePath(PATH);
	return { ok: true };
}
