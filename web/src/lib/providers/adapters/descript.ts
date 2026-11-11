// Descript. Checked 2026-09-12: Descript has no public REST API for editing
// or transcription; descript.com/developers offers a Zapier connector, the
// "Edit in Descript" import URL scheme, and a partner API by invitation only.
// The slot ships so the Clips and editing page can list it; it stays
// "Ready, key not set" until Descript grants partner access. Transcription
// is covered today by deepgram, assemblyai, elevenlabs and openai.

import { ProviderError, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'descript';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Descript',
	category: 'edit',
	capabilities: ['edit_video', 'transcribe'],
	envKeys: ['DESCRIPT_API_KEY'],
	docsUrl: 'https://www.descript.com/developers',
	costNote: 'No public API as of September 2026; partner API by invitation. Slot reserved, nothing runs.',
	async: true,
};

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => false,
	estimateCost: () => null,
	async submit() {
		throw new ProviderError(ID, 'Descript has no public API. The slot is reserved for a partner agreement.');
	},
	async poll() {
		return { status: 'failed', error: 'Descript has no public API.' };
	},
};
