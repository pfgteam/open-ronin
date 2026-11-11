// Scan AI (Prospects) — the I/O half. Server-only. Reads public sources for
// one person or one brand and returns a diff for a rep to review; it never
// writes the record (applyScan in prospects/scanActions.ts does, with only
// the fields the rep ticked).
//
// Sources (decision 2026-11-03, option c):
//   website   the brand's homepage + up to 2 About / Team / Contact pages.
//             Free. For a person, the AI looks for that person by name.
//   linkedin  only when the person has a linkedin.com/in/ URL and
//             APIFY_TOKEN is set. Paid per profile, so every rep gets
//             LINKEDIN_SCANS_PER_DAY in a rolling 24 h, counted from
//             audit_log rows written BEFORE the run starts (a failed run
//             still cost money).
// The model only reads and extracts; scanFields.cleanFound drops anything
// outside the whitelist and any email / phone not literally in the source.

import type { SupabaseClient } from '@supabase/supabase-js';
import { adaptersFor } from '@/lib/providers/registry';
import type { ProviderAdapter } from '@/lib/providers/types';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { SOCIAL_HOSTS } from './enrichment';
import { buildDiff, cleanFound, htmlToText, isFetchableUrl, parseJsonObject, pickSubpages, type ScanField, type ScanSource, type ScanTarget } from './scanFields';

type Db = SupabaseClient;

export const LINKEDIN_SCANS_PER_DAY = 20;
const LINKEDIN_ACTOR = 'apimaestro/linkedin-profile-detail';
const LINKEDIN_ACTION = 'revenue.scan.linkedin';
const UA = 'Mozilla/5.0 (compatible; OpenRoninBot/1.0; +https://app.example.com)';

export interface SourceNote {
	source: ScanSource;
	status: 'ok' | 'skipped' | 'failed';
	detail: string;
}

export interface ScanOutcome {
	target: ScanTarget;
	id: string;
	name: string;
	fields: ScanField[];
	notes: SourceNote[];
	/** LinkedIn scans left for this rep in the last 24 h (null when LinkedIn was not in play). */
	linkedinLeft: number | null;
}

// ---------------------------------------------------------------- sources

async function fetchHtml(url: string): Promise<{ url: string; html: string } | null> {
	if (!isFetchableUrl(url)) return null;
	try {
		const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': UA, accept: 'text/html' } });
		if (!res.ok || !(res.headers.get('content-type') ?? 'text/html').includes('html')) return null;
		const finalUrl = res.url || url;
		if (!isFetchableUrl(finalUrl)) return null;
		return { url: finalUrl, html: (await res.text()).slice(0, 400_000) };
	} catch {
		return null;
	}
}

/** Homepage + up to two About / Team / Contact pages, as text (and the homepage HTML for social links). */
async function readSite(start: string): Promise<{ pages: string[]; text: string; html: string } | null> {
	const home = await fetchHtml(start);
	if (!home) return null;
	const subs = (await Promise.all(pickSubpages(home.html, home.url, 2).map(fetchHtml))).filter((p): p is { url: string; html: string } => !!p);
	const all = [home, ...subs];
	const text = all.map((p) => `=== ${p.url}\n${htmlToText(p.html, 10_000)}`).join('\n\n').slice(0, 24_000);
	return { pages: all.map((p) => p.url), text, html: all.map((p) => p.html).join('\n') };
}

