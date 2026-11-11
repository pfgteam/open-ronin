// Zod schemas for ContentJobInput. The UI server actions and the MCP
// generate_content tool validate with THIS union before any insert, and the
// database re checks capability and provider with CHECK constraints (0065).

import { z } from 'zod';
import { CAPABILITIES, type Capability, type ContentJobInput } from './types';

const prompt = z.string().trim().min(1).max(4000);
const url = z.string().url().max(2000);
const model = z.string().trim().min(1).max(80).optional();

export const generateTextSchema = z.object({
	capability: z.literal('generate_text'),
	prompt,
	system: z.string().trim().max(4000).optional(),
	maxTokens: z.number().int().min(1).max(8000).optional(),
	model,
});
export const generateImageSchema = z.object({
	capability: z.literal('generate_image'),
	prompt,
	size: z
		.string()
		.regex(/^\d{2,4}x\d{2,4}$/)
		.optional(),
	count: z.number().int().min(1).max(4).optional(),
	style: z.string().trim().max(80).optional(),
	model,
});
export const editImageSchema = z.object({
	capability: z.literal('edit_image'),
	prompt,
	imagePath: z.string().trim().min(1).max(500),
	maskPath: z.string().trim().min(1).max(500).optional(),
	size: z
		.string()
		.regex(/^\d{2,4}x\d{2,4}$/)
		.optional(),
	model,
});
export const generateVideoSchema = z.object({
	capability: z.literal('generate_video'),
	prompt: z.string().trim().min(1).max(2000).optional(),
	script: z.string().trim().min(1).max(8000).optional(),
	durationSeconds: z.number().int().min(1).max(60).optional(),
	aspect: z.enum(['16:9', '9:16', '1:1']).optional(),
	imageUrl: url.optional(),
	model,
});
export const lipsyncAvatarSchema = z.object({
	capability: z.literal('lipsync_avatar'),
	script: z.string().trim().min(1).max(8000),
	avatarId: z.string().trim().max(120).optional(),
	voiceId: z.string().trim().max(120).optional(),
	aspect: z.enum(['16:9', '9:16', '1:1']).optional(),
	test: z.boolean().optional(),
});
export const generateVoiceSchema = z.object({
	capability: z.literal('generate_voice'),
	text: z.string().trim().min(1).max(4000),
	voiceId: z.string().trim().max(120).optional(),
	model,
	format: z.enum(['mp3', 'wav']).optional(),
});
export const generateMusicSchema = z.object({
	capability: z.literal('generate_music'),
	prompt,
	durationSeconds: z.number().int().min(5).max(240).optional(),
});
export const transcribeSchema = z.object({
	capability: z.literal('transcribe'),
	audioUrl: url,
	language: z.string().trim().max(10).optional(),
	model,
});
export const clipVideoSchema = z.object({
	capability: z.literal('clip_video'),
	videoUrl: url,
	maxClips: z.number().int().min(1).max(20).optional(),
});
export const editVideoSchema = z.object({
	capability: z.literal('edit_video'),
	videoUrl: url,
	instructions: z.string().trim().min(1).max(4000),
});
export const designExportSchema = z.object({
	capability: z.literal('design_export'),
	designId: z.string().trim().min(1).max(120),
	format: z.enum(['png', 'jpg', 'pdf']).optional(),
});
export const searchStockSchema = z.object({
	capability: z.literal('search_stock'),
	query: z.string().trim().min(1).max(200),
	count: z.number().int().min(1).max(30).optional(),
	orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
});

export const contentJobInputSchema = z
	.discriminatedUnion('capability', [
		generateTextSchema,
		generateImageSchema,
		editImageSchema,
		generateVideoSchema,
		lipsyncAvatarSchema,
		generateVoiceSchema,
		generateMusicSchema,
		transcribeSchema,
		clipVideoSchema,
		editVideoSchema,
		designExportSchema,
		searchStockSchema,
	])
	.refine((v) => v.capability !== 'generate_video' || v.prompt || v.script, { message: 'generate_video needs a prompt or a script' });

export const capabilitySchema = z.enum(CAPABILITIES);

/** Parses unknown JSON into a typed ContentJobInput or throws a ZodError. */
export function parseContentJobInput(raw: unknown): ContentJobInput {
	return contentJobInputSchema.parse(raw) as ContentJobInput;
}

export function isCapability(v: string): v is Capability {
	return (CAPABILITIES as readonly string[]).includes(v);
}
