// Client-safe vocabulary for the Content Studio (WIP_BUILD_PLAN.md module 2).
// No server imports here: the pages' client forms import this file, and the
// server reader (lib/content-studio/server.ts) re-exports the types.

import type { Capability } from '@/lib/providers/types';

/** One configured provider for a capability, as the picker shows it. */
export interface ProviderOption {
	id: string;
	label: string;
	category: string;
	costNote: string;
	async: boolean;
}

/** One content_jobs row as the studio renders it. */
export interface StudioJob {
	id: string;
	capability: string;
	provider: string;
	status: string;
	cost_usd: number | null;
	error: string | null;
	created_at: string;
	finished_at: string | null;
	parent_job_id: string | null;
	requested_via: string;
	/** output.text for text jobs; null otherwise. */
	text: string | null;
}

/** One content_assets row plus a short-lived signed URL. */
export interface StudioAsset {
	id: string;
	job_id: string;
	storage_path: string;
	mime: string;
	bytes: number | null;
	width: number | null;
	height: number | null;
	duration_seconds: number | null;
	label: string | null;
	url: string | null;
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const ACTIVE_STATUSES = ['queued', 'submitted', 'running'] as const;
export function isActiveStatus(status: string): boolean {
	return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
	generate_text: 'Text',
	generate_image: 'Image',
	edit_image: 'Image edit',
	generate_video: 'Video',
	lipsync_avatar: 'Avatar video',
	generate_voice: 'Voice',
	generate_music: 'Music',
	transcribe: 'Transcript',
	clip_video: 'Clips',
	edit_video: 'Video edit',
	design_export: 'Design',
	search_stock: 'Stock',
};

export function capabilityLabel(capability: string): string {
	return (CAPABILITY_LABEL as Record<string, string>)[capability] ?? capability;
}

export const STUDIO_TOOLS = [
	{ href: '/social/studio/scripts', title: 'Scripts', description: 'Brief to script draft, with the client message house as context.' },
	{ href: '/social/studio/headlines', title: 'Headlines and hooks', description: 'Ten to twenty options from one brief. Star the keepers into the hook library.' },
	{ href: '/social/studio/images', title: 'Image Studio', description: 'Prompt, size, style, provider. Results grid, regenerate, edit, save.' },
	{ href: '/social/studio/video', title: 'Video Studio', description: 'Script, voice, avatar or generative video as one chained job.' },
	{ href: '/social/studio/clips', title: 'Clips and editing', description: 'Send a video to OpusClip or Descript and get clips back as assets.' },
	{ href: '/social/studio/thumbnails', title: 'Thumbnails', description: 'Title, brand preset, provider, sizes for YouTube, Reels and LinkedIn.' },
] as const;

// ---------------------------------------------------------------- briefs

export const PLATFORMS = ['Instagram Reels', 'TikTok', 'YouTube', 'YouTube Shorts', 'LinkedIn', 'X', 'Facebook', 'Podcast', 'Email'] as const;
export const LENGTHS = [
	{ value: 'short', label: 'Short (15 to 30 seconds)' },
	{ value: 'medium', label: 'Medium (45 to 90 seconds)' },
	{ value: 'long', label: 'Long (2 to 4 minutes)' },
] as const;
export const TONES = ['Warm and direct', 'Expert and calm', 'Playful', 'Urgent', 'Inspirational', 'Plain and factual'] as const;
export const HOOK_STYLES = ['Question', 'Bold claim', 'Story opener', 'Contrarian take', 'Number or stat', 'Mistake to avoid'] as const;

export interface Brief {
	clientId: string;
	goal: string;
	platform: string;
	length: string;
	tone: string;
	hookStyle: string;
}

export const EMPTY_BRIEF: Brief = { clientId: '', goal: '', platform: PLATFORMS[0], length: 'medium', tone: TONES[0], hookStyle: HOOK_STYLES[0] };

// ---------------------------------------------------------------- images

export const IMAGE_SIZES = [
	{ value: '1024x1024', label: 'Square 1024' },
	{ value: '1792x1024', label: 'Landscape 1792x1024' },
	{ value: '1024x1792', label: 'Portrait 1024x1792' },
] as const;
export const IMAGE_STYLES = ['photo', 'illustration', 'flat', '3d', 'watercolor', 'editorial', 'minimal'] as const;

/** Thumbnail targets: platform to the closest size the image adapters accept. */
export const THUMBNAIL_SIZES = [
	{ value: '1792x1024', label: 'YouTube (16:9)' },
	{ value: '1024x1792', label: 'Reels / Shorts (9:16)' },
	{ value: '1024x1024', label: 'LinkedIn / Instagram (1:1)' },
] as const;

export const THUMBNAIL_PRESETS = [
	{ value: 'or-bold', label: 'Open Ronin bold', prompt: 'bold high contrast layout, large clean sans-serif title text, brand teal and lime accents, generous negative space' },
	{ value: 'or-editorial', label: 'Open Ronin editorial', prompt: 'editorial magazine layout, restrained palette anchored on the brand teal, a single subject, understated title text' },
	{ value: 'or-photo', label: 'Open Ronin photo', prompt: 'natural photograph of a confident founder, soft daylight, subtle brand teal overlay on one side, title text in a clean sans-serif' },
	{ value: 'plain', label: 'Plain (no brand)', prompt: 'clean simple composition, clear title text' },
] as const;

// ---------------------------------------------------------------- video

export const ASPECTS = ['16:9', '9:16', '1:1'] as const;
export const AVATAR_PROVIDERS = ['heygen', 'synthesia'] as const;

// ---------------------------------------------------------------- helpers

/** Split a text provider's list answer into clean options. */
export function parseOptions(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
		.filter((l) => l.length > 3 && l.length <= 300);
}

export function formatUsd(v: number | null | undefined): string {
	if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
	return v === 0 ? '$0' : `$${v.toFixed(v < 0.1 ? 4 : 2)}`;
}

/** Group jobs into chains: roots plus their descendants, in creation order. */
export function groupChains(jobs: StudioJob[]): { root: StudioJob; steps: StudioJob[] }[] {
	const byId = new Map(jobs.map((j) => [j.id, j]));
	const children = new Map<string, StudioJob[]>();
	for (const j of jobs) {
		if (j.parent_job_id && byId.has(j.parent_job_id)) {
			const list = children.get(j.parent_job_id) ?? [];
			list.push(j);
			children.set(j.parent_job_id, list);
		}
	}
	const roots = jobs.filter((j) => !j.parent_job_id || !byId.has(j.parent_job_id));
	const walk = (id: string): StudioJob[] => {
		const kids = (children.get(id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
		return kids.flatMap((k) => [k, ...walk(k.id)]);
	};
	return roots.map((root) => ({ root, steps: walk(root.id) }));
}
