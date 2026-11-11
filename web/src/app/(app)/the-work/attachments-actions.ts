'use server';

// Server actions for The Work file attachments (migration 0022). Files live
// in the private 'work-item-attachments' Storage bucket; this table just
// tracks metadata (name/size/who/when) per work item so the UI can list them
// without listing the bucket directly. Same broad "any authenticated
// teammate can read/write" trust model as the rest of The Work (see
// work_item_updates, work_item_tags) — this is an internal tool, not a
// multi-tenant product, so there's no per-row ownership check here either.
//
// Downloads always go through a freshly-minted signed URL (60s) rather than
// a stored/public link, since the bucket is private.

import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const BUCKET = 'work-item-attachments';
const MAX_BYTES = 25 * 1024 * 1024; // 25MB — generous for briefs/decks/exports, keeps uploads snappy.

export interface AttachmentRow {
	id: string;
	file_name: string;
	file_size: number | null;
	content_type: string | null;
	uploaded_by: string | null;
	created_at: string;
	/** 0052: a row is EITHER a stored file (storage_path, url null) OR a link
	 *  (url, storage_path null) — never both, never neither (CHECK constraint
	 *  work_item_attachments_file_or_url). */
	url: string | null;
	is_deliverable: boolean;
}

export async function listAttachments(workItemId: string): Promise<AttachmentRow[]> {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('work_item_attachments')
		.select('id, file_name, file_size, content_type, uploaded_by, created_at, url, is_deliverable')
		.eq('work_item_id', workItemId)
		.order('created_at', { ascending: false });
	// Log before swallowing. Returning [] on error keeps the contract (every
	// caller renders a quiet empty state), but silently turning a schema or RLS
	// failure into "No attachments yet" on an item that HAS files is
	// indistinguishable from an empty item — this line is what makes the cause
	// findable in the server log. Same console.error idiom as social.ts:166,212.
	if (error) {
		console.error('[the-work/attachments] list failed:', error.message);
		return [];
	}
	return data ?? [];
}

export async function uploadAttachment(formData: FormData) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return { ok: false as const, error: 'Not signed in.' };

	const file = formData.get('file');
	const workItemId = formData.get('work_item_id');
	if (!(file instanceof File) || typeof workItemId !== 'string' || !workItemId) {
		return { ok: false as const, error: 'Missing file or work item.' };
	}
	if (file.size === 0) return { ok: false as const, error: 'File is empty.' };
	if (file.size > MAX_BYTES) return { ok: false as const, error: 'Files over 25MB are not supported yet.' };

	// Storage keys don't need to be pretty, just unique + safe — the display
	// name (with the original, unsanitized filename) lives in the metadata row.
	const safeName = file.name.replace(/[^\w.\-]+/g, '_');
	const storagePath = `${workItemId}/${randomUUID()}-${safeName}`;

	const { error: uploadError } = await supabase.storage
		.from(BUCKET)
		.upload(storagePath, file, { contentType: file.type || undefined });
	if (uploadError) return { ok: false as const, error: uploadError.message };

	const { error: insertError } = await supabase.from('work_item_attachments').insert({
		work_item_id: workItemId,
		storage_path: storagePath,
		file_name: file.name,
		file_size: file.size,
		content_type: file.type || null,
		uploaded_by: auth.user.id,
	});
	if (insertError) {
		// Row insert failed — clean up the orphaned object rather than leaving
		// a file in the bucket with no metadata pointing at it.
		await supabase.storage.from(BUCKET).remove([storagePath]);
		return { ok: false as const, error: insertError.message };
	}

	revalidatePath(`/the-work/${workItemId}`);
	return { ok: true as const };
}

export async function deleteAttachment(id: string) {
	const supabase = await createClient();
	const { data: row, error: fetchError } = await supabase
		.from('work_item_attachments')
		.select('storage_path, work_item_id')
		.eq('id', id)
		.single();
	if (fetchError || !row) return { ok: false as const, error: fetchError?.message ?? 'Not found.' };

	const { error: deleteError } = await supabase.from('work_item_attachments').delete().eq('id', id);
	if (deleteError) return { ok: false as const, error: deleteError.message };

	// Best-effort object cleanup — the metadata row is already gone either way,
	// so a storage hiccup here shouldn't surface as a failure to the user.
	// A URL row (0052) has no storage_path, so there is nothing to remove.
	if (row.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path]);
	revalidatePath(`/the-work/${row.work_item_id}`);
	return { ok: true as const };
}

export async function getAttachmentDownloadUrl(id: string) {
	const supabase = await createClient();
	const { data: row, error } = await supabase
		.from('work_item_attachments')
		.select('storage_path')
		.eq('id', id)
		.single();
	if (error || !row) return { ok: false as const, error: error?.message ?? 'Not found.' };
	// A URL row has no stored object to sign — the UI links straight to `url`
	// and never calls this, but guard so a stray call can't crash on null.
	if (!row.storage_path) return { ok: false as const, error: 'This attachment is a link, not a stored file.' };

	const { data: signed, error: signError } = await supabase.storage
		.from(BUCKET)
		.createSignedUrl(row.storage_path, 60);
	if (signError || !signed) return { ok: false as const, error: signError?.message ?? 'Could not create link.' };

	return { ok: true as const, url: signed.signedUrl };
}
