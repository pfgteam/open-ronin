// Turn one raw Apify dataset item into a scraped_records row.
//
// PURE and tested, because two things here decide correctness and money:
// the dedup key (a wrong one either double-imports or silently drops leads)
// and the field mapping (a wrong one stages garbage that a human then has to
// reject one by one).
//
// Actors are third-party and their field names drift between versions, so every
// field is read through a list of candidate keys rather than one hard-coded
// name, and the untouched item is kept in `raw` for auditing a bad mapping
// after the fact.

export interface RawItem {
	[key: string]: unknown;
}

export interface NormalizedLead {
	dedupKey: string;
	// Person
	fullName: string | null;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	personalEmail: string | null;
	/** Direct/mobile line. Kept apart from companyPhone: 0041 preferred this
	 *  one and stopped, so 23 of the first 52 leads looked phoneless even
	 *  though a company number existed. */
	mobilePhone: string | null;
	linkedinUrl: string | null;
	jobTitle: string | null;
	headline: string | null;
	seniority: string | null;
	functionArea: string | null;
	location: string | null;
	// Company
	companyName: string | null;
	companyDomain: string | null;
	companyWebsite: string | null;
	companyLinkedin: string | null;
	companyPhone: string | null;
	companyIndustry: string | null;
	companySize: string | null;
	companyRevenue: string | null;
	companyFunding: string | null;
	companyFoundedYear: string | null;
	companyDescription: string | null;
	companyKeywords: string | null;
	companyTechnologies: string | null;
	companyCity: string | null;
	companyState: string | null;
	companyCountry: string | null;
	companyPostalCode: string | null;
	companyAddress: string | null;
	/** Trade-show only: null on database leads. Kept on the shared shape so the
	 *  importer has one upsert instead of a per-preset branch. */
	booth: string | null;
	boothSize: string | null;
	/** The exhibitor list this row came from. A fair has hundreds of rows and
	 *  the operator needs to know which list produced them. */
	sourceUrl: string | null;
	raw: RawItem;
}

export const str = (v: unknown): string | null => {
	if (typeof v === 'string') {
		const t = v.trim();
		return t === '' ? null : t;
	}
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return null;
};

/** Some actors send keywords/technologies as an array, others as a comma
 *  string. Normalise to one comma string so the CSV column is predictable. */
export function joinList(item: RawItem, keys: string[]): string | null {
	const wanted = new Set(keys.map((k) => k.replace(/^_+/, '')));
	const candidates = [
		...keys,
		...Object.keys(item).filter((k) => wanted.has(k.replace(/^_+/, ''))),
	];
	for (const k of candidates) {
		const v = item[k];
		if (Array.isArray(v)) {
			const parts = v.map((x) => str(x)).filter((x): x is string => !!x);
			if (parts.length) return parts.join(', ');
		}
		const s = str(v);
		if (s) return s;
	}
	return null;
}

/**
 * Some actors prefix every field with underscores to control column order in
 * exports — the exhibitor actor returns `__company_name`, `_company_website`,
 * `___exhibitor_profile_url`. Matching on the bare name and ignoring leading
 * underscores survives that, and survives them changing the COUNT of
 * underscores, which listing them literally would not.
 */
const bare = (k: string) => k.replace(/^_+/, '');

/** First non-empty value among the candidate keys, underscore-insensitive. */
export function pick(item: RawItem, keys: string[]): string | null {
	for (const k of keys) {
		const v = str(item[k]);
		if (v) return v;
	}
	// Second pass only if the direct hit failed, so exact keys stay fastest.
	const wanted = new Set(keys.map(bare));
	for (const [k, v] of Object.entries(item)) {
		if (!wanted.has(bare(k))) continue;
		const s = str(v);
		if (s) return s;
	}
	return null;
}

