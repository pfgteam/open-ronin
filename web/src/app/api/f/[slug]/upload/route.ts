// POST /api/f/[slug]/upload — a `file` field's bytes, uploaded before the
// submit (0158). Multipart { key, file }. Stores under <form_id>/<uuid>-<name>
// in the private bucket form-uploads through the service role and returns
// the path the submit payload carries; the submit verifies the prefix.

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { clientIp, loadPublicForm } from '@/lib/forms/server';
import { MAX_UPLOAD_BYTES } from '@/lib/forms/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED = new Set([
	'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'image/png', 'image/jpeg', 'image/gif', 'image/webp',
	'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4',
	'text/plain', 'text/csv',
]);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const hits = new Map<string, number[]>();

export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
	const { slug } = await ctx.params;
	const ip = clientIp(request);
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
	list.push(now);
	hits.set(ip, list);
	if (hits.size > 5000) hits.clear();
	if (list.length > 30) return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429, headers: CORS });

	const loaded = await loadPublicForm(slug);
	if (!loaded) return NextResponse.json({ error: 'This form is not available.' }, { status: 404, headers: CORS });

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400, headers: CORS });
	}
	const key = String(form.get('key') ?? '');
	const field = loaded.fields.find((f) => f.key === key && f.type === 'file');
	if (!field) return NextResponse.json({ error: 'Unknown file field.' }, { status: 400, headers: CORS });
	const file = form.get('file');
	if (!(file instanceof File)) return NextResponse.json({ error: 'No file.' }, { status: 400, headers: CORS });
	if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'That file type is not accepted (PDF, Word, images, video, audio, text).' }, { status: 400, headers: CORS });
	if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Max 25 MB.' }, { status: 400, headers: CORS });

	const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'file';
	const path = `${loaded.row.id}/${randomUUID()}-${safeName}`;
	const svc = createServiceRoleClient();
	const { error } = await svc.storage.from('form-uploads').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
	if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500, headers: CORS });
	return NextResponse.json({ ok: true, path, name: safeName, size: file.size, type: file.type }, { headers: CORS });
}
