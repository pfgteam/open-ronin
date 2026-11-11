// Pexels. Verified 2026-09-12 against pexels.com/api/documentation: GET
// /v1/search?query= (Authorization: raw key) returns photos[] with src.*
// and photographer. Free; 200 requests an hour by default. Results are
// references to Pexels hosted images (attribution required), so the job
// output carries URLs in providerMeta and no bytes are copied to the bucket.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'pexels';
const BASE = 'https://api.pexels.com/v1';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Pexels (stock photos)',
	category: 'stock',
	capabilities: ['search_stock'],
	envKeys: ['PEXELS_API_KEY'],
	docsUrl: 'https://www.pexels.com/api/documentation/',
	costNote: 'Free; 200 requests an hour. Attribution to Pexels and the photographer is required where a photo is shown.',
	async: false,
};

function auth() {
	return { authorization: requireEnv(ID, 'PEXELS_API_KEY') };
}

interface SearchOut {
	total_results?: number;
	photos?: { id: number; url: string; photographer?: string; alt?: string; width?: number; height?: number; src?: { original?: string; large?: string; medium?: string } }[];
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: () => 0,
	async submit(input: ContentJobInput) {
		if (input.capability !== 'search_stock') unsupported(ID, input.capability);
		const qs = new URLSearchParams({ query: input.query, per_page: String(input.count ?? 10) });
		if (input.orientation) qs.set('orientation', input.orientation);
		const res = await callJson<SearchOut>(ID, `${BASE}/search?${qs}`, { headers: auth() });
		const results = (res.photos ?? []).map((p) => ({
			id: String(p.id),
			page: p.url,
			image: p.src?.large ?? p.src?.original,
			original: p.src?.original,
			credit: p.photographer,
			alt: p.alt,
			width: p.width,
			height: p.height,
		}));
		return { result: { assets: [], providerMeta: { total: res.total_results ?? results.length, results } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/curated?per_page=1`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
