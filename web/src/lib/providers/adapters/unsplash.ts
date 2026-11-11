// Unsplash. Verified 2026-09-12 against unsplash.com/documentation: GET
// /search/photos?query= with Authorization: Client-ID <key> and
// Accept-Version v1 returns results[] with urls.* and user.name. Free; demo
// apps get 50 requests an hour. Photos must be hotlinked from urls.* and
// links.download_location pinged on download, so no bytes go to the bucket.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'unsplash';
const BASE = 'https://api.unsplash.com';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Unsplash (stock photos)',
	category: 'stock',
	capabilities: ['search_stock'],
	envKeys: ['UNSPLASH_ACCESS_KEY'],
	docsUrl: 'https://unsplash.com/documentation',
	costNote: 'Free; 50 requests an hour in demo mode, 5,000 after production approval. Hotlink and credit the photographer.',
	async: false,
};

function auth() {
	return { authorization: `Client-ID ${requireEnv(ID, 'UNSPLASH_ACCESS_KEY')}`, 'Accept-Version': 'v1' };
}

interface SearchOut {
	total?: number;
	results?: {
		id: string;
		alt_description?: string | null;
		width?: number;
		height?: number;
		urls?: { raw?: string; full?: string; regular?: string; small?: string };
		links?: { html?: string; download_location?: string };
		user?: { name?: string };
	}[];
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: () => 0,
	async submit(input: ContentJobInput) {
		if (input.capability !== 'search_stock') unsupported(ID, input.capability);
		const qs = new URLSearchParams({ query: input.query, per_page: String(input.count ?? 10) });
		if (input.orientation === 'square') qs.set('orientation', 'squarish');
		else if (input.orientation) qs.set('orientation', input.orientation);
		const res = await callJson<SearchOut>(ID, `${BASE}/search/photos?${qs}`, { headers: auth() });
		const results = (res.results ?? []).map((p) => ({
			id: p.id,
			page: p.links?.html,
			image: p.urls?.regular,
			original: p.urls?.full,
			download_location: p.links?.download_location,
			credit: p.user?.name,
			alt: p.alt_description ?? undefined,
			width: p.width,
			height: p.height,
		}));
		return { result: { assets: [], providerMeta: { total: res.total ?? results.length, results } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/photos?per_page=1`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
