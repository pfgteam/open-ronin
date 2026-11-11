// GET /media/lead-scraper/export/acquisitions?job=<uuid>&status=approved|pending
// — CSV of an acquisition job's rows, shaped to the deal model's screening
// columns (0060 brief §6; the column contract lives in
// lib/scrapers/acquisitionCsv). Default status is 'approved'.
//
// Approved rows are read from acquisition_targets (the durable record, which
// carries Status/Fit/Notes the reviewer may have edited) — pending rows from
// scraped_records, with Status/Fit/Notes blank. Both reads run as the USER,
// so can_view_acquisitions() decides who may export; a caller without the
// capability gets a 403 up front, never somebody's target list.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/scrapers/fetchAllRows';
import {
	type DealRow,
	type PendingRow,
	type TargetRow,
	pendingToDealRow,
	targetToDealRow,
	toCsv,
} from '@/lib/scrapers/acquisitionCsv';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const url = new URL(request.url);
	const jobId = url.searchParams.get('job');
	if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
		return NextResponse.json({ error: 'A job id is required.' }, { status: 400 });
	}
	const status = url.searchParams.get('status') === 'pending' ? 'pending' : 'approved';

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	// RLS already returns zero rows to a non-holder; refuse explicitly so a
	// missing capability reads as "forbidden", not as "the job has no rows".
	const { data: mayView } = await supabase.rpc('can_view_acquisitions');
	if (mayView !== true) {
		return NextResponse.json({ error: 'You do not hold the acquisitions capability.' }, { status: 403 });
	}

	let rows: DealRow[] = [];
	if (status === 'approved') {
		// Targets carry no job_id (they outlive the job); join back through
		// the source record. RLS on both tables is the capability fence.
		// Paged past PostgREST's 1000-row cap, ordered on a unique (name, id)
		// pair so a company_name repeating across a boundary cannot drop or
		// duplicate a target. See lib/scrapers/fetchAllRows.
		let targets: TargetRow[];
		try {
			targets = await fetchAllRows<TargetRow>(async (from, to) => {
				const { data, error } = await supabase
					.from('acquisition_targets')
					.select(
						'id, company_name, website, owner_name, owner_title, email, phone, linkedin_url, agency_services, employee_count, est_revenue, founded_year, city, state, country, owner_signal, status, fit_score, notes, scraped_records!inner(job_id)',
					)
					.eq('scraped_records.job_id', jobId)
					.order('company_name')
					.order('id')
					.range(from, to);
				if (error) throw new Error(error.message);
				return (data ?? []) as unknown as TargetRow[];
			});
		} catch (e) {
			console.error('[acquisitions/export]', e instanceof Error ? e.message : e);
			return NextResponse.json({ error: 'Could not read the acquisition targets.' }, { status: 500 });
		}
		rows = targets.map(targetToDealRow);
	} else {
		let pending: PendingRow[];
		try {
			pending = await fetchAllRows<PendingRow>(async (from, to) => {
				const { data, error } = await supabase
					.from('scraped_records')
					.select(
						'id, company_name, company_website, company_domain, full_name, job_title, email, personal_email, mobile_phone, company_phone, linkedin_url, agency_services, company_size, company_revenue, company_founded_year, company_city, company_state, company_country, owner_signal',
					)
					.eq('job_id', jobId)
					.eq('status', 'pending')
					.order('company_name')
					.order('id')
					.range(from, to);
				if (error) throw new Error(error.message);
				return (data ?? []) as unknown as PendingRow[];
			});
		} catch (e) {
			console.error('[acquisitions/export]', e instanceof Error ? e.message : e);
			return NextResponse.json({ error: 'Could not read the pending records.' }, { status: 500 });
		}
		rows = pending.map(pendingToDealRow);
	}

	return new NextResponse(`\uFEFF${toCsv(rows)}`, {
		headers: {
			// BOM so Excel reads UTF-8 accents correctly.
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="acquisition-targets-${status}-${jobId.slice(0, 8)}.csv"`,
			'Cache-Control': 'no-store',
		},
	});
}
