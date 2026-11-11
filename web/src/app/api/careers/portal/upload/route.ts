// POST /api/careers/portal/upload — candidate portal document upload (0132).
// Token (raw, 48 hex) -> hire_portal_tokens.token_hash -> candidate; stores
// under applications/<candidate_id>/ in the private bucket and files a
// hire_application_files row on the candidate's latest application.

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg'];
const hits = new Map<string, number[]>();

export async function POST(request: Request) {
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
	list.push(now);
	hits.set(ip, list);
	if (list.length > 20) return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429 });
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });
	}
	const token = String(form.get('token') ?? '');
	const kind = ['resume', 'portfolio', 'other'].includes(String(form.get('kind'))) ? String(form.get('kind')) : 'other';
	const file = form.get('file');
	if (!/^[0-9a-f]{48}$/.test(token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 401 });
	if (!(file instanceof File)) return NextResponse.json({ error: 'No file.' }, { status: 400 });
	if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'PDF, Word, PNG or JPEG only.' }, { status: 400 });
	if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Max 10 MB.' }, { status: 400 });
	const svc = createServiceRoleClient();
	const { data: who } = await svc.rpc('hire_portal_resolve', { p_token_hash: createHash('sha256').update(token).digest('hex') });
	const w = who as { candidate_id: string } | null;
	if (!w) return NextResponse.json({ error: 'This link has expired.' }, { status: 401 });
	const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
	const path = `applications/${w.candidate_id}/${kind}-${Date.now()}.${ext}`;
	const { error } = await svc.storage.from('hiring-uploads').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
	if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
	const { data: latest } = await svc.from('hire_applications').select('id').eq('candidate_id', w.candidate_id).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
	await svc.from('hire_application_files').insert({ application_id: (latest as { id: string } | null)?.id ?? null, candidate_id: w.candidate_id, kind, path, mime: file.type, size_bytes: file.size, original_name: file.name.slice(0, 200) });
	if (kind === 'resume') await svc.from('hire_candidates').update({ resume_path: path }).eq('id', w.candidate_id);
	if ((latest as { id: string } | null)?.id) await svc.from('hire_application_events').insert({ application_id: (latest as { id: string }).id, kind: 'portal', summary: `Candidate uploaded ${kind}: ${file.name.slice(0, 80)}` });
	return NextResponse.json({ ok: true });
}
