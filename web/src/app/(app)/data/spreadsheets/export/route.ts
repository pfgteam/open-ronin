// GET /data/spreadsheets/export?source=<uuid>&tab=<title>: the latest
// snapshot of one tab as CSV, exactly the grid as synced (header row and
// all). Reads with the user's session so RLS (sheet_snapshots_read_all)
// decides, the same way the Lead Scraper export does.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/lib/sheets/client';
import { buildSnapshotView, type SnapshotRow } from '@/lib/sheets/snapshot';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
	const url = new URL(request.url);
	const source = url.searchParams.get('source') ?? '';
	const tab = url.searchParams.get('tab') ?? '';
	if (!UUID.test(source) || !tab) {
		return NextResponse.json({ error: 'source (uuid) and tab are required.' }, { status: 400 });
	}

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	const { data: src } = await supabase.from('sheet_sources').select('display_name').eq('id', source).maybeSingle();
	if (!src) return NextResponse.json({ error: 'Unknown sheet.' }, { status: 404 });

	const { data, error } = await supabase
		.from('sheet_snapshots')
		.select('row_index, row_data, synced_at')
		.eq('source_id', source)
		.eq('tab', tab)
		.order('row_index', { ascending: true })
		.limit(50000);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	const view = buildSnapshotView((data ?? []) as SnapshotRow[]);
	const csv = toCsv(view.grid);
	const stamp = (view.syncedAt ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, '-');
	const safe = (s: string) => s.replace(/[^a-zA-Z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'sheet';
	const filename = `${safe(src.display_name)}__${safe(tab)}__${stamp}.csv`;

	// BOM so Excel opens UTF 8 text correctly on Windows.
	return new NextResponse(`\uFEFF${csv}`, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store',
		},
	});
}
