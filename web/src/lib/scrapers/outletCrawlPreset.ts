// Media Scraper preset: outlet_crawl (haketa/email-extractor).
//
// Crawl an outlet's public pages (home, /contact, /about, /team, /staff,
// /newsroom...) for published mailboxes, phones and social profiles. One
// input URL -> one output row per website, so this preset stages
// media_outlet rows (newsroom@, press@, editor@ are outlet contacts, not a
// person's). Journalists with a byline come from news_journalists; this is
// the "give me the newsroom desk for these 40 outlets" tool.
//
// Chosen over delicious_zebu/contact-info-scraper (5 stars, 782 users) because
// that one is a $15/month rental and the plan's cost envelope wants pay per
// run; haketa is pay per event with a comparable feature set (Cloudflare
// email-protection decoding, DE/IT/ES contact paths, eight socials).
//
// Input schema read from the live Apify store on 2026-09-19 (build 1.0.4):
// startUrls [{url}], maxWebsites, maxPagesPerDomain (1-30), contactPaths,
// includeSocials, includePhones, decodeObfuscatedEmails, maxConcurrency,
// requestDelay, proxyConfiguration. Output per site: inputUrl, rootDomain,
// title, emails[], phones[], linkedinUrl, twitterUrl, facebookUrl,
// instagramUrl, youtubeUrl, githubUrl, tiktokUrl, pinterestUrl, emailCount,
// phoneCount, socialCount, pagesScraped[], fetchedPagesCount, errors, scrapedAt.
//
// COST: $0.002 per website row (Free tier) plus a negligible start event.

import type { MediaRecord } from '@/lib/scrapers/newsJournalistsPreset';
import { isRoleMailbox, normalizeDomain } from '@/lib/scrapers/newsJournalistsPreset';

export const OUTLET_CRAWL_ACTOR = 'haketa/email-extractor';
export const OUTLET_CRAWL_PRESET = 'outlet_crawl' as const;

export const USD_PER_WEBSITE = 0.002;
export const MAX_WEBSITES = 1000;
export const MIN_PAGES_PER_DOMAIN = 1;
export const MAX_PAGES_PER_DOMAIN = 30;

/** Newsroom-shaped paths first; the actor's own defaults cover /contact and
 *  /about. Order matters: page 1 is the URL given, later pages come from here. */
export const NEWSROOM_PATHS = ['/contact', '/about', '/staff', '/team', '/masthead', '/newsroom', '/editorial', '/about-us', '/contact-us', '/press'];

export interface OutletCrawlParams {
	/** Bare domains or full URLs, one per outlet. */
	websites: string[];
	/** Pages per site, 1-30 (default 6). More pages, more chance of a masthead. */
	maxPagesPerDomain?: number;
	includeSocials?: boolean;
	includePhones?: boolean;
	/** Beats to stamp on the staged rows, when the operator says what these
	 *  outlets cover. */
	beats?: string[];
}

export function estimateOutletCrawlCostUsd(websiteCount: number): number {
	const n = Math.min(Math.max(0, websiteCount), MAX_WEBSITES);
	return Math.round(n * USD_PER_WEBSITE * 1000) / 1000;
}

/** Pasted lines or commas -> unique, normalised domains. */
export function parseWebsiteLines(text: string): string[] {
	const out = new Set<string>();
	for (const raw of text.split(/[\n,]/)) {
		const d = normalizeDomain(raw.trim());
		if (d) out.add(d);
	}
	return [...out].slice(0, MAX_WEBSITES);
}

export function hasOutletCrawlTargeting(params: OutletCrawlParams): boolean {
	return params.websites.length > 0;
}

export function buildOutletCrawlInput(params: OutletCrawlParams, maxResults: number): Record<string, unknown> {
	const sites = params.websites.slice(0, Math.min(maxResults, MAX_WEBSITES));
	const pages = Math.min(MAX_PAGES_PER_DOMAIN, Math.max(MIN_PAGES_PER_DOMAIN, Math.round(params.maxPagesPerDomain ?? 6)));
	return {
		startUrls: sites.map((d) => ({ url: d.includes('://') ? d : `https://${d}` })),
		maxWebsites: sites.length,
		maxPagesPerDomain: pages,
		contactPaths: NEWSROOM_PATHS,
		includeSocials: params.includeSocials ?? true,
		includePhones: params.includePhones ?? false,
		decodeObfuscatedEmails: true,
		maxConcurrency: 5,
		requestDelay: 800,
	};
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * One website row -> one media_outlet staging row. The best mailbox is the
 * first role mailbox on the outlet's own domain (newsroom@, editor@, press@);
 * failing that the first email on the outlet's domain; failing that nothing
 * (off-domain emails like support@cloudflare.com are noise the actor's own
 * docs warn about). All on-domain emails ride in raw for the reviewer.
 */
export function normalizeOutletCrawlItem(item: Record<string, unknown>, params: OutletCrawlParams | null): MediaRecord | null {
	const domain = normalizeDomain(item.rootDomain) ?? normalizeDomain(item.inputUrl);
	if (!domain) return null;
	const emails = (Array.isArray(item.emails) ? item.emails : [])
		.filter((e): e is string => typeof e === 'string')
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`));
	const best = emails.find(isRoleMailbox) ?? emails[0] ?? null;
	const title = str(item.title);
	// "Stripe | Financial Infrastructure..." -> "Stripe"
	const name = title ? title.split(/\s+[|–—-]\s+/)[0].trim() || domain : domain;
	return {
		kind: 'media_outlet',
		dedupKey: domain.slice(0, 400),
		fullName: null,
		firstName: null,
		lastName: null,
		email: best,
		emailStatus: best ? 'verified' : 'not_found',
		jobTitle: null,
		outletName: name,
		outletDomain: domain,
		companyWebsite: str(item.inputUrl) ?? `https://${domain}`,
		companyLinkedin: str(item.linkedinUrl),
		linkedinUrl: null,
		beats: params?.beats ?? [],
		evidence: [],
		sourceUrl: Array.isArray(item.pagesScraped) && typeof item.pagesScraped[0] === 'string' ? (item.pagesScraped[0] as string) : null,
		raw: { ...item, onDomainEmails: emails },
	};
}

export function normalizeOutletCrawlPage(
	items: Record<string, unknown>[],
	params: OutletCrawlParams | null,
): { records: MediaRecord[]; skipped: number } {
	const records: MediaRecord[] = [];
	const seen = new Set<string>();
	let skipped = 0;
	for (const item of items) {
		const r = normalizeOutletCrawlItem(item, params);
		if (!r || seen.has(r.dedupKey)) {
			skipped += 1;
			continue;
		}
		seen.add(r.dedupKey);
		records.push(r);
	}
	return { records, skipped };
}
