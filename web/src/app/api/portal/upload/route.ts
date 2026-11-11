// POST /api/portal/upload — portal file upload (library / recording). Session
// = the portal user; stored under client/<client_id>/ in flywheel-uploads.
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getPortalSession, portalLabel } from '@/lib/flywheel/portal';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });
	}
	const s = await getPortalSession(String(form.get('client') ?? '') || null);
	if (!s) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
	const kind = ['library', 'recording', 'brand', 'logo', 'other'].includes(String(form.get('kind'))) ? String(form.get('kind')) : 'library';
	const file = form.get('file');
	if (!(file instanceof File)) return NextResponse.json({ error: 'No file.' }, { status: 400 });
	const max = kind === 'recording' ? 2048 : 50;
	if (file.size > max * 1024 * 1024) return NextResponse.json({ error: `Max ${max} MB.` }, { status: 400 });
	if (/\.(exe|bat|cmd|sh|js|msi|dll)$/i.test(file.name)) return NextResponse.json({ error: 'That file type is not allowed.' }, { status: 400 });
	const svc = createServiceRoleClient();
	const videoId = String(form.get('video_id') ?? '') || null;
	const programId = String(form.get('program_id') ?? '') || null;
	if (programId) {
		// client input: must be one of this client's programs (the recording trigger logs client-visibly on it)
		const { data: own } = await svc.from('fw_programs').select('id').eq('id', programId).eq('client_id', s.client_id).maybeSingle();
		if (!own) return NextResponse.json({ error: 'That program is not yours.' }, { status: 403 });
	}
	if (videoId) {
		const { data: v } = await svc.from('fw_videos').select('id, program:fw_programs!fw_videos_program_id_fkey(client_id)').eq('id', videoId).maybeSingle();
		const vv = v as unknown as { program: { client_id: string } | null } | null;
		if (!vv || vv.program?.client_id !== s.client_id) return NextResponse.json({ error: 'That recording slot is not yours.' }, { status: 403 });
	}
	const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
	const path = `client/${s.client_id}/${kind}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)}.${ext}`.replace(/\.(\w+)\.\1$/, '.$1');
	const { error } = await svc.storage.from('flywheel-uploads').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || undefined, upsert: false });
	if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
	const { error: e2 } = await svc.from('fw_portal_files').insert({ client_id: s.client_id, program_id: programId, video_id: videoId, kind, path, original_name: file.name.slice(0, 200), content_type: file.type || null, size_bytes: file.size, note: String(form.get('note') ?? '').slice(0, 500) || null, uploaded_by_user: s.user.id, uploaded_by_label: portalLabel(s) });
	if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}
