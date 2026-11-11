// Provider registry contract (WIP_BUILD_PLAN.md, module 1.1).
//
// Every content generation vendor sits behind the same adapter interface so
// the Content Studio pages, the MCP content tools and the cron state machine
// never learn a vendor's shape. Adapters use native fetch against each
// vendor's REST API; there are no vendor SDKs in this app (same reasoning as
// lib/scrapers/apify.ts and lib/google/calendar.ts).
//
// Keys: an adapter reads its env keys only inside submit / poll / verify.
// isConfigured() checks presence. Nothing here ever returns a key value.

export const PROVIDER_CATEGORIES = [
	'text',
	'research',
	'image',
	'video',
	'voice',
	'music',
	'edit',
	'clip',
	'transcription',
	'design',
	'stock',
	'publish',
] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

// search_stock is the one capability the plan asked us to add (pexels,
// unsplash). Keep this list in sync with the CHECK on content_jobs.capability
// in 0065 and with the Zod union in schema.ts.
export const CAPABILITIES = [
	'generate_text',
	'generate_image',
	'edit_image',
	'generate_video',
	'lipsync_avatar',
	'generate_voice',
	'generate_music',
	'transcribe',
	'clip_video',
	'edit_video',
	'design_export',
	'search_stock',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface ProviderSpec {
	/** Registry id, also the CHECK list on content_jobs.provider. */
	id: string;
	label: string;
	category: ProviderCategory;
	capabilities: Capability[];
	/** Env var names only; presence is checked, values never reach the UI. */
	envKeys: string[];
	docsUrl: string;
	/** One line for the cost estimate label on /admin/providers. */
	costNote: string;
	/** True when submit returns a job to poll on later cron ticks. */
	async: boolean;
}

// ---------------------------------------------------------------- inputs
// Discriminated union by capability. The Zod schemas in schema.ts are the
// source of truth for validation; these types mirror them for adapters.

export interface GenerateTextInput {
	capability: 'generate_text';
	prompt: string;
	system?: string;
	maxTokens?: number;
	model?: string;
}
export interface GenerateImageInput {
	capability: 'generate_image';
	prompt: string;
	size?: string;
	count?: number;
	style?: string;
	model?: string;
}
export interface EditImageInput {
	capability: 'edit_image';
	prompt: string;
	/** Bucket path of the source asset (content bucket). */
	imagePath: string;
	maskPath?: string;
	size?: string;
	model?: string;
}
export interface GenerateVideoInput {
	capability: 'generate_video';
	prompt?: string;
	script?: string;
	durationSeconds?: number;
	aspect?: string;
	/** Public image URL for image to video providers. */
	imageUrl?: string;
	model?: string;
}
export interface LipsyncAvatarInput {
	capability: 'lipsync_avatar';
	script: string;
	avatarId?: string;
	voiceId?: string;
	aspect?: string;
	/** Vendor test mode when supported (free, watermarked). */
	test?: boolean;
}
export interface GenerateVoiceInput {
	capability: 'generate_voice';
	text: string;
	voiceId?: string;
	model?: string;
	format?: 'mp3' | 'wav';
}
export interface GenerateMusicInput {
	capability: 'generate_music';
	prompt: string;
	durationSeconds?: number;
}
export interface TranscribeInput {
	capability: 'transcribe';
	/** Public or signed URL of the audio or video file. */
	audioUrl: string;
	language?: string;
	model?: string;
}
export interface ClipVideoInput {
	capability: 'clip_video';
	videoUrl: string;
	maxClips?: number;
}
export interface EditVideoInput {
	capability: 'edit_video';
	videoUrl: string;
	instructions: string;
}
export interface DesignExportInput {
	capability: 'design_export';
	designId: string;
	format?: 'png' | 'jpg' | 'pdf';
}
export interface SearchStockInput {
	capability: 'search_stock';
	query: string;
	count?: number;
	orientation?: 'landscape' | 'portrait' | 'square';
}

export type ContentJobInput =
	| GenerateTextInput
	| GenerateImageInput
	| EditImageInput
	| GenerateVideoInput
	| LipsyncAvatarInput
	| GenerateVoiceInput
	| GenerateMusicInput
	| TranscribeInput
	| ClipVideoInput
	| EditVideoInput
	| DesignExportInput
	| SearchStockInput;

// ---------------------------------------------------------------- outputs

/**
 * One produced asset. An adapter returns it with `url` (vendor download
 * link, usually temporary) or `base64` (inline bytes); advance.ts persists
 * the bytes into the `content` bucket and rewrites the entry to `path`
 * only. Persisted output never carries url or base64.
 */
export interface ContentAssetOut {
	/** Bucket path once persisted (content_assets.storage_path). */
	path?: string;
	url?: string;
	base64?: string;
	mime: string;
	bytes?: number;
	width?: number;
	height?: number;
	durationSeconds?: number;
	label?: string;
}

export interface ContentJobOutput {
	assets: ContentAssetOut[];
	text?: string;
	/** Vendor specifics worth keeping (model, seed, usage, citations). Never keys. */
	providerMeta: Record<string, unknown>;
}

export type SubmitResult = { providerRef: string } | { result: ContentJobOutput };

export type PollResult =
	| { status: 'running' }
	| { status: 'done'; result: ContentJobOutput }
	| { status: 'failed'; error: string };

export interface ProviderAdapter {
	spec: ProviderSpec;
	/** Every envKeys entry present and non empty. */
	isConfigured(): boolean;
	submit(input: ContentJobInput): Promise<SubmitResult>;
	/** Required when spec.async is true. */
	poll?(providerRef: string): Promise<PollResult>;
	/** USD estimate before submit; null when unknown. Feeds the daily cap. */
	estimateCost?(input: ContentJobInput): number | null;
	/**
	 * Cheapest call that proves the key works without generating anything
	 * (list models, account balance). Used by the Test button for providers
	 * whose smallest real job still costs real money (video) or needs a
	 * user OAuth flow (canva).
	 */
	verify?(): Promise<{ ok: boolean; detail: string }>;
	/**
	 * Headers needed to download a result URL when the vendor protects it
	 * with the same key (Google Veo). Never stored; advance.ts asks at
	 * download time.
	 */
	downloadHeaders?(): Record<string, string>;
}

/** Thrown by adapters for a vendor refusal that is safe to show a person. */
export class ProviderError extends Error {
	readonly provider: string;
	readonly status?: number;
	constructor(provider: string, message: string, status?: number) {
		super(message);
		this.name = 'ProviderError';
		this.provider = provider;
		this.status = status;
	}
}

export function unsupported(provider: string, capability: string): never {
	throw new ProviderError(provider, `${provider} does not support ${capability}.`);
}
