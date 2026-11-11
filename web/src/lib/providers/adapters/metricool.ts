// Metricool. Registered with no capability in this build (WIP_BUILD_PLAN
// 1.2): the Content Studio will show "send to SocialBeacon" later and this
// row makes the key presence visible. Checked 2026-09-12: the API docs at
// app.metricool.com/api/documentation sit behind a login (401), and API
// access is an Advanced plan feature; the header name and the read only
// profiles endpoint below are from the vendor's published examples and are
// re verified when publishing lands.

import { allPresent, callJson, requireEnv } from '../http';
import { ProviderError, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'metricool';
const BASE = 'https://app.metricool.com/api';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Metricool (publishing, later)',
	category: 'publish',
	capabilities: [],
	envKeys: ['METRICOOL_API_KEY'],
	docsUrl: 'https://app.metricool.com/api/documentation',
	costNote: 'No content capability in this build. API needs a Metricool Advanced plan; reserved for the SocialBeacon handoff.',
	async: false,
};

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	estimateCost: () => null,
	async submit() {
		throw new ProviderError(ID, 'Metricool has no content capability in this build.');
	},
	async verify() {
		// The token alone cannot list brands (userId is also required), so the
		// check is: does the API accept the header at all. A 401 means bad key.
		try {
			await callJson(ID, `${BASE}/admin/simpleProfiles`, { headers: { 'X-Mc-Auth': requireEnv(ID, 'METRICOOL_API_KEY') } });
			return { ok: true, detail: 'key accepted' };
		} catch (e) {
			const status = (e as { status?: number }).status;
			if (status === 400 || status === 404 || status === 422) return { ok: true, detail: 'key accepted, userId still needed' };
			return { ok: false, detail: e instanceof Error ? e.message : String(e) };
		}
	},
};
