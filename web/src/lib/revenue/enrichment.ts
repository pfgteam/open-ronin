// Revenue Engine enrichment (0122, spec §3 "auto-fill fit signals from
// enrichment", §15 "enrichment providers pluggable"). Server-only.
//
// Shape: an EnrichmentProvider looks at a brand (or person) and returns
// facts; the runner merges the facts into rev_brands.enrichment /
// rev_people.enrichment, fills blanks (industry, website, socials), writes
// the fit signals it can prove (website 0-3, work_email), appends an
// `ai_fit_summary` on the open deals, marks the row done, and rescores.
//
// Providers today:
//   website_probe   no key. Fetches the brand's homepage, scores it 0-3 on
//                   the MQL checklist (loads, testimonials, booking/phone,
//                   client list, media, staff, products, socials), pulls
//                   title/description/social links.
//   ai_summary      Anthropic or OpenAI through the existing provider
//                   registry (generate_text). Only runs when a text provider
//                   is configured; writes the 2-sentence fit explanation.
//   apollo / prospeo / clay   stubs: isConfigured() false until a key env is
//                   set; listed in Admin so the team can see what plugs in.
//
// The cron (/api/cron/revenue) drains `enrichment_status = 'pending'` rows
// in small batches; the deal page has a "Enrich now" button for one brand.

import type { SupabaseClient } from '@supabase/supabase-js';
import { adaptersFor } from '@/lib/providers/registry';

type Db = SupabaseClient;

export interface BrandForEnrichment {
	id: string;
	name: string;
	domain: string | null;
	website: string | null;
	industry: string | null;
	vertical: string | null;
	socials: Record<string, string>;
	description: string | null;
	enrichment: Record<string, unknown>;
}

export interface EnrichmentFacts {
	/** Merged into rev_brands.enrichment under the provider's key. */
	facts: Record<string, unknown>;
	/** Fill-if-blank patches on the brand row. */
	brand?: Partial<Pick<BrandForEnrichment, 'website' | 'domain' | 'industry' | 'vertical' | 'description'>> & { socials?: Record<string, string> };
	/** Fit signals this provider can assert (merged into every open deal's fit_signals). */
	fit?: Record<string, unknown>;
	/** Short AI fit explanation for the deal page. */
	summary?: string;
}

export interface EnrichmentProvider {
	id: string;
	label: string;
	/** Env var names the provider needs; empty = always on. */
	envKeys: string[];
	note: string;
	isConfigured(): boolean;
	enrichBrand(brand: BrandForEnrichment): Promise<EnrichmentFacts | null>;
}

// ---------------------------------------------------------------- website_probe

export const SOCIAL_HOSTS: Record<string, RegExp> = {
	instagram: /https?:\/\/(www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i,
	facebook: /https?:\/\/(www\.)?facebook\.com\/([A-Za-z0-9_.\-]+)/i,
	tiktok: /https?:\/\/(www\.)?tiktok\.com\/@([A-Za-z0-9_.]+)/i,
	x: /https?:\/\/(www\.)?(x|twitter)\.com\/([A-Za-z0-9_]+)/i,
	linkedin: /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/([A-Za-z0-9_\-]+)/i,
	youtube: /https?:\/\/(www\.)?youtube\.com\/(@|channel\/|c\/)?([A-Za-z0-9_\-]+)/i,
};

function meta(html: string, name: string): string | null {
	const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
	const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, 'i');
	return html.match(re)?.[1] ?? html.match(re2)?.[1] ?? null;
}

export function scoreWebsite(html: string): { score: 0 | 1 | 2 | 3; checks: Record<string, boolean> } {
	const low = html.toLowerCase();
	const checks = {
		testimonials: /testimonial|what our (clients|customers) say|reviews?\b/.test(low),
		booking_or_phone: /book (a )?(call|demo|consult)|calendly|schedule|tel:|\(\d{3}\)\s?\d{3}-\d{4}/.test(low),
		client_list: /our clients|trusted by|as seen|clients include|brands we/.test(low),
		media: /press|in the news|featured in|media kit|as seen (in|on)/.test(low),
		staff: /our team|meet the team|about us|founder|leadership/.test(low),
		products: /shop|products|services|pricing|menu|catalog/.test(low),
		socials: Object.values(SOCIAL_HOSTS).some((re) => re.test(html)),
		substantial: html.length > 20_000,
	};
	const hits = Object.values(checks).filter(Boolean).length;
	const score: 0 | 1 | 2 | 3 = hits >= 6 ? 3 : hits >= 4 ? 2 : 1;
	return { score, checks };
}

