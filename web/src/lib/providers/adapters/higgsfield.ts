// Higgsfield Open API. Verified 2026-09-19 against docs.higgsfield.ai/docs:
// POST https://api.higgsfield.ai/<provider>/<model>/<endpoint> with
// Authorization: Key KEY_ID:SECRET (also legacy HF_API_KEY_ID / HF_API_KEY_SECRET
// headers); GET https://api.higgsfield.ai/requests/<request_id>/status polls
// an async request. Models cover video (Seedance, Kling, Wan, LTX, Grok Imagine,
// MiniMax H3, …) and image (Genjutsu, Cinema Studio, Qwen Image, Ideogram,
// Recraft, Happy Horse, …) generation. Pricing is metered per-model per-second
// / per-image; the /higgsfield-api marketing page lists individual model rates.
//
// This is a scaffold / ideation stub only. the org's own models are later attached
// via the Spine rather than Higgsfield's live backend, so submit() and poll()
// are TODO stubs — no live paid API call is made from this file.

import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'higgsfield';
const BASE = 'https://api.higgsfield.ai';

export const spec: ProviderSpec = {
	id: ID,
	label: 'Higgsfield (Open API)',
	category: 'video',
	capabilities: ['generate_video', 'generate_image'],
	// Scaffold / unconfigured: no env key is required to be present. When this
	// adapter goes live it will need HF_API_KEY_ID + HF_API_KEY_SECRET (or the
	// Authorization header form). isConfigured() therefore always returns false.
	envKeys: [],
	docsUrl: 'https://docs.higgsfield.ai/docs',
	costNote: 'Metered per model per second/image; rates published on higgsfield.ai/higgsfield-api. Not wired for live spend yet.',
	async: true,
};

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => false,
	async submit(input: ContentJobInput) {
		// TODO: real implementation — pick provider/model path from input.model,
		// build the POST body from the documented model endpoint shape, send
		// Authorization: Key KEY_ID:SECRET, return { providerRef: requestId }.
		// Auth headers read from env inside submit (never surfaced to UI).
		// No live call now — see task t_0f42f979.
		if (input.capability === 'generate_video') {
			// TODO: map input to a Higgsfield video endpoint. The marketing page
			// lists Seedance 2.0/2.5, Kling 3.0/2.6, Wan 3.0/2.7, LTX 2.5,
			// Grok Imagine 1.5/2.0, MiniMax H3, Happy Horse, PixVerse 6, …
			// as video models. A real call looks like:
			//
			//   POST https://api.higgsfield.ai/bytedance/seedance-2.0/text-to-video
			//   Authorization: Key ${HF_API_KEY_ID}:${HF_API_KEY_SECRET}
			//   { prompt, resolution, generate_audio, duration, aspect_ratio }
			//
			// Return { providerRef: res.id } where res.id is the request id used
			// by poll(). Model/path selection via input.model once we know which
			// models Open Ronin wants to expose.
			return { providerRef: 'TODO-higgsfield-request-id' };
		}
		if (input.capability === 'generate_image') {
			// TODO: map input to a Higgsfield image endpoint. Image models listed
			// on the marketing page include Genjutsu, Cinema Studio 4.0, Qwen
			// Image 3, Z-Image Turbo, Ideogram 4.0, Recraft 4.1, Happy Horse 1.0/
			// 1.1. A real call uses the same Authorization header and a model-
			// specific path; return { providerRef: res.id }.
			return { providerRef: 'TODO-higgsfield-request-id' };
		}
		unsupported(ID, input.capability);
	},
	async poll(providerRef: string) {
		// TODO: GET https://api.higgsfield.ai/requests/${providerRef}/status
		// with the same Authorization header. The response documents a request
		// state machine (queued / processing / succeeded / failed). On succeeded
		// return { status: 'done', result: { assets: […], providerMeta: {…} } };
		// on failed return { status: 'failed', error: … }; otherwise
		// { status: 'running' }. No live call now — see task t_0f42f979.
		return { status: 'running' };
	},
	async verify() {
		// TODO: a cheap key check. The docs do not currently publish a free
		// account/balance endpoint analogous to Runway's GET /v1/organization,
		// so verify is left as a TODO until we confirm one exists or until the
		// Spine replaces live Higgsfield usage entirely. No live call now.
		return { ok: false, detail: 'Higgsfield verify not implemented (scaffold)' };
	},
};
