// POST /api/intake/feedback/[token] — stores a feedback submission (0127).
// Token = sha256 in rev_feedback; one submission per row.

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
	const { token } = await ctx.params;
	if (!/^[A-Za-z0-9_\-]{16,80}$/.test(token)) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 });
	let b: { rating?: unknown; answers?: unknown; comment?: unknown };
	try {
		b = (await request.json()) as typeof b;
	} catch {
		return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
	}
	const rating = Number(b.rating);
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) return NextResponse.json({ error: 'Rating must be 1-5.' }, { status: 400 });
	const answers = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? Object.fromEntries(Object.entries(b.answers as Record<string, unknown>).slice(0, 20).map(([k, v]) => [k.slice(0, 40), String(v ?? '').slice(0, 2000)])) : {};
	const comment = typeof b.comment === 'string' ? b.comment.slice(0, 4000) : null;
	const db = createServiceRoleClient();
	const hash = createHash('sha256').update(token).digest('hex');
	const { data: f } = await db.from('rev_feedback').select('id, submitted_at, deal_id, subject_user_id, kind').eq('token_hash', hash).maybeSingle();
	if (!f) return NextResponse.json({ error: 'Unknown link.' }, { status: 404 });
	if (f.submitted_at) return NextResponse.json({ ok: true, already: true });
	const { error } = await db.from('rev_feedback').update({ rating, answers, comment, submitted_at: new Date().toISOString() }).eq('id', f.id);
	if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
	if (f.deal_id) await db.from('rev_activities').insert({ deal_id: f.deal_id, kind: 'form', channel: 'web', direction: 'inbound', actor_kind: 'prospect', subject: `${f.kind} feedback: ${rating}/5`, body_md: comment, is_touch: false, meta: { feedback_id: f.id } });
	if (f.subject_user_id) {
		await db.from('notifications').upsert({ user_id: f.subject_user_id, kind: 'revenue', title: `Feedback: ${rating}/5`, body: comment?.slice(0, 300) ?? null, href: '/prospects/referrals', dedupe_key: `rev:feedback:${f.id}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
	}
	return NextResponse.json({ ok: true });
}
