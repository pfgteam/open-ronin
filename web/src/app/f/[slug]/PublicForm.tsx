'use client';

// The public form renderer (0158): single column, Jotform-like, used by the
// hosted page (/f/<slug>) and the embed (/f/<slug>/embed). Multi-page on
// the `page` key, conditional logic live, file fields upload to
// /api/f/<slug>/upload before the submit, honeypot input, optional
// Turnstile, then POST /api/f/<slug>. In an iframe it reports its height
// to the parent (or-form:height) so /f/embed.js can size the frame.

import { useEffect, useMemo, useRef, useState } from 'react';
import { visibleFields, type FormField, type FormValues } from '@/lib/forms/logic';
import { HONEYPOT_KEY, MAX_UPLOAD_BYTES, type PublicFormDef, type SubmitResult } from '@/lib/forms/shared';

const cls = 'w-full text-base sm:text-sm rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/30 disabled:bg-slate-50';

declare global {
	interface Window {
		turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'expired-callback'?: () => void }) => string; reset: (id?: string) => void };
	}
}

export default function PublicForm({ def, embedded, preview }: { def: PublicFormDef; embedded?: boolean; preview?: boolean }) {
	const { slug, fields, pages } = def;
	const [values, setValues] = useState<FormValues>({});
	const [fileNames, setFileNames] = useState<Record<string, string>>({});
	const [uploading, setUploading] = useState<Record<string, boolean>>({});
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<SubmitResult | null>(null);
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const turnstileRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLElement | null>(null);
	const setRoot = (el: HTMLElement | null) => {
		rootRef.current = el;
	};

	const shown = visibleFields(fields, values);
	const pageNumbers = useMemo(() => [...new Set(shown.map((f) => pages[f.key] ?? 1))].sort((a, b) => a - b), [shown, pages]);
	const current = shown.filter((f) => (pages[f.key] ?? 1) === page);
	const idx = Math.max(0, pageNumbers.indexOf(page));
	const isLast = idx >= pageNumbers.length - 1;
	const set = (k: string, v: FormValues[string]) => setValues((x) => ({ ...x, [k]: v }));

	// Height reporting for the embed script.
	useEffect(() => {
		if (!embedded || typeof window === 'undefined' || window.parent === window) return;
		const el = rootRef.current;
		if (!el) return;
		const post = () => window.parent.postMessage({ type: 'or-form:height', slug, height: Math.ceil(document.documentElement.scrollHeight) }, '*');
		post();
		const ro = new ResizeObserver(post);
		ro.observe(el);
		ro.observe(document.body);
		const t = setInterval(post, 1500);
		return () => {
			ro.disconnect();
			clearInterval(t);
		};
	}, [embedded, slug, page, done, error]);

	// Turnstile widget when configured.
	useEffect(() => {
		if (!def.turnstile_site_key || preview) return;
		const key = def.turnstile_site_key;
		let widgetId: string | undefined;
		const render = () => {
			if (!turnstileRef.current || !window.turnstile || widgetId) return;
			widgetId = window.turnstile.render(turnstileRef.current, { sitekey: key, callback: (t) => setTurnstileToken(t), 'expired-callback': () => setTurnstileToken(null) });
		};
		if (window.turnstile) render();
		else {
			const s = document.createElement('script');
			s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			s.async = true;
			s.onload = render;
			document.head.appendChild(s);
		}
	}, [def.turnstile_site_key, preview]);

	function pageValid(): string | null {
		for (const f of current) {
			const v = values[f.key];
			const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;
			if (f.required && empty) return `${f.label} is required.`;
			if (f.type === 'email' && typeof v === 'string' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'Please enter a valid email.';
			if (uploading[f.key]) return `${f.label} is still uploading.`;
		}
		return null;
	}

	async function upload(f: FormField, file: File | null) {
		if (!file) {
			set(f.key, '');
			setFileNames((x) => ({ ...x, [f.key]: '' }));
			return;
		}
		if (file.size > MAX_UPLOAD_BYTES) return setError(`${f.label}: max 25 MB.`);
		setError(null);
		setUploading((x) => ({ ...x, [f.key]: true }));
		try {
			const fd = new FormData();
			fd.set('key', f.key);
			fd.set('file', file);
			const res = await fetch(`/api/f/${slug}/upload`, { method: 'POST', body: fd });
			const body = (await res.json()) as { ok?: boolean; path?: string; name?: string; error?: string };
			if (!res.ok || !body.ok || !body.path) {
				setError(body.error ?? 'Upload failed.');
				set(f.key, '');
				return;
			}
			set(f.key, body.path);
			setFileNames((x) => ({ ...x, [f.key]: body.name ?? file.name }));
		} catch {
			setError('Upload failed. Please try again.');
		} finally {
			setUploading((x) => ({ ...x, [f.key]: false }));
		}
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		const err = pageValid();
		if (err) return setError(err);
		if (!isLast) {
			setError(null);
			setPage(pageNumbers[idx + 1]);
			return;
		}
		if (preview) {
			setDone({ ok: true, submission_id: 'preview', success_message: def.success_message, redirect_url: null, success_cta_label: def.success_cta_label, success_cta_url: def.success_cta_url });
			return;
		}
		if (def.turnstile_site_key && !turnstileToken) return setError('Please complete the verification.');
		setError(null);
		setBusy(true);
		try {
			let source: string | null = null;
			try {
				source = embedded && document.referrer ? document.referrer : window.location.href;
			} catch {
				source = null;
			}
			const res = await fetch(`/api/f/${slug}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...values, _source_url: source, ...(turnstileToken ? { _turnstile: turnstileToken } : {}) }),
			});
			const body = (await res.json()) as SubmitResult | { error?: string };
			if (!res.ok || !('ok' in body) || !body.ok) {
				setError(('error' in body && body.error) || 'Something went wrong. Please try again.');
				if (window.turnstile) window.turnstile.reset();
				setTurnstileToken(null);
				return;
			}
			if (body.redirect_url) {
				const target = window.top && window.top !== window ? window.top : window;
				try {
					target.location.href = body.redirect_url;
				} catch {
					window.location.href = body.redirect_url;
				}
				return;
			}
			setDone(body);
		} catch {
			setError('Network error. Please try again.');
		} finally {
			setBusy(false);
		}
	}

	if (done) {
		return (
			<div ref={setRoot} className="text-center py-10 px-4">
				<div className="mx-auto w-12 h-12 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center mb-4">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
				</div>
				<h2 className="text-xl font-semibold text-slate-900">Thank you</h2>
				<p className="text-sm text-slate-600 mt-2 whitespace-pre-line max-w-md mx-auto">{done.success_message ?? 'Your request was received.'}</p>
				{done.success_cta_url && (
					<a href={done.success_cta_url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center mt-5 rounded-lg bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-800">
						{done.success_cta_label || 'Open'}
					</a>
				)}
			</div>
		);
	}

	return (
		<form ref={setRoot} onSubmit={submit} className="relative space-y-5" noValidate>
			{pageNumbers.length > 1 && (
				<div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-slate-500">
					<span>Step {idx + 1} of {pageNumbers.length}</span>
					<div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-primary-600" style={{ width: `${((idx + 1) / pageNumbers.length) * 100}%` }} /></div>
				</div>
			)}
			{current.map((f) => (
				<div key={f.key}>
					<label htmlFor={`f-${f.key}`} className="block text-sm font-medium text-slate-800 mb-1.5">
						{f.label}
						{f.required && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
					</label>
					{f.type === 'textarea' ? (
						<textarea id={`f-${f.key}`} rows={4} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={cls} required={f.required} />
					) : f.type === 'select' ? (
						<select id={`f-${f.key}`} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={cls}>
							<option value="">Select…</option>
							{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
						</select>
					) : f.type === 'multiselect' ? (
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
							{(f.options ?? []).map((o) => {
								const cur = Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [];
								return (
									<label key={o} className="inline-flex items-center gap-2 text-sm text-slate-800">
										<input type="checkbox" className="w-4 h-4 rounded-sm border-slate-300 text-primary-600" checked={cur.includes(o)} onChange={(e) => set(f.key, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />
										{o}
									</label>
								);
							})}
						</div>
					) : f.type === 'checkbox' ? (
						<label className="inline-flex items-center gap-2 text-sm text-slate-800">
							<input id={`f-${f.key}`} type="checkbox" className="w-4 h-4 rounded-sm border-slate-300 text-primary-600" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> Yes
						</label>
					) : f.type === 'file' ? (
						<div>
							<input id={`f-${f.key}`} type="file" onChange={(e) => upload(f, e.target.files?.[0] ?? null)} disabled={preview} className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200" />
							{uploading[f.key] ? <p className="text-2xs text-slate-500 mt-1">Uploading…</p> : fileNames[f.key] ? <p className="text-2xs text-slate-600 mt-1">Attached: {fileNames[f.key]}</p> : <p className="text-2xs text-slate-500 mt-1">PDF, Word, images, audio or video, up to 25 MB.</p>}
						</div>
					) : (
						<input
							id={`f-${f.key}`}
							type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text'}
							inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'numeric' : undefined}
							autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.key === 'name' ? 'name' : f.type === 'url' ? 'url' : undefined}
							value={String(values[f.key] ?? '')}
							onChange={(e) => set(f.key, e.target.value)}
							className={cls}
							required={f.required}
						/>
					)}
					{f.help && <p className="text-xs text-slate-500 mt-1.5">{f.help}</p>}
				</div>
			))}
			{/* Honeypot: hidden from people, filled by bots. */}
			<div className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden" aria-hidden>
				<label htmlFor={`hp-${HONEYPOT_KEY}`}>Company URL</label>
				<input id={`hp-${HONEYPOT_KEY}`} name={HONEYPOT_KEY} type="text" tabIndex={-1} autoComplete="off" value={String(values[HONEYPOT_KEY] ?? '')} onChange={(e) => set(HONEYPOT_KEY, e.target.value)} />
			</div>
			{def.turnstile_site_key && !preview && isLast && <div ref={turnstileRef} />}
			{error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>}
			<div className="flex items-center justify-between gap-3 pt-1">
				{idx > 0 ? (
					<button type="button" onClick={() => { setError(null); setPage(pageNumbers[idx - 1]); }} className="text-sm text-slate-600 hover:text-slate-900">← Back</button>
				) : <span />}
				<button type="submit" disabled={busy || current.length === 0} className="inline-flex items-center justify-center rounded-lg bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-60">
					{busy ? 'Sending…' : isLast ? def.submit_label : 'Next'}
				</button>
			</div>
		</form>
	);
}