export const websiteProbe: EnrichmentProvider = {
	id: 'website_probe',
	label: 'Website probe (built in)',
	envKeys: [],
	note: 'Fetches the homepage and scores it 0-3 on the MQL checklist; pulls title, description and social links. No key.',
	isConfigured: () => true,
	async enrichBrand(brand) {
		const url = brand.website ?? (brand.domain ? `https://${brand.domain}` : null);
		if (!url) return null;
		let res: Response;
		try {
			res = await fetch(url, {
				redirect: 'follow',
				signal: AbortSignal.timeout(10_000),
				headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenRoninBot/1.0; +https://app.example.com)', accept: 'text/html' },
			});
		} catch (e) {
			return { facts: { loads: false, error: (e as Error).message, checked_at: new Date().toISOString() }, fit: { website: 0 } };
		}
		if (!res.ok) return { facts: { loads: false, status: res.status, checked_at: new Date().toISOString() }, fit: { website: 0 } };
		const html = (await res.text()).slice(0, 400_000);
		const { score, checks } = scoreWebsite(html);
		const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
		const description = meta(html, 'description') ?? meta(html, 'og:description');
		const socials: Record<string, string> = {};
		for (const [k, re] of Object.entries(SOCIAL_HOSTS)) {
			const m = html.match(re);
			if (m) socials[k] = m[0].replace(/["'>].*$/, '');
		}
		const finalUrl = res.url || url;
		const domain = (() => {
			try {
				return new URL(finalUrl).hostname.replace(/^www\./, '');
			} catch {
				return brand.domain;
			}
		})();
		return {
			facts: { loads: true, status: res.status, score, checks, title, description, final_url: finalUrl, checked_at: new Date().toISOString() },
			brand: { website: brand.website ?? finalUrl, domain: brand.domain ?? domain ?? undefined, description: brand.description ?? description ?? undefined, socials },
			fit: { website: score },
		};
	},
};

// ---------------------------------------------------------------- ai_summary

export const aiSummary: EnrichmentProvider = {
	id: 'ai_summary',
	label: 'AI fit summary',
	envKeys: ['ANTHROPIC_API_KEY or OPENAI_API_KEY'],
	note: 'Two-sentence fit explanation from the brand facts, through the configured text provider (Anthropic first, then OpenAI). Nothing is sent externally without a human: this writes to the deal page only.',
	isConfigured: () => adaptersFor('generate_text').some((a) => a.isConfigured()),
	async enrichBrand(brand) {
		const adapter = adaptersFor('generate_text').find((a) => a.isConfigured());
		if (!adapter) return null;
		const facts = brand.enrichment?.website_probe as Record<string, unknown> | undefined;
		const prompt = [
			`Brand: ${brand.name}`,
			brand.domain ? `Website: ${brand.domain}` : null,
			brand.industry ? `Industry: ${brand.industry}` : null,
			facts?.title ? `Site title: ${facts.title}` : null,
			facts?.description ? `Site description: ${facts.description}` : null,
			facts?.score != null ? `Website quality 0-3: ${facts.score}` : null,
			'',
			'Open Ronin is a purpose-driven PR agency (PR retainers $4,750-$25,000/mo, social media, Beacon low-ticket PR subscriptions $99-$999/mo). Target: CPG (food, beverage, beauty, fashion), health & wellness, B2B services, personalities/executives.',
			'In two sentences: is this brand a fit, and what is the likely angle / package? Plain text, no markdown.',
		]
			.filter((x) => x !== null)
			.join('\n');
		const out = await adapter.submit({ capability: 'generate_text', prompt, maxTokens: 200 });
		const text = 'result' in out ? out.result.text?.trim() : undefined;
		if (!text) return null;
		return { facts: { model: adapter.spec.id, generated_at: new Date().toISOString() }, summary: text.slice(0, 600) };
	},
};

// ---------------------------------------------------------------- stubs

function stub(id: string, label: string, envKey: string, note: string): EnrichmentProvider {
	return {
		id,
		label,
		envKeys: [envKey],
		note,
		isConfigured: () => !!process.env[envKey],
		async enrichBrand() {
			// Wire the vendor call here once the team confirms the provider and the key lands in Vercel.
			return null;
		},
	};
}

export const PROVIDERS: readonly EnrichmentProvider[] = [
	websiteProbe,
	aiSummary,
	stub('apollo', 'Apollo', 'APOLLO_API_KEY', 'Company + people enrichment (revenue, headcount, emails). Stub: adapter body lands when the key does.'),
	stub('prospeo', 'Prospeo', 'PROSPEO_API_KEY', 'Email finder / verification. Stub.'),
	stub('clay', 'Clay', 'CLAY_API_KEY', 'No longer used (decision 2026-10-01). Kept as a stub in case it returns.'),
];

// ---------------------------------------------------------------- runner

export interface EnrichLog {
	brand_id: string;
	providers: string[];
	status: 'done' | 'failed' | 'skipped';
	error?: string;
	fit?: Record<string, unknown>;
}

export async function enrichBrand(db: Db, brandId: string): Promise<EnrichLog> {
	const { data } = await db.from('rev_brands').select('id, name, domain, website, industry, vertical, socials, description, enrichment').eq('id', brandId).maybeSingle();
	const brand = data as BrandForEnrichment | null;
	if (!brand) return { brand_id: brandId, providers: [], status: 'failed', error: 'brand not found' };
	await db.from('rev_brands').update({ enrichment_status: 'running' }).eq('id', brandId);
	const ran: string[] = [];
	let enrichment = { ...(brand.enrichment ?? {}) };
	const patch: Record<string, unknown> = {};
	let fit: Record<string, unknown> = {};
	let summary: string | null = null;
	try {
		for (const p of PROVIDERS) {
			if (!p.isConfigured()) continue;
			const current: BrandForEnrichment = { ...brand, ...(patch as Partial<BrandForEnrichment>), enrichment };
			const out = await p.enrichBrand(current).catch((e: Error) => ({ facts: { error: e.message }, fit: undefined, brand: undefined, summary: undefined }) as EnrichmentFacts);
			if (!out) continue;
			ran.push(p.id);
			enrichment = { ...enrichment, [p.id]: out.facts };
			if (out.brand) {
				for (const [k, v] of Object.entries(out.brand)) {
					if (v == null || v === '') continue;
					if (k === 'socials') {
						const merged = { ...(out.brand.socials ?? {}), ...(brand.socials ?? {}), ...((patch.socials as Record<string, string>) ?? {}) };
						patch.socials = merged;
					} else if (!(brand as unknown as Record<string, unknown>)[k] && !patch[k]) {
						patch[k] = v;
					}
				}
			}
			if (out.fit) fit = { ...fit, ...out.fit };
			if (out.summary) summary = out.summary;
		}
		await db
			.from('rev_brands')
			.update({ ...patch, enrichment, enrichment_status: ran.length ? 'done' : 'skipped', enriched_at: new Date().toISOString() })
			.eq('id', brandId);
		if (Object.keys(fit).length || summary) {
			const { data: deals } = await db.from('rev_deals').select('id, fit_signals').eq('brand_id', brandId).eq('status', 'open');
			for (const d of (deals ?? []) as { id: string; fit_signals: Record<string, unknown> }[]) {
				const next = { ...(d.fit_signals ?? {}) };
				for (const [k, v] of Object.entries(fit)) if (next[k] == null) next[k] = v;
				await db
					.from('rev_deals')
					.update({ fit_signals: next, ...(summary ? { ai_fit_summary: summary } : {}) })
					.eq('id', d.id);
			}
		}
		return { brand_id: brandId, providers: ran, status: ran.length ? 'done' : 'skipped', fit };
	} catch (e) {
		await db.from('rev_brands').update({ enrichment_status: 'failed', enrichment: { ...enrichment, error: (e as Error).message } }).eq('id', brandId);
		return { brand_id: brandId, providers: ran, status: 'failed', error: (e as Error).message };
	}
}

/** Drain pending brands, oldest first. */
export async function enrichPending(db: Db, limit = 10): Promise<EnrichLog[]> {
	const { data } = await db.from('rev_brands').select('id').eq('enrichment_status', 'pending').order('created_at').limit(limit);
	const out: EnrichLog[] = [];
	for (const b of (data ?? []) as { id: string }[]) out.push(await enrichBrand(db, b.id));
	return out;
}