function socialLinks(html: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, re] of Object.entries(SOCIAL_HOSTS)) {
		const m = html.match(re);
		if (m) out[k] = m[0].replace(/["'>].*$/, '');
	}
	return out;
}

function textAdapter(): ProviderAdapter | null {
	return adaptersFor('generate_text').find((a) => a.isConfigured()) ?? null;
}

const SYSTEM = [
	'You extract facts from the source text you are given into a JSON object.',
	'Only use facts stated in the source. Never guess, infer or invent.',
	'Use an empty string for anything the source does not state.',
	'Answer with the JSON object only.',
].join(' ');

async function extract(adapter: ProviderAdapter, prompt: string): Promise<Record<string, unknown> | null> {
	const out = await adapter.submit({ capability: 'generate_text', system: SYSTEM, prompt, maxTokens: 700 });
	const text = 'result' in out ? out.result.text : undefined;
	return text ? parseJsonObject(text) : null;
}

// ---------------------------------------------------------------- LinkedIn quota + run

/** LinkedIn scans this rep started in the last 24 hours. */
export async function linkedinScansUsed(actorId: string): Promise<number> {
	const svc = createServiceRoleClient();
	const since = new Date(Date.now() - 24 * 3600_000).toISOString();
	const { count } = await svc.from('audit_log').select('id', { count: 'exact', head: true }).eq('actor_id', actorId).eq('action', LINKEDIN_ACTION).gte('created_at', since);
	return count ?? 0;
}

async function runLinkedin(profileUrl: string): Promise<Record<string, unknown> | null> {
	const { startRun, getRun, getDatasetItems } = await import('@/lib/scrapers/apify');
	const run = await startRun(LINKEDIN_ACTOR, { profileUrls: [profileUrl], url: profileUrl });
	let info = run;
	// ~45 s budget: the page sets maxDuration = 60.
	for (let i = 0; i < 15 && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(info.status); i++) {
		await new Promise((r) => setTimeout(r, 3000));
		info = await getRun(run.id);
	}
	if (info.status !== 'SUCCEEDED') throw new Error(info.status === 'RUNNING' || info.status === 'READY' ? 'LinkedIn took too long; try again in a minute.' : `LinkedIn run ${info.status.toLowerCase()}.`);
	if (!info.defaultDatasetId) return null;
	return (await getDatasetItems(info.defaultDatasetId, 0, 1))[0] ?? null;
}

// ---------------------------------------------------------------- brand

type BrandForScan = { id: string; name: string; domain: string | null; website: string | null; industry: string | null; vertical: string | null; description: string | null; socials: Record<string, string> | null };

export async function scanBrand(db: Db, brandId: string): Promise<ScanOutcome | null> {
	const { data } = await db.from('rev_brands').select('id, name, domain, website, industry, vertical, description, socials').eq('id', brandId).maybeSingle();
	if (!data) return null;
	const brand = data as BrandForScan;
	const notes: SourceNote[] = [];
	const found: Record<string, { value: string; source: ScanSource }> = {};
	const start = brand.website ?? (brand.domain ? `https://${brand.domain}` : null);

	if (!start) notes.push({ source: 'website', status: 'skipped', detail: 'The brand has no website or domain yet.' });
	else {
		const site = await readSite(start);
		if (!site) notes.push({ source: 'website', status: 'failed', detail: `Could not load ${start}.` });
		else {
			const links = socialLinks(site.html);
			for (const [k, v] of Object.entries(links)) found[`socials.${k}`] = { value: v, source: 'website' };
			if (!brand.website) found.website = { value: site.pages[0], source: 'website' };
			const adapter = textAdapter();
			if (adapter) {
				const raw = await extract(adapter, [
					`Brand: ${brand.name}`,
					'Return JSON with these keys:',
					'  industry: the broad industry (e.g. "Health & Wellness", "CPG", "B2B services")',
					'  vertical: the narrower category (e.g. "Supplements", "Skincare", "Coffee")',
					'  description: one or two plain sentences on what the brand sells and to whom, from the text',
					'  socials: { instagram, facebook, tiktok, x, linkedin, youtube } full URLs only if present in the text',
					'',
					'SOURCE TEXT:',
					site.text,
				].join('\n'));
				for (const [k, v] of Object.entries(cleanFound('brand', raw, site.text))) if (!found[k]) found[k] = { value: v, source: 'website' };
				notes.push({ source: 'website', status: 'ok', detail: `Read ${site.pages.length} page${site.pages.length === 1 ? '' : 's'} of ${new URL(site.pages[0]).hostname}.` });
			} else {
				notes.push({ source: 'website', status: 'ok', detail: 'Read the site; AI is not configured, so only links were extracted.' });
			}
		}
	}

	const socials = brand.socials ?? {};
	const current: Record<string, string | null> = {
		website: brand.website,
		industry: brand.industry,
		vertical: brand.vertical,
		description: brand.description,
		...Object.fromEntries(Object.entries(socials).map(([k, v]) => [`socials.${k}`, v || null])),
	};
	return { target: 'brand', id: brand.id, name: brand.name, fields: buildDiff('brand', current, found), notes, linkedinLeft: null };
}

// ---------------------------------------------------------------- person

type PersonForScan = { id: string; display_name: string; title: string | null; location: string | null; email: string | null; phone: string | null; linkedin_url: string | null; website: string | null; instagram: string | null; facebook: string | null; tiktok: string | null; x_handle: string | null };

const PERSON_KEYS_PROMPT = [
	'  title: their job title',
	'  location: city, state / country',
	'  email: their own email address, exactly as written',
	'  phone: their own phone number, exactly as written',
	'  linkedin_url, instagram, facebook, tiktok, x_handle: their personal profile URLs or handles',
	'  website: their personal website',
].join('\n');

export async function scanPerson(db: Db, personId: string, actorId: string): Promise<ScanOutcome | null> {
	const { data } = await db.from('rev_people').select('id, display_name, title, location, email, phone, linkedin_url, website, instagram, facebook, tiktok, x_handle').eq('id', personId).maybeSingle();
	if (!data) return null;
	const person = data as PersonForScan;
	const notes: SourceNote[] = [];
	const fromSite: Record<string, string> = {};
	const fromLinkedin: Record<string, string> = {};
	let linkedinLeft: number | null = null;
	const adapter = textAdapter();

	// Website: the person's primary brand (or any linked brand) with a site.
	const { data: links } = await db.from('rev_person_links').select('is_primary, rev_brands(name, website, domain)').eq('person_id', person.id).not('brand_id', 'is', null);
	const brands = ((links ?? []) as unknown as { is_primary: boolean; rev_brands: { name: string; website: string | null; domain: string | null } | { name: string; website: string | null; domain: string | null }[] | null }[])
		.sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
		.map((l) => (Array.isArray(l.rev_brands) ? l.rev_brands[0] : l.rev_brands))
		.filter((b): b is { name: string; website: string | null; domain: string | null } => !!b && !!(b.website || b.domain));
	const brand = brands[0] ?? null;
	if (!brand) notes.push({ source: 'website', status: 'skipped', detail: 'No linked brand with a website.' });
	else if (!adapter) notes.push({ source: 'website', status: 'skipped', detail: 'AI is not configured in this deployment.' });
	else {
		const site = await readSite(brand.website ?? `https://${brand.domain}`);
		if (!site) notes.push({ source: 'website', status: 'failed', detail: `Could not load ${brand.website ?? brand.domain}.` });
		else {
			const raw = await extract(adapter, [
				`Person: ${person.display_name}${person.title ? ` (${person.title})` : ''}, at ${brand.name}.`,
				'Find this person in the source. Fill a key only when the text clearly refers to THIS person; company-wide contacts (info@, the main phone line) do not count.',
				'Return JSON with these keys:',
				PERSON_KEYS_PROMPT,
				'',
				'SOURCE TEXT:',
				site.text,
			].join('\n'));
			Object.assign(fromSite, cleanFound('person', raw, site.text));
			const n = Object.keys(fromSite).length;
			notes.push({ source: 'website', status: 'ok', detail: `Read ${site.pages.length} page${site.pages.length === 1 ? '' : 's'} of ${new URL(site.pages[0]).hostname}; ${n ? `${n} field${n === 1 ? '' : 's'} about ${person.display_name}` : `${person.display_name} not mentioned`}.` });
		}
	}

	// LinkedIn: only with a profile URL and a token, within the daily allowance.
	const profileUrl = person.linkedin_url && /linkedin\.com\/in\//i.test(person.linkedin_url) ? person.linkedin_url : null;
	if (!profileUrl) notes.push({ source: 'linkedin', status: 'skipped', detail: 'No LinkedIn profile URL on this person.' });
	else if (!process.env.APIFY_TOKEN) notes.push({ source: 'linkedin', status: 'skipped', detail: 'LinkedIn scanning is not set up (APIFY_TOKEN).' });
	else if (!adapter) notes.push({ source: 'linkedin', status: 'skipped', detail: 'AI is not configured in this deployment.' });
	else {
		const used = await linkedinScansUsed(actorId);
		if (used >= LINKEDIN_SCANS_PER_DAY) {
			linkedinLeft = 0;
			notes.push({ source: 'linkedin', status: 'skipped', detail: `You used all ${LINKEDIN_SCANS_PER_DAY} LinkedIn scans of the last 24 hours.` });
		} else {
			// Count the scan before it runs: a failed run is still billed.
			const svc = createServiceRoleClient();
			const { error: quotaErr } = await svc.from('audit_log').insert({ actor_id: actorId, entity_kind: 'supabase', entity_ref: `rev_people/${person.id}`, action: LINKEDIN_ACTION, diff: { url: profileUrl }, status: 'success' });
			linkedinLeft = LINKEDIN_SCANS_PER_DAY - used - 1;
			if (quotaErr) notes.push({ source: 'linkedin', status: 'failed', detail: 'Could not record the scan against your daily allowance, so it did not run.' });
			else {
				try {
					const profile = await runLinkedin(profileUrl);
					if (!profile) notes.push({ source: 'linkedin', status: 'failed', detail: 'LinkedIn returned no profile.' });
					else {
						const json = JSON.stringify(profile).slice(0, 15_000);
						const raw = await extract(adapter, [
							`LinkedIn profile data (JSON) for ${person.display_name}.`,
							'Return JSON with these keys:',
							'  title: their current job title (current position, else headline)',
							'  location: their location as written',
							'  website: a personal or company website listed on the profile',
							'  email: only if an email address appears in the data',
							'',
							'SOURCE JSON:',
							json,
						].join('\n'));
						Object.assign(fromLinkedin, cleanFound('person', raw, json));
						notes.push({ source: 'linkedin', status: 'ok', detail: `Read the LinkedIn profile. ${linkedinLeft} LinkedIn scan${linkedinLeft === 1 ? '' : 's'} left today.` });
					}
				} catch (e) {
					notes.push({ source: 'linkedin', status: 'failed', detail: e instanceof Error ? e.message.replace(/token=[^&\s]+/g, 'token=…').slice(0, 200) : 'LinkedIn scan failed.' });
				}
			}
		}
	}

	// LinkedIn is the better source for title and location; the site for the rest.
	const found: Record<string, { value: string; source: ScanSource }> = {};
	for (const [k, v] of Object.entries(fromSite)) found[k] = { value: v, source: 'website' };
	for (const [k, v] of Object.entries(fromLinkedin)) if (!found[k] || k === 'title' || k === 'location') found[k] = { value: v, source: 'linkedin' };
	const current: Record<string, string | null> = { ...person };
	return { target: 'person', id: person.id, name: person.display_name, fields: buildDiff('person', current, found), notes, linkedinLeft };
}
