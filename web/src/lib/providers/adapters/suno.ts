// Suno. Checked 2026-09-12: suno.com publishes no developer API, endpoint
// or key issuance; only private partner integrations exist. Third party
// wrappers (sunoapi.org, gcui-art/suno-api) proxy the web app against
// Suno's terms and are not an official integration. The slot ships so the
// registry and the Content Studio picker know the capability exists; it
// stays "Ready, key not set" until Suno offers a public API.

import { ProviderError, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'suno';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Suno',
	category: 'music',
	capabilities: ['generate_music'],
	envKeys: ['SUNO_API_KEY'],
	docsUrl: 'https://suno.com/',
	costNote: 'No public API as of September 2026; needs a Suno partner agreement. Slot reserved, nothing runs.',
	async: true,
};

export const adapter: ProviderAdapter = {
	spec,
	// Deliberately false even with a key set: there is no endpoint to call.
	isConfigured: () => false,
	estimateCost: () => null,
	async submit() {
		throw new ProviderError(ID, 'Suno has no public API yet. The slot is reserved for when one exists.');
	},
	async poll() {
		return { status: 'failed', error: 'Suno has no public API yet.' };
	},
};
