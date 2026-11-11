// Server-side reads for the Content Studio pages. Every read goes through the
// request's session client so RLS (0065: own jobs, admins all; 0093: own
// hooks) decides visibility; the service role is used only to mint signed
// URLs for assets the session was already allowed to select.

import { cache } from 'react';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { listProviders } from '@/lib/providers/registry';
import { CONTENT_BUCKET } from '@/lib/providers/advance';
import type { Capability, ContentJobOutput } from '@/lib/providers/types';
import type { ProviderOption, StudioAsset, StudioJob } from './shared';

export type { ProviderOption, StudioAsset, StudioJob } from './shared';

const SIGNED_URL_SECONDS = 10 * 60;

/** Configured providers for a capability, in registry order. Presence only. */
export function providersFor(capability: Capability, only?: readonly string[]): ProviderOption[] {
	return listProviders()
		.filter((p) => p.configured && p.spec.capabilities.includes(capability) && (!only || only.includes(p.spec.id)))
		.map((p) => ({ id: p.spec.id, label: p.spec.label, category: p.spec.category, costNote: p.spec.costNote, async: p.spec.async }));
}

interface JobRow {
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
	output: ContentJobOutput | null;
}

const JOB_COLUMNS = 'id, capability, provider, status, cost_usd, error, created_at, finished_at, parent_job_id, requested_via, output';

function toJob(r: JobRow): StudioJob {
	return {
		id: r.id,
		capability: r.capability,
		provider: r.provider,
		status: r.status,
		cost_usd: r.cost_usd,
		error: r.error,
		created_at: r.created_at,
		finished_at: r.finished_at,
		parent_job_id: r.parent_job_id,
		requested_via: r.requested_via,
		text: typeof r.output?.text === 'string' ? r.output.text : null,
	};
}

/** Jobs the viewer may see (RLS), newest first, optionally one capability set. */
export async function listJobs(opts: { capabilities?: readonly string[]; limit?: number } = {}): Promise<StudioJob[]> {
	const supabase = await createClient();
	let q = supabase.from('content_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(opts.limit ?? 50);
	if (opts.capabilities?.length) q = q.in('capability', [...opts.capabilities]);
	const { data, error } = await q;
	if (error) {
		console.error('[content-studio] listJobs failed:', error.message);
		return [];
	}
	return ((data ?? []) as JobRow[]).map(toJob);
}

/** Jobs by id (parents and children of a chain), RLS scoped. */
export async function jobsByIds(ids: string[]): Promise<StudioJob[]> {
	if (ids.length === 0) return [];
	const supabase = await createClient();
	const { data } = await supabase.from('content_jobs').select(JOB_COLUMNS).in('id', ids);
	return ((data ?? []) as JobRow[]).map(toJob);
}

interface AssetRow {
	id: string;
	job_id: string;
	storage_path: string;
	mime: string;
	bytes: number | null;
	width: number | null;
	height: number | null;
	duration_seconds: number | null;
	label: string | null;
}

/**
 * Assets for a set of jobs with 10 minute signed URLs. The rows are read
 * through the session (content_assets_select checks the parent job), the
 * URLs are minted with the service role because the bucket is private.
 */
export async function assetsForJobs(jobIds: string[]): Promise<StudioAsset[]> {
	if (jobIds.length === 0) return [];
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('content_assets')
		.select('id, job_id, storage_path, mime, bytes, width, height, duration_seconds, label')
		.in('job_id', jobIds)
		.order('created_at', { ascending: true });
	if (error) {
		console.error('[content-studio] assetsForJobs failed:', error.message);
		return [];
	}
	const rows = (data ?? []) as AssetRow[];
	if (rows.length === 0) return [];
	const db = createServiceRoleClient();
	const { data: signed } = await db.storage.from(CONTENT_BUCKET).createSignedUrls(
		rows.map((r) => r.storage_path),
		SIGNED_URL_SECONDS,
	);
	const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl]));
	return rows.map((r) => ({ ...r, url: urlByPath.get(r.storage_path) ?? null }));
}

/** Active-first client list for the brief pickers. */
export const listClientOptions = cache(async (): Promise<{ id: string; name: string; status: string }[]> => {
	const supabase = await createClient();
	const { data } = await supabase.from('clients_v2').select('id, display_name, status').order('display_name');
	const rows = (data ?? []) as { id: string; display_name: string; status: string }[];
	const rank = (s: string) => (s === 'active' ? 0 : s === '60-day' ? 1 : s === 'hold' ? 2 : 3);
	return rows
		.map((r) => ({ id: r.id, name: r.display_name, status: r.status }))
		.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
});

/** Open work items the viewer can attach assets to (The Work, `projects`). */
export const listWorkItemOptions = cache(async (): Promise<{ id: string; name: string }[]> => {
	const supabase = await createClient();
	const { data } = await supabase
		.from('projects')
		.select('id, name')
		.eq('archived', false)
		.in('status', ['planned', 'active', 'review'])
		.order('updated_at', { ascending: false })
		.limit(200);
	return ((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
});

/** Recent call recordings from Sessions (calls.recording_url, 0041) to send to a clip vendor. */
export async function listRecordingOptions(): Promise<{ id: string; label: string; url: string }[]> {
	const supabase = await createClient();
	const { data } = await supabase
		.from('calls')
		.select('id, call_type, occurred_at, recording_url, clients_v2(display_name)')
		.not('recording_url', 'is', null)
		.order('occurred_at', { ascending: false })
		.limit(40);
	const rows = (data ?? []) as unknown as { id: string; call_type: string; occurred_at: string; recording_url: string; clients_v2: { display_name: string } | null }[];
	return rows.map((r) => ({
		id: r.id,
		label: `${r.occurred_at.slice(0, 10)} · ${r.clients_v2?.display_name ?? r.call_type.replace(/_/g, ' ')}`,
		url: r.recording_url,
	}));
}

/** Saved hooks (RLS: own rows, admins all). */
export async function listHooks(clientId?: string): Promise<{ id: string; hook_text: string; client_id: string | null; created_at: string }[]> {
	const supabase = await createClient();
	let q = supabase.from('hook_library').select('id, hook_text, client_id, created_at').order('created_at', { ascending: false }).limit(200);
	if (clientId) q = q.eq('client_id', clientId);
	const { data, error } = await q;
	if (error) {
		console.error('[content-studio] listHooks failed:', error.message);
		return [];
	}
	return (data ?? []) as { id: string; hook_text: string; client_id: string | null; created_at: string }[];
}
