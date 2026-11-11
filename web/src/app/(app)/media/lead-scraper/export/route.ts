// GET /media/lead-scraper/export?job=<uuid>&status=approved|pending — CSV of
// a job's leads. Default status is 'approved'.
//
// v1 output (Sam, 2026-08-24): approved rows leave as a CSV rather than
// merging into contacts/prospects. That keeps a wrongly approved lead contained
// in staging instead of entering the sales pipeline. status=pending (added
// 2026-09-09) gives a reviewer the whole queue when it runs past what the
// on-screen table shows. Both statuses are read in full: the route pages
// through PostgREST's 1000-row cap rather than stopping at it.
//
// Reads with the USER's session, not the service role, so RLS (0041,
// can_run_scrapers) decides who may export third-party PII. A contributor
// hitting this URL gets an empty file, not somebody's lead list.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/scrapers/fetchAllRows';

export const dynamic = 'force-dynamic';

// Order chosen for the person doing outreach: who they are, how to reach
// them, then the company context that feeds a pitch. The CSV is where the work
// happens, so it carries everything — the review table on screen stays lean.
const COLUMNS = [
	['first_name', 'First name'],
	['last_name', 'Last name'],
	['full_name', 'Full name'],
	['job_title', 'Title'],
	['seniority', 'Seniority'],
	['function_area', 'Function'],
	['headline', 'LinkedIn headline'],
	['email', 'Work email'],
	['personal_email', 'Personal email'],
	['mobile_phone', 'Mobile'],
	['company_phone', 'Company phone'],
	['linkedin_url', 'LinkedIn'],
	['company_name', 'Company'],
	['company_domain', 'Domain'],
	['company_website', 'Website'],
	['company_linkedin', 'Company LinkedIn'],
	['company_industry', 'Industry'],
	['company_size', 'Employees'],
	['company_revenue', 'Revenue'],
	['company_funding', 'Total funding'],
	['company_founded_year', 'Founded'],
	['company_city', 'City'],
	['company_state', 'State'],
	['company_country', 'Country'],
	['company_postal_code', 'Postal code'],
	['company_address', 'Address'],
	['company_description', 'Company description'],
	['company_keywords', 'Keywords'],
	['company_technologies', 'Technologies'],
	// Trade-show preset (0048). Empty for B2B-database rows, which is fine —
	// "carries everything" is the file's own contract, and these were the only
	// collected fields the CSV dropped.
	['booth', 'Booth'],
	['booth_size', 'Booth size'],
	['source_url', 'Source URL'],
] as const;

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would
 * execute. Without that, a scraped company name like `=cmd|...` becomes a CSV
 * injection the moment someone opens the file in Excel — and every value here
 * came from an untrusted third party.
 */
function cell(value: unknown): string {
	let s = value == null ? '' : String(value);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
	return s;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const jobId = url.searchParams.get('job');
	if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
		return NextResponse.json({ error: 'A job id is required.' }, { status: 400 });
	}
	// Default stays 'approved' (the v1 contract above); 'pending' lets a
	// reviewer pull a whole run's queue past what the on-screen table shows
	// (page.tsx shows one PAGE_SIZE window of that table; this export walks
	// every page of the job instead).
	const statusParam = url.searchParams.get('status');
	const status = statusParam === 'pending' ? 'pending' : 'approved';

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

	// Paged, because an un-ranged select stops at PostgREST's 1000-row cap and
	// says so only in a 206 header supabase-js swallows — a 4995-lead job was
	// silently exporting its first 1000 rows. `order` is (company_name, id):
	// company_name is not unique, and a name repeating across a page boundary
	// drops or duplicates rows, so the id breaks every tie.
	let rows: Record<string, unknown>[];
	try {
		rows = await fetchAllRows<Record<string, unknown>>(async (from, to) => {
			const { data, error } = await supabase
				.from('scraped_records')
				.select(COLUMNS.map(([c]) => c).join(', '))
				.eq('job_id', jobId)
				.eq('status', status)
				.order('company_name')
				.order('id')
				.range(from, to);
			if (error) throw new Error(error.message);
			return (data ?? []) as unknown as Record<string, unknown>[];
		});
	} catch (e) {
		console.error('[lead-scraper/export]', e instanceof Error ? e.message : e);
		return NextResponse.json({ error: `Could not read the ${status} leads.` }, { status: 500 });
	}
	const csv = [
		COLUMNS.map(([, header]) => cell(header)).join(','),
		...rows.map((r) => COLUMNS.map(([c]) => cell(r[c])).join(',')),
	].join('\r\n');

	// 0156: one "Exported to CSV" note per linked deal, once per job (idempotent).
	if (status === 'approved') await supabase.rpc('rev_scrape_exported', { p_job: jobId });

	return new NextResponse(`﻿${csv}`, {
		headers: {
			// BOM above so Excel reads UTF-8 accents correctly.
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="leads-${status}-${jobId.slice(0, 8)}.csv"`,
			'Cache-Control': 'no-store',
		},
	});
}
