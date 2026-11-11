// MCP content family (WIP_BUILD_PLAN.md 1.4): the provider registry as
// tool calls. Three tools:
//
//   list_content_providers  any valid consumer. Presence only, never a key.
//   generate_content        content:run. Validates with the same Zod union
//                           the UI uses, inserts a content_jobs row with
//                           requested_via mcp and the consumer slug, returns
//                           the job id. The database cap refuses over budget
//                           and that sentence comes back verbatim.
//   get_content_job         content:run. Status, text, and 15 minute signed
//                           URLs for the assets.
//
// Every call is audited by `audited` naming the consumer. Nothing here
// writes a business table: a job row is a queue entry the cron works.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audited, userError } from '@/lib/mcp/tooling';
import { listProviders } from '@/lib/providers/registry';
import { enqueueContentJob } from '@/lib/providers/enqueue';
import { CONTENT_BUCKET } from '@/lib/providers/advance';
import { CAPABILITIES, type ContentJobOutput } from '@/lib/providers/types';

const SIGNED_URL_SECONDS = 15 * 60;

export function registerContentTools(server: McpServer): void {
	server.registerTool(
		'list_content_providers',
		{
			title: 'List content providers',
			description:
				'Every content generation provider Open Ronin can call (text, research, image, video, voice, transcription, stock photos), with its capabilities, a one line cost note, and whether its key is configured. Pick a provider with configured true for generate_content. Never returns key values.',
			inputSchema: { capability: z.enum(CAPABILITIES).optional() },
		},
		async ({ capability }, extra) =>
			audited('list_content_providers', null, extra.authInfo, { capability }, 'content providers', async () => {
				const rows = listProviders()
					.filter((p) => !capability || p.spec.capabilities.includes(capability))
					.map((p) => ({
						id: p.spec.id,
						label: p.spec.label,
						category: p.spec.category,
						capabilities: p.spec.capabilities,
						configured: p.configured,
						async: p.spec.async,
						cost_note: p.spec.costNote,
						docs_url: p.spec.docsUrl,
					}));
				return { payload: { rows, count: rows.length }, rows: rows.length };
			}),
	);

	server.registerTool(
		'generate_content',
		{
			title: 'Generate content',
			description:
				'Queue a content generation job on a provider. input is a ContentJobInput keyed by capability: generate_text {prompt, system?, maxTokens?}, generate_image {prompt, size? "1024x1024", count?, style?}, generate_voice {text, voiceId?}, transcribe {audioUrl}, generate_video {prompt or script, durationSeconds?, aspect?, imageUrl?}, lipsync_avatar {script, avatarId?, voiceId?}, search_stock {query, count?}. Returns the job id; poll get_content_job for the result. The daily budget for this consumer is enforced by the database; a refusal comes back as the reason.',
			inputSchema: {
				provider: z.string().min(1).max(40),
				input: z.record(z.unknown()),
				client_id: z.string().uuid().optional(),
				work_item_id: z.string().uuid().optional(),
			},
		},
		async ({ provider, input, client_id, work_item_id }, extra) =>
			audited('generate_content', 'content:run', extra.authInfo, { provider, input, client_id, work_item_id }, 'content generation', async () => {
				const db = createServiceRoleClient();
				const res = await enqueueContentJob(db, {
					provider,
					input,
					requestedBy: null,
					requestedVia: 'mcp',
					consumerSlug: extra.authInfo!.clientId,
					clientId: client_id ?? null,
					workItemId: work_item_id ?? null,
				});
				if (!res.ok) throw userError(res.message);
				return {
					payload: { job_id: res.jobId, status: 'queued', estimated_cost_usd: res.costUsd, note: 'The cron advances the job within about a minute. Poll get_content_job.' },
					rows: 1,
				};
			}),
	);

	server.registerTool(
		'get_content_job',
		{
			title: 'Get content job',
			description: 'Status and output of a content job queued by generate_content: status (queued, submitted, running, done, failed, cancelled), output text, provider metadata, and signed URLs for any assets valid for 15 minutes.',
			inputSchema: { job_id: z.string().uuid() },
		},
		async ({ job_id }, extra) =>
			audited('get_content_job', 'content:run', extra.authInfo, { job_id }, 'this content job', async () => {
				const db = createServiceRoleClient();
				const { data: job, error } = await db
					.from('content_jobs')
					.select('id, capability, provider, status, output, cost_usd, error, consumer_slug, created_at, finished_at')
					.eq('id', job_id)
					.maybeSingle<{
						id: string;
						capability: string;
						provider: string;
						status: string;
						output: ContentJobOutput | null;
						cost_usd: number | null;
						error: string | null;
						consumer_slug: string | null;
						created_at: string;
						finished_at: string | null;
					}>();
				if (error) throw error;
				// A consumer sees only its own jobs.
				if (!job || job.consumer_slug !== extra.authInfo!.clientId) throw userError(`No content job ${job_id} for this consumer.`);

				const assets: { path: string; mime: string; url: string | null; width?: number; height?: number; duration_seconds?: number; label?: string }[] = [];
				for (const a of job.output?.assets ?? []) {
					if (!a.path) continue;
					const { data: signed } = await db.storage.from(CONTENT_BUCKET).createSignedUrl(a.path, SIGNED_URL_SECONDS);
					assets.push({ path: a.path, mime: a.mime, url: signed?.signedUrl ?? null, width: a.width, height: a.height, duration_seconds: a.durationSeconds, label: a.label });
				}
				return {
					payload: {
						job_id: job.id,
						capability: job.capability,
						provider: job.provider,
						status: job.status,
						text: job.output?.text ?? null,
						provider_meta: job.output?.providerMeta ?? null,
						assets,
						cost_usd: job.cost_usd,
						error: job.error,
						created_at: job.created_at,
						finished_at: job.finished_at,
					},
					rows: 1,
				};
			}),
	);
}
