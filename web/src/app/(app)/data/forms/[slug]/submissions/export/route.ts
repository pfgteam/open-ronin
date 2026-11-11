// GET /data/forms/[slug]/submissions/export?status= — the inbox as CSV
// (0158). Reads with the user's session so RLS decides (confidential forms
// export nothing for non-execs).

import { NextResponse } from 'next/server';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { parseFields, type FormField } from '@/lib/forms/logic';
import { submissionsCsv, SUBMISSION_STATUSES, type SubmissionStatus } from '@/lib/forms/shared';
import { normalizeSubmission, SUBMISSION_COLS } from '../_lib';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
	const { slug } = await ctx.params;
	if (!/^[a-z0-9-]{2,64}$/.test(slug)) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });
	const profile = await getAuthProfile();
	if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
	const access = await loadSensitiveAccessContext();
	if (!(canManagePeople(access) || profile.role === 'exec')) return NextResponse.json({ error: 'Builders only.' }, { status: 403 });

	const supabase = await createClient();
	const { data: form } = await supabase.from('forms').select('id, slug, title, fields').eq('slug', slug).maybeSingle();
	if (!form) return NextResponse.json({ error: 'Unknown form.' }, { status: 404 });
	let fields: FormField[] = [];
	try {
		fields = parseFields(form.fields);
	} catch {
		fields = [];
	}
	const status = new URL(request.url).searchParams.get('status');
	let q = supabase.from('form_submissions').select(SUBMISSION_COLS).eq('form_id', form.id).order('created_at', { ascending: false }).limit(10000);
	if (status && SUBMISSION_STATUSES.includes(status as SubmissionStatus)) q = q.eq('status', status);
	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeSubmission);
	const csv = submissionsCsv(fields, rows);
	const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
	return new NextResponse(`\uFEFF${csv}`, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${slug}-submissions-${stamp}.csv"`,
			'Cache-Control': 'no-store',
		},
	});
}
