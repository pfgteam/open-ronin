// POST /api/skills/run  — enqueue a skill run   { skill, context } -> { id }
// GET  /api/skills/run?id=<uuid> — read status/result of a run
//
// This is the ONLY surface the app uses to talk to the skills runtime.
// It never calls a model or a worker directly: it writes/reads the
// `skill_runs` table (migration 0020) and the runtime — whichever one is
// deployed (Claude Agent SDK worker today, Hermes later) — consumes the
// queue on its own. Keep it this way: the decoupling is what makes the
// runtime swappable.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Allowlist: only skills we have wired into the worker. Add here as they ship.
// content-script and content-headlines (worker/skills/, Content Studio module
// 2): the studio pages call the text provider directly today; the worker
// path is for RUNTIME=worker deployments that want the skill_runs audit trail.
const ALLOWED_SKILLS = new Set(['friday-recap-draft', 'content-script', 'content-headlines']);

// Context must be a small, flat object — never free-form user HTML/etc.
const MAX_CONTEXT_BYTES = 4096;

export async function POST(req: Request) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	let body: { skill?: string; context?: Record<string, unknown> };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
	}

	const skill = typeof body.skill === 'string' ? body.skill.trim() : '';
	if (!ALLOWED_SKILLS.has(skill)) {
		return NextResponse.json({ error: `Unknown skill: "${skill}".` }, { status: 400 });
	}

	const context = body.context && typeof body.context === 'object' ? body.context : {};
	if (JSON.stringify(context).length > MAX_CONTEXT_BYTES) {
		return NextResponse.json({ error: 'Context too large.' }, { status: 400 });
	}

	const { data, error } = await supabase
		.from('skill_runs')
		.insert({ skill, context, requested_by: auth.user.id })
		.select('id, status, created_at')
		.single();

	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json(data, { status: 201 });
}

export async function GET(req: Request) {
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	const id = new URL(req.url).searchParams.get('id');
	if (!id) return NextResponse.json({ error: 'Missing ?id=' }, { status: 400 });

	const { data, error } = await supabase
		.from('skill_runs')
		.select('id, skill, status, result_md, error, created_at, started_at, finished_at')
		.eq('id', id)
		.single();

	if (error) return NextResponse.json({ error: error.message }, { status: 404 });
	return NextResponse.json(data);
}
