// The acquisition CSV, shaped to the deal model's screening columns (0060
// brief §6). Pure and tested; the route handler under
// media/lead-scraper/export/acquisitions only reads rows and calls toCsv.
//
// The deal model sheet is the working surface for acquisitions (no /prospects
// style list is built, by decision), so the header row here IS the contract.

/** Deal-model column order. Do not reorder without updating the sheet. */
export const DEAL_MODEL_COLUMNS = [
	'Company',
	'Website',
	'Owner',
	'Title',
	'Email',
	'Phone',
	'LinkedIn',
	'Services',
	'Employees',
	'Est Revenue',
	'Founded',
	'City',
	'State',
	'Country',
	'Signal',
	'Status',
	'Fit',
	'Notes',
] as const;

export type DealColumn = (typeof DEAL_MODEL_COLUMNS)[number];
export type DealRow = Record<DealColumn, unknown>;

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would
 * execute — every value here came from an untrusted third party.
 */
export function cell(value: unknown): string {
	let s = value == null ? '' : String(value);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
	return s;
}

export function toCsv(rows: DealRow[]): string {
	return [
		DEAL_MODEL_COLUMNS.map(cell).join(','),
		...rows.map((r) => DEAL_MODEL_COLUMNS.map((c) => cell(r[c])).join(',')),
	].join('\r\n');
}

export interface TargetRow {
	company_name: string | null;
	website: string | null;
	owner_name: string | null;
	owner_title: string | null;
	email: string | null;
	phone: string | null;
	linkedin_url: string | null;
	agency_services: string | null;
	employee_count: string | null;
	est_revenue: string | null;
	founded_year: string | null;
	city: string | null;
	state: string | null;
	country: string | null;
	owner_signal: string | null;
	status: string | null;
	fit_score: number | null;
	notes: string | null;
}

export interface PendingRow {
	company_name: string | null;
	company_website: string | null;
	company_domain: string | null;
	full_name: string | null;
	job_title: string | null;
	email: string | null;
	personal_email: string | null;
	mobile_phone: string | null;
	company_phone: string | null;
	linkedin_url: string | null;
	agency_services: string | null;
	company_size: string | null;
	company_revenue: string | null;
	company_founded_year: string | null;
	company_city: string | null;
	company_state: string | null;
	company_country: string | null;
	owner_signal: string | null;
}

export function targetToDealRow(t: TargetRow): DealRow {
	return {
		Company: t.company_name,
		Website: t.website,
		Owner: t.owner_name,
		Title: t.owner_title,
		Email: t.email,
		Phone: t.phone,
		LinkedIn: t.linkedin_url,
		Services: t.agency_services,
		Employees: t.employee_count,
		'Est Revenue': t.est_revenue,
		Founded: t.founded_year,
		City: t.city,
		State: t.state,
		Country: t.country,
		Signal: t.owner_signal,
		Status: t.status,
		Fit: t.fit_score,
		Notes: t.notes,
	};
}

/**
 * Same field map the approve action uses (media/lead-scraper/actions.ts,
 * reviewAcquisitionRecords), so a pending export and the post-approval export
 * of the same row agree column for column.
 */
export function pendingToDealRow(r: PendingRow): DealRow {
	return {
		Company: r.company_name ?? r.company_domain,
		Website: r.company_website ?? r.company_domain,
		Owner: r.full_name,
		Title: r.job_title,
		Email: r.email ?? r.personal_email,
		Phone: r.mobile_phone ?? r.company_phone,
		LinkedIn: r.linkedin_url,
		Services: r.agency_services,
		Employees: r.company_size,
		'Est Revenue': r.company_revenue,
		Founded: r.company_founded_year,
		City: r.company_city,
		State: r.company_state,
		Country: r.company_country,
		Signal: r.owner_signal,
		Status: 'pending review',
		Fit: null,
		Notes: null,
	};
}
