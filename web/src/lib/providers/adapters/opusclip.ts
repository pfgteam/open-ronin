// OpusClip. Verified 2026-09-12 against help.opus.pro/api-reference and its
// OpenAPI spec (help.opus.pro/api-reference/openapi.json): POST
// /api/clip-projects (Authorization Bearer) returns a project with id and
// stage PENDING, QUEUED, IMPORT, CURATE, REFINE, RENDER, UPLOAD, COMPLETE,
// STALLED; GET /api/exportable-clips?q=findByProjectId&projectId= lists
// clips with uriForExport, title, durationMs. API access needs a Pro (Beta),
// Max or Business plan; the standard rate limit is 30 requests a minute.

import { allPresent, callJson, requireEnv } from '../http';
import { unsupported, type ContentJobInput, type ProviderAdapter, type ProviderSpec } from '../types';

const ID = 'opusclip';
const BASE = 'https://api.opus.pro/api';

export const spec: ProviderSpec = {
	id: ID,
	label: 'OpusClip',
	category: 'clip',
	capabilities: ['clip_video'],
	envKeys: ['OPUSCLIP_API_KEY'],
	docsUrl: 'https://help.opus.pro/api-reference/overview',
	costNote: 'API on Pro (Beta), Max or Business plans; billed in credits per minute of source video, 15 API hours a month on Pro and Max.',
	async: true,
};

function auth() {
	return { authorization: `Bearer ${requireEnv(ID, 'OPUSCLIP_API_KEY')}` };
}

interface Project {
	id?: string;
	projectId?: string;
	stage?: string;
	error?: string | null;
}
interface Clip {
	id: string;
	uriForExport?: string;
	title?: string;
	durationMs?: number;
}

export const adapter: ProviderAdapter = {
	spec,
	isConfigured: () => allPresent(spec.envKeys),
	// One credit is roughly a minute of source video on the published plans; a 10 minute video is the working assumption.
	estimateCost: (input: ContentJobInput) => (input.capability === 'clip_video' ? 1.0 : null),
	async submit(input: ContentJobInput) {
		if (input.capability !== 'clip_video') unsupported(ID, input.capability);
		const res = await callJson<Project>(ID, `${BASE}/clip-projects`, { headers: auth(), body: { videoUrl: input.videoUrl } });
		const id = res.id ?? res.projectId;
		if (!id) throw new Error('OpusClip returned no project id');
		return { providerRef: id };
	},
	async poll(providerRef: string) {
		const project = await callJson<Project>(ID, `${BASE}/clip-projects/${encodeURIComponent(providerRef)}`, { headers: auth() });
		if (project.stage === 'STALLED') return { status: 'failed', error: project.error ?? 'OpusClip project stalled' };
		if (project.stage !== 'COMPLETE') return { status: 'running' };
		const clips = await callJson<Clip[] | { data?: Clip[] }>(ID, `${BASE}/exportable-clips?q=findByProjectId&projectId=${encodeURIComponent(providerRef)}`, { headers: auth() });
		const list = Array.isArray(clips) ? clips : (clips.data ?? []);
		const assets = list
			.filter((c) => c.uriForExport)
			.map((c) => ({ url: c.uriForExport, mime: 'video/mp4', label: c.title, durationSeconds: c.durationMs ? c.durationMs / 1000 : undefined }));
		return { status: 'done', result: { assets, providerMeta: { project: providerRef, clips: list.length } } };
	},
	async verify() {
		await callJson(ID, `${BASE}/brand-templates`, { headers: auth() });
		return { ok: true, detail: 'key accepted' };
	},
};
