// GET /team/sessions/[id]/transcript — plain-text download of a call's
// transcript. Replaces the old inline <details> expand on the detail page;
// the download is the primary affordance there now (see task 4's brief).
//
// Modeled on media/lead-scraper/export/route.ts: reads with the USER's
// session client, not the service role, so RLS decides who may read the
// content — here that's can_view_call() (migration 0056), the SAME
// authority the call detail page itself already defers to. No extra
// permission logic here, same as the page.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!UUID_RE.test(id)) {
		return NextResponse.json({ error: 'Not found.' }, { status: 404 });
	}

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	// A null `data` here is deliberately indistinguishable between "no such
	// call/transcript" and "RLS hides it" — both route to 404, same rule the
	// page uses for the call row itself.
	const { data: transcript, error } = await supabase
		.from('call_transcripts')
		.select('content')
		.eq('call_id', id)
		.maybeSingle<{ content: string }>();

	if (error) {
		console.error('[sessions/transcript]', error.message);
		return NextResponse.json({ error: 'Could not load the transcript.' }, { status: 500 });
	}
	if (!transcript) {
		return NextResponse.json({ error: 'Not found.' }, { status: 404 });
	}

	return new NextResponse(`﻿${transcript.content}`, {
		headers: {
			// BOM above so anything that opens this as text reads UTF-8 accents
			// correctly, same reasoning as the CSV export's BOM.
			'Content-Type': 'text/plain; charset=utf-8',
			'Content-Disposition': `attachment; filename="transcript-${id.slice(0, 8)}.txt"`,
			'Cache-Control': 'no-store',
		},
	});
}
