// GET /api/contract-version — what ingest schema this build expects.
// A sender checks this before its first batch; a mismatch with its pinned
// version means "do not send", not "send and hope".

import { NextResponse } from 'next/server';
import { CONTRACT_VERSION, MAX_BATCH_ROWS } from '@/lib/ingest/contract';
import { denyUnlessIngest } from '@/lib/ingest/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const denied = denyUnlessIngest(request);
	if (denied) return denied;
	return NextResponse.json({
		contract_version: CONTRACT_VERSION,
		max_batch_rows: MAX_BATCH_ROWS,
		endpoints: [
			'POST /api/ingest/metrics',
			'POST /api/ingest/health/engagement',
			'POST /api/ingest/health/satisfaction',
			'POST /api/ingest/live-links',
			'POST /api/ingest/client-comms',
			'POST /api/ingest/calls',
			'POST /api/ingest/todos',
			'POST /api/ingest/sessions',
			'POST /api/ingest/meeting-emails',
		],
	});
}
