// Small fetch helpers shared by every adapter. Native fetch only.
//
// Every vendor call goes through one of these so timeouts, error text and
// JSON parsing behave the same way everywhere, and so an adapter body stays
// about the vendor's shape rather than about HTTP plumbing.

import { ProviderError } from './types';

/** A vendor call that hangs must not hold a cron tick or a Test click. */
const TIMEOUT_MS = 45_000;

export function env(name: string): string | undefined {
	const v = process.env[name];
	return v && v.trim() !== '' ? v : undefined;
}

export function allPresent(names: string[]): boolean {
	return names.every((n) => env(n) !== undefined);
}

/** Reads the key or throws a ProviderError the UI can show. */
export function requireEnv(provider: string, name: string): string {
	const v = env(name);
	if (!v) throw new ProviderError(provider, `${name} is not set.`);
	return v;
}

export interface CallOptions {
	method?: 'GET' | 'POST' | 'DELETE';
	headers?: Record<string, string>;
	/** Sent as JSON when an object, as is when FormData. */
	body?: unknown;
	timeoutMs?: number;
}

async function readErrorText(res: Response): Promise<string> {
	try {
		const text = await res.text();
		return text.slice(0, 500);
	} catch {
		return '';
	}
}

/** Fetch with a timeout; throws ProviderError on non 2xx. Returns the Response. */
export async function call(provider: string, url: string, opts: CallOptions = {}): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
	const headers: Record<string, string> = { ...(opts.headers ?? {}) };
	let body: BodyInit | undefined;
	if (opts.body instanceof FormData) {
		body = opts.body;
	} else if (typeof opts.body === 'string') {
		body = opts.body;
	} else if (opts.body !== undefined) {
		headers['content-type'] = headers['content-type'] ?? 'application/json';
		body = JSON.stringify(opts.body);
	}
	try {
		const res = await fetch(url, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: controller.signal });
		if (!res.ok) {
			const text = await readErrorText(res);
			throw new ProviderError(provider, `${provider} returned ${res.status}${text ? `: ${text}` : ''}`, res.status);
		}
		return res;
	} catch (e) {
		if (e instanceof ProviderError) throw e;
		const message = e instanceof Error && e.name === 'AbortError' ? 'timed out' : e instanceof Error ? e.message : String(e);
		throw new ProviderError(provider, `${provider} request failed: ${message}`);
	} finally {
		clearTimeout(timer);
	}
}

export async function callJson<T = Record<string, unknown>>(provider: string, url: string, opts: CallOptions = {}): Promise<T> {
	const res = await call(provider, url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } });
	return (await res.json()) as T;
}

/** Downloads a vendor result into bytes; used by advance.ts to persist assets. */
export async function callBytes(provider: string, url: string, opts: CallOptions = {}): Promise<{ bytes: Uint8Array; mime: string }> {
	const res = await call(provider, url, opts);
	const buf = new Uint8Array(await res.arrayBuffer());
	return { bytes: buf, mime: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
}

/** Fetches a file into a Blob for multipart uploads (image edits, transcription). */
export async function fetchBlob(provider: string, url: string, filename: string): Promise<File> {
	const res = await call(provider, url);
	const blob = await res.blob();
	return new File([blob], filename, { type: blob.type || 'application/octet-stream' });
}

/** Walks a dotted path like 'data.0.url' through an unknown JSON value. */
export function pick(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const key of path.split('.')) {
		if (cur === null || cur === undefined) return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

export function pickString(obj: unknown, path: string): string | undefined {
	const v = pick(obj, path);
	return typeof v === 'string' ? v : undefined;
}
