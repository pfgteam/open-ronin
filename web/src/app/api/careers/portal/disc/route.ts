// POST /api/careers/portal/disc — candidate DISC questionnaire submit (0134).
// Token (raw, 48 hex) -> hire_portal_tokens.token_hash; the RPC scores and
// writes hire_disc_responses + hire_candidates.disc + a timeline event.

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const hits = new Map<string, number[]>();

export async function POST(request: Request) {
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
	const now = Date.now();
	const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
	list.push(now);
	hits.set(ip, list);
	if (list.length > 10) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
	let body: { token?: string; answers?: { q: number; most: string; least: string }[] };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
	}
	const token = String(body.token ?? '');
	if (!/^[0-9a-f]{48}$/.test(token)) return NextResponse.json({ error: 'Invalid link.' }, { status: 401 });
	const answers = (Array.isArray(body.answers) ? body.answers : []).filter((a) => Number.isInteger(a.q) && ['D', 'I', 'S', 'C'].includes(a.most) && ['D', 'I', 'S', 'C'].includes(a.least) && a.most !== a.least).slice(0, 40);
	if (answers.length < 20) return NextResponse.json({ error: 'Answer every group before submitting.' }, { status: 400 });
	const svc = createServiceRoleClient();
	const { data, error } = await svc.rpc('hire_disc_submit_candidate', { p_token_hash: createHash('sha256').update(token).digest('hex'), p_answers: answers });
	if (error) return NextResponse.json({ error: error.message.replace(/^hiring:\s*/, '') }, { status: /expired/i.test(error.message) ? 401 : 400 });
	return NextResponse.json({ ok: true, ...(data as { style: string; scores: Record<string, number> }) });
}