/** Bare domain: no scheme, no www, no path, lowercased. */
export function normalizeDomain(value: string | null): string | null {
	if (!value) return null;
	let d = value.trim().toLowerCase();
	d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
	d = d.replace(/^www\./, '');
	d = d.split(/[/?#]/)[0];
	d = d.replace(/\.+$/, '');
	return d === '' ? null : d;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function normalizeEmail(value: string | null): string | null {
	if (!value) return null;
	const e = value.trim().toLowerCase();
	return EMAIL_RE.test(e) ? e : null;
}

/**
 * Stable identity for a lead WITHIN a job.
 *
 * Email is the identity when there is one. Without an email we fall back to
 * name + company domain (or company name), which is weaker but still
 * deterministic — the point is that re-importing the same dataset page can
 * never insert the same person twice. Never falls back to something random or
 * position-based: a cursor retry must produce the SAME key for the same item.
 *
 * Returns null when the item carries no usable identity at all; the caller
 * skips those rather than staging junk.
 */
export function leadDedupKey(lead: {
	email: string | null;
	fullName: string | null;
	companyDomain: string | null;
	companyName: string | null;
}): string | null {
	if (lead.email) return lead.email;
	const who = lead.fullName?.toLowerCase().replace(/\s+/g, ' ').trim();
	const where = lead.companyDomain ?? lead.companyName?.toLowerCase().replace(/\s+/g, ' ').trim();
	if (!who || !where) return null;
	return `name:${who}|${where}`.slice(0, 400);
}

export function normalizeLead(item: RawItem): NormalizedLead | null {
	const email = normalizeEmail(
		pick(item, ['email', 'business_email', 'work_email', 'emailAddress']),
	);
	const first = pick(item, ['first_name', 'firstName', 'given_name']);
	const last = pick(item, ['last_name', 'lastName', 'family_name']);
	const fullName =
		pick(item, ['full_name', 'fullName', 'name']) ??
		([first, last].filter(Boolean).join(' ') || null);

	const companyName = pick(item, [
		'company_name', 'companyName', 'organization_name', 'organization', 'company',
	]);
	const companyWebsite = pick(item, ['company_website', 'company_url', 'website']);
	const companyDomain = normalizeDomain(
		pick(item, ['company_domain', 'companyDomain', 'company_website', 'website', 'domain']),
	);

	const lead: NormalizedLead = {
		dedupKey: '',
		fullName,
		firstName: first,
		lastName: last,
		email,
		// Deliberately NOT part of `email`: a personal address is a different
		// consent question from a work address (6/52 coverage anyway).
		personalEmail: normalizeEmail(pick(item, ['personal_email'])),
		mobilePhone: pick(item, ['mobile_number', 'mobile', 'direct_phone', 'phone']),
		linkedinUrl: pick(item, ['linkedin_url', 'linkedinUrl', 'linkedin', 'contact_linkedin']),
		jobTitle: pick(item, ['job_title', 'jobTitle', 'title']),
		headline: pick(item, ['headline']),
		seniority: pick(item, ['seniority', 'seniority_level']),
		functionArea: pick(item, ['functional_level', 'function', 'department']),
		location: pick(item, ['location', 'contact_location', 'city', 'country']),

		companyName,
		companyDomain,
		companyWebsite,
		companyLinkedin: pick(item, ['company_linkedin', 'company_linkedin_url']),
		companyPhone: pick(item, ['company_phone', 'company_phone_number']),
		companyIndustry: pick(item, ['company_industry', 'industry']),
		companySize: pick(item, ['company_size', 'size', 'employee_count']),
		// Prefer the readable form ("1.1M") over the raw integer; both stay in raw.
		companyRevenue: pick(item, ['company_annual_revenue_clean', 'company_annual_revenue', 'revenue']),
		companyFunding: pick(item, ['company_total_funding_clean', 'company_total_funding']),
		companyFoundedYear: pick(item, ['company_founded_year', 'founded_year']),
		companyDescription: pick(item, ['company_description', 'description']),
		companyKeywords: joinList(item, ['keywords', 'company_keywords']),
		companyTechnologies: joinList(item, ['company_technologies', 'technologies']),
		companyCity: pick(item, ['company_city']),
		companyState: pick(item, ['company_state']),
		companyCountry: pick(item, ['company_country']),
		companyPostalCode: pick(item, ['company_postal_code', 'company_zip']),
		companyAddress: pick(item, ['company_full_address', 'company_street_address']),
		booth: null,
		boothSize: null,
		sourceUrl: null,
		raw: item,
	};

	const key = leadDedupKey(lead);
	if (!key) return null;
	lead.dedupKey = key;
	return lead;
}

/**
 * Normalize a page of items and drop those without a usable identity.
 * Also collapses duplicates WITHIN the page, so a single upsert statement
 * cannot hit "ON CONFLICT DO UPDATE command cannot affect row a second time".
 */
export function normalizePage(items: RawItem[]): { leads: NormalizedLead[]; skipped: number } {
	const seen = new Set<string>();
	const leads: NormalizedLead[] = [];
	let skipped = 0;
	for (const item of items) {
		const lead = normalizeLead(item);
		if (!lead) {
			skipped++;
			continue;
		}
		if (seen.has(lead.dedupKey)) {
			skipped++;
			continue;
		}
		seen.add(lead.dedupKey);
		leads.push(lead);
	}
	return { leads, skipped };
}
