'use client';

// The guided application (0130, Valpo-style). One section at a time:
// consent first, then contact / screening / skills (honeypots look like any
// other skill) / timed no-paste challenges / video (record in-browser or
// paste a link) / resume / questionnaire. Every text field tracks typed vs
// pasted chars and paste events; 'block' questions refuse the paste and
// count the attempt. Autosaves every few seconds + on section change so a
// refresh resumes (the token lives in sessionStorage); a brand-new session
// for the same role counts as a restart server-side.

import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { isVideoLink, validateSection, type AnswerMap, type AnswerMeta, type AppQuestion, type ApplicationConfig } from '@/lib/hiring/application';

const cls = 'w-full text-sm rounded-md border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50';
const btn = 'rounded-md bg-primary-700 hover:bg-primary-800 text-white text-sm font-medium px-4 py-2 disabled:opacity-60';
const btnGhost = 'rounded-md border border-slate-300 text-sm font-medium px-4 py-2 text-slate-700 hover:bg-slate-50 disabled:opacity-60';

type Start = { token: string; config: ApplicationConfig; consent: { version: number; title: string; body_md: string }; position: { title: string; slug: string; brand: string } };

export default function ApplyForm({ slug, src }: { slug: string; src: string | null }) {
	const [start, setStart] = useState<Start | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [answers, setAnswers] = useState<AnswerMap>({});
	const [idx, setIdx] = useState(0);
	const [errs, setErrs] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<{ application_id: string; honeypots: { key: string; label: string; value: number }[] } | null>(null);
	const [followup, setFollowup] = useState('');
	const [followupDone, setFollowupDone] = useState(false);
	const dirty = useRef(false);
	const api = (action: string) => `/api/careers/apply/${slug}/${action}`;

	// start or resume
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const key = `or_apply_${slug}`;
				const saved = typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null;
				const linkCode = src ?? (typeof document !== 'undefined' ? (document.cookie.match(/(?:^|; )or_src=([^;]+)/)?.[1] ?? null) : null);
				const res = await fetch(api('start'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ link_code: linkCode }) });
				const j = (await res.json()) as Start & { error?: string };
				if (!res.ok) throw new Error(j.error ?? 'Could not start.');
				if (saved) {
					try {
						const s = JSON.parse(saved) as { token: string; answers: AnswerMap; idx: number };
						// Keep the saved answers but use the fresh token only when the old one is gone; the server counts the old abandoned session as a restart.
						if (!cancelled) {
							setAnswers(s.answers ?? {});
							setIdx(Math.min(s.idx ?? 0, j.config.sections.length - 1));
						}
						j.token = s.token && /^[0-9a-f]{32}$/.test(s.token) ? s.token : j.token;
					} catch {
						/* ignore */
					}
				}
				if (!cancelled) {
					setStart(j);
					window.sessionStorage.setItem(key, JSON.stringify({ token: j.token, answers: saved ? (JSON.parse(saved) as { answers: AnswerMap }).answers ?? {} : {}, idx: saved ? (JSON.parse(saved) as { idx: number }).idx ?? 0 : 0 }));
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start.');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [slug, src]); // eslint-disable-line react-hooks/exhaustive-deps

	const persist = useCallback(
		async (nextIdx?: number, consented?: boolean) => {
			if (!start) return;
			const key = `or_apply_${slug}`;
			window.sessionStorage.setItem(key, JSON.stringify({ token: start.token, answers, idx: nextIdx ?? idx }));
			try {
				const r = await fetch(api('save'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: start.token, answers, max_section: nextIdx ?? idx, consented }) });
				if (r.status === 401) {
					// session vanished (expired / another device): start fresh, keep answers
					window.sessionStorage.removeItem(key);
				}
			} catch {
				/* offline: sessionStorage still has it */
			}
			dirty.current = false;
		},
		[start, answers, idx, slug], // eslint-disable-line react-hooks/exhaustive-deps
	);
	useEffect(() => {
		const t = setInterval(() => {
			if (dirty.current) void persist();
		}, 4000);
		return () => clearInterval(t);
	}, [persist]);

	const setAnswer = useCallback((key: string, patch: Partial<AnswerMeta>) => {
		dirty.current = true;
		setAnswers((cur) => ({ ...cur, [key]: { ...(cur[key] ?? { value: undefined }), ...patch } }));
	}, []);

	const sections = start?.config.sections ?? [];
	const section = sections[idx];
	const progress = sections.length ? Math.round(((idx + (done ? 1 : 0)) / sections.length) * 100) : 0;

	const next = async () => {
		if (!section) return;
		const e = validateSection(section, answers);
		setErrs(e);
		if (Object.keys(e).length) return;
		if (idx === sections.length - 1) return submit();
		const n = idx + 1;
		setIdx(n);
		await persist(n, section.kind === 'consent' ? true : undefined);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};
	const back = () => {
		if (idx > 0) setIdx(idx - 1);
	};
	const submit = async () => {
		if (!start) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(api('submit'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: start.token, answers }) });
			const j = (await res.json()) as { ok?: boolean; error?: string; errors?: Record<string, string>; section?: string; application_id?: string; honeypots?: { key: string; label: string; value: number }[] };
			if (!res.ok || !j.ok) {
				if (j.errors) {
					setErrs(j.errors);
					const si = sections.findIndex((s) => s.key === j.section);
					if (si >= 0) setIdx(si);
				}
				setError(j.error ?? 'Could not submit.');
				return;
			}
			window.sessionStorage.removeItem(`or_apply_${slug}`);
			setDone({ application_id: j.application_id ?? '', honeypots: j.honeypots ?? [] });
		} catch {
			setError('Network error. Your answers are saved on this device; try again.');
		} finally {
			setBusy(false);
		}
	};

	if (error && !start) return <p className="text-sm text-red-600">{error}</p>;
	if (!start) return <p className="text-sm text-slate-500">Loading…</p>;

	if (done) {
		return (
			<div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
				<h2 className="text-lg font-semibold">Application received</h2>
				<p className="text-sm text-slate-700">Thank you. We review every application personally (with AI help on the first pass) and reply within a week either way.</p>
				{done.honeypots.length > 0 && !followupDone && (
					<div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-2">
						<p className="text-sm text-amber-900">
							One quick follow-up: you rated yourself {done.honeypots.map((h) => `${h.value}/5 on ${h.label}`).join(' and ')}. We could not find much about {done.honeypots.length === 1 ? 'that tool' : 'those tools'} — could you tell us where you used {done.honeypots.length === 1 ? 'it' : 'them'} and for what?
						</p>
						<textarea className={cls} rows={3} value={followup} onChange={(e) => setFollowup(e.target.value)} maxLength={4000} />
						<div className="flex gap-2">
							<button
								type="button"
								className={btn}
								disabled={!followup.trim() || busy}
								onClick={async () => {
									setBusy(true);
									await fetch(api('followup'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: start.token, text: followup }) });
									setBusy(false);
									setFollowupDone(true);
								}}
							>
								Send
							</button>
							<button type="button" className={btnGhost} onClick={() => setFollowupDone(true)}>
								Skip
							</button>
						</div>
					</div>
				)}
				<p className="text-2xs text-slate-500">Reference: {done.application_id.slice(0, 8)}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between text-xs text-slate-500">
				<span>
					Step {idx + 1} of {sections.length} · {section?.title}
				</span>
				<span>{progress}%</span>
			</div>
			<div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
				<div className="h-full bg-primary-600 transition-all" style={{ width: `${progress}%` }} />
			</div>
			{error && <p className="text-sm text-red-600">{error}</p>}
			{section && (
				<div className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
					<div>
						<h2 className="text-lg font-semibold">{section.title}</h2>
						{section.kind === 'consent' && (
							<div className="prose prose-sm prose-slate max-w-none mt-2">
								<Markdown>{start.consent.body_md}</Markdown>
							</div>
						)}
						{section.intro_md && <p className="text-sm text-slate-600 mt-1">{section.intro_md}</p>}
					</div>
					{section.questions.map((q) => (
						<Question key={q.key} q={q} meta={answers[q.key]} error={errs[q.key]} onChange={(patch) => setAnswer(q.key, patch)} token={start.token} api={api} />
					))}
					<div className="flex items-center justify-between pt-2">
						<button type="button" className={btnGhost} onClick={back} disabled={idx === 0 || busy}>
							Back
						</button>
						<button type="button" className={btn} onClick={next} disabled={busy}>
							{busy ? 'Submitting…' : idx === sections.length - 1 ? 'Submit application' : 'Continue'}
						</button>
					</div>
				</div>
			)}
			<p className="text-2xs text-slate-500 text-center">Your progress saves automatically on this device. English only.</p>
		</div>
	);
}

// ---------------------------------------------------------------- question

function Question({ q, meta, error, onChange, token, api }: { q: AppQuestion; meta: AnswerMeta | undefined; error?: string; onChange: (p: Partial<AnswerMeta>) => void; token: string; api: (a: string) => string }) {
	const value = meta?.value;
	const paste = q.paste ?? 'track';
	const started = useRef<number | null>(null);
	const touch = () => {
		if (!started.current) {
			started.current = Date.now();
			onChange({ started_at: new Date().toISOString() });
		}
	};
	const onPaste = (e: React.ClipboardEvent) => {
		touch();
		const text = e.clipboardData.getData('text');
		if (paste === 'block') {
			e.preventDefault();
			onChange({ blocked: (meta?.blocked ?? 0) + 1 });
			return;
		}
		onChange({ paste_events: (meta?.paste_events ?? 0) + 1, pasted_chars: (meta?.pasted_chars ?? 0) + text.length });
	};
	const onKey = (e: React.KeyboardEvent) => {
		touch();
		if (e.key.length === 1) onChange({ typed_chars: (meta?.typed_chars ?? 0) + 1 });
	};
	const label = (
		<label className="block text-sm font-medium text-slate-800">
			{q.label}
			{q.required && q.type !== 'statement' && <span className="text-red-500"> *</span>}
			{q.help && <span className="block text-xs font-normal text-slate-500 mt-0.5">{q.help}</span>}
		</label>
	);
	const err = error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null;

	switch (q.type) {
		case 'statement':
			return <p className="text-sm text-slate-700">{q.label}</p>;
		case 'boolean':
			return (
				<div>
					<label className="flex items-start gap-2 text-sm text-slate-800">
						<input type="checkbox" className="mt-1" checked={value === true} onChange={(e) => onChange({ value: e.target.checked, finished_at: new Date().toISOString() })} />
						<span>
							{q.label}
							{q.required && <span className="text-red-500"> *</span>}
							{q.help && <span className="block text-xs text-slate-500">{q.help}</span>}
						</span>
					</label>
					{err}
				</div>
			);
		case 'select':
			return (
				<div>
					{label}
					<select className={`${cls} mt-1`} value={(value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value, finished_at: new Date().toISOString() })}>
						<option value="">—</option>
						{q.options?.map((o) => (
							<option key={o} value={o}>
								{o}
							</option>
						))}
					</select>
					{err}
				</div>
			);
		case 'multi':
			return (
				<div>
					{label}
					<div className="mt-1 grid sm:grid-cols-2 gap-1.5">
						{q.options?.map((o) => {
							const arr = Array.isArray(value) ? (value as string[]) : [];
							const on = arr.includes(o);
							return (
								<label key={o} className="flex items-center gap-2 text-sm text-slate-800">
									<input type="checkbox" checked={on} onChange={() => onChange({ value: on ? arr.filter((x) => x !== o) : [...arr, o], finished_at: new Date().toISOString() })} /> {o}
								</label>
							);
						})}
					</div>
					{err}
				</div>
			);
		case 'rating_1_5':
			return (
				<div>
					{label}
					<div className="mt-1 flex gap-1.5">
						{[1, 2, 3, 4, 5].map((n) => (
							<button key={n} type="button" onClick={() => onChange({ value: n, finished_at: new Date().toISOString() })} className={`w-10 h-10 rounded-md border text-sm font-medium ${value === n ? 'border-primary-600 bg-primary-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`} aria-label={`${n} of 5`}>
								{n}
							</button>
						))}
						<span className="text-2xs text-slate-500 self-center ml-2">1 never used · 3 can work unaided · 5 expert</span>
					</div>
					{err}
				</div>
			);
		case 'long_text':
			return (
				<div>
					{label}
					<textarea className={`${cls} mt-1`} rows={5} value={(value as string) ?? ''} maxLength={q.max_chars ?? 5000} onChange={(e) => onChange({ value: e.target.value, finished_at: new Date().toISOString() })} onPaste={onPaste} onKeyDown={onKey} />
					<div className="flex justify-between text-2xs text-slate-400 mt-0.5">
						<span>{paste === 'block' ? 'No paste on this question.' : ''}</span>
						<span>
							{String(value ?? '').length}
							{q.max_chars ? ` / ${q.max_chars}` : ''}
						</span>
					</div>
					{err}
				</div>
			);
		case 'timed_text':
			return <TimedQuestion q={q} meta={meta} error={error} onChange={onChange} onPaste={onPaste} onKey={onKey} />;
		case 'file':
			return <FileQuestion q={q} meta={meta} error={error} onChange={onChange} token={token} api={api} kind="resume" accept=".pdf,.doc,.docx" />;
		case 'video':
			return <VideoQuestion q={q} meta={meta} error={error} onChange={onChange} token={token} api={api} />;
		default: {
			const type = q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : q.type === 'url' ? 'url' : q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text';
			return (
				<div>
					{label}
					<input type={type} className={`${cls} mt-1`} value={(value as string) ?? ''} maxLength={q.max_chars ?? 300} min={q.min} max={q.max} placeholder={q.type === 'phone' ? '+1 615 555 0100' : q.type === 'url' ? 'https://' : undefined} onChange={(e) => onChange({ value: e.target.value, finished_at: new Date().toISOString() })} onPaste={onPaste} onKeyDown={onKey} />
					{err}
				</div>
			);
		}
	}
}

function TimedQuestion({ q, meta, error, onChange, onPaste, onKey }: { q: AppQuestion; meta: AnswerMeta | undefined; error?: string; onChange: (p: Partial<AnswerMeta>) => void; onPaste: (e: React.ClipboardEvent) => void; onKey: (e: React.KeyboardEvent) => void }) {
	const limit = q.time_limit_s ?? 180;
	const [left, setLeft] = useState<number>(() => (meta?.time_used_s != null ? Math.max(0, limit - meta.time_used_s) : limit));
	const [running, setRunning] = useState(false);
	const finished = meta?.finished_at != null && (meta.time_used_s ?? 0) >= limit;
	const startedAt = useRef<number | null>(null);
	useEffect(() => {
		if (!running) return;
		const t = setInterval(() => {
			const used = Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000) + (meta?.time_used_s ?? 0);
			const l = Math.max(0, limit - used);
			setLeft(l);
			if (l <= 0) {
				setRunning(false);
				onChange({ time_used_s: limit, finished_at: new Date().toISOString() });
			}
		}, 500);
		return () => clearInterval(t);
	}, [running, limit]); // eslint-disable-line react-hooks/exhaustive-deps
	const begin = () => {
		startedAt.current = Date.now();
		setRunning(true);
		onChange({ started_at: meta?.started_at ?? new Date().toISOString() });
	};
	const stop = () => {
		const used = Math.min(limit, Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000) + (meta?.time_used_s ?? 0));
		setRunning(false);
		onChange({ time_used_s: used, finished_at: new Date().toISOString() });
	};
	const mm = String(Math.floor(left / 60)).padStart(1, '0');
	const ss = String(left % 60).padStart(2, '0');
	const answered = typeof meta?.value === 'string' && meta.value.length > 0;
	return (
		<div className="rounded-md border border-slate-200 p-4 space-y-2">
			<div className="flex items-start justify-between gap-3">
				<label className="block text-sm font-medium text-slate-800">
					{q.label}
					{q.required && <span className="text-red-500"> *</span>}
				</label>
				<span className={`font-mono text-sm tabular-nums ${left <= 20 ? 'text-red-600' : 'text-slate-600'}`}>
					{mm}:{ss}
				</span>
			</div>
			{!running && !answered && !finished && (
				<button type="button" className={btn} onClick={begin}>
					Start ({Math.round(limit / 60)} min, no paste)
				</button>
			)}
			{(running || answered || finished) && (
				<>
					<textarea className={cls} rows={6} value={(meta?.value as string) ?? ''} maxLength={q.max_chars ?? 3000} disabled={!running} onChange={(e) => onChange({ value: e.target.value })} onPaste={onPaste} onKeyDown={onKey} placeholder={running ? 'Type your answer…' : ''} />
					<div className="flex items-center justify-between text-2xs text-slate-500">
						<span>{(meta?.blocked ?? 0) > 0 ? `${meta?.blocked} paste attempt${meta?.blocked === 1 ? '' : 's'} blocked.` : 'Paste is disabled here.'}</span>
						{running && (
							<button type="button" className="underline" onClick={stop}>
								Done early
							</button>
						)}
						{!running && (answered || finished) && <span>Locked · {meta?.time_used_s ?? limit}s used</span>}
					</div>
				</>
			)}
			{error && <p className="text-xs text-red-600">{error}</p>}
		</div>
	);
}

function FileQuestion({ q, meta, error, onChange, token, api, kind, accept }: { q: AppQuestion; meta: AnswerMeta | undefined; error?: string; onChange: (p: Partial<AnswerMeta>) => void; token: string; api: (a: string) => string; kind: string; accept: string }) {
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [name, setName] = useState<string | null>(null);
	const upload = async (file: File) => {
		setBusy(true);
		setErr(null);
		const fd = new FormData();
		fd.set('token', token);
		fd.set('kind', kind);
		fd.set('file', file);
		try {
			const r = await fetch(api('upload'), { method: 'POST', body: fd });
			const j = (await r.json()) as { ok?: boolean; path?: string; error?: string };
			if (!r.ok || !j.path) throw new Error(j.error ?? 'Upload failed');
			onChange({ value: j.path, finished_at: new Date().toISOString() });
			setName(file.name);
		} catch (e) {
			setErr(e instanceof Error ? e.message : 'Upload failed');
		} finally {
			setBusy(false);
		}
	};
	return (
		<div>
			<label className="block text-sm font-medium text-slate-800">
				{q.label}
				{q.required && <span className="text-red-500"> *</span>}
				{q.help && <span className="block text-xs font-normal text-slate-500">{q.help}</span>}
			</label>
			<input type="file" accept={accept} className="mt-1 block text-sm" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
			{busy && <p className="text-2xs text-slate-500">Uploading…</p>}
			{typeof meta?.value === 'string' && meta.value && <p className="text-2xs text-green-700">Uploaded{name ? `: ${name}` : ''}.</p>}
			{(err || error) && <p className="text-xs text-red-600 mt-1">{err ?? error}</p>}
		</div>
	);
}

function VideoQuestion({ q, meta, error, onChange, token, api }: { q: AppQuestion; meta: AnswerMeta | undefined; error?: string; onChange: (p: Partial<AnswerMeta>) => void; token: string; api: (a: string) => string }) {
	const [mode, setMode] = useState<'link' | 'record'>('link');
	const [rec, setRec] = useState<MediaRecorder | null>(null);
	const [stream, setStream] = useState<MediaStream | null>(null);
	const [seconds, setSeconds] = useState(0);
	const [blob, setBlob] = useState<Blob | null>(null);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const chunks = useRef<Blob[]>([]);
	const supported = typeof window !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';
	useEffect(() => {
		if (!rec) return;
		const t = setInterval(() => setSeconds((s) => s + 1), 1000);
		return () => clearInterval(t);
	}, [rec]);
	useEffect(() => {
		if (seconds >= 90 && rec) rec.stop();
	}, [seconds, rec]);
	useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
	const startRec = async () => {
		setErr(null);
		try {
			const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
			setStream(s);
			if (videoRef.current) {
				videoRef.current.srcObject = s;
				void videoRef.current.play();
			}
			const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
			const r = new MediaRecorder(s, { mimeType: mime });
			chunks.current = [];
			r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
			r.onstop = () => {
				const b = new Blob(chunks.current, { type: mime.split(';')[0] });
				setBlob(b);
				s.getTracks().forEach((t) => t.stop());
				setRec(null);
			};
			r.start(1000);
			setSeconds(0);
			setRec(r);
		} catch {
			setErr('Camera or microphone not available. Paste a Loom or YouTube link instead.');
			setMode('link');
		}
	};
	const upload = async () => {
		if (!blob) return;
		setBusy(true);
		setErr(null);
		const fd = new FormData();
		fd.set('token', token);
		fd.set('kind', 'video');
		fd.set('file', new File([blob], `intro.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: blob.type }));
		try {
			const r = await fetch(api('upload'), { method: 'POST', body: fd });
			const j = (await r.json()) as { ok?: boolean; path?: string; error?: string };
			if (!r.ok || !j.path) throw new Error(j.error ?? 'Upload failed');
			onChange({ value: j.path, finished_at: new Date().toISOString() });
		} catch (e) {
			setErr(e instanceof Error ? e.message : 'Upload failed');
		} finally {
			setBusy(false);
		}
	};
	const val = typeof meta?.value === 'string' ? meta.value : '';
	const uploaded = val.startsWith('sessions/');
	return (
		<div className="space-y-2">
			<label className="block text-sm font-medium text-slate-800">
				{q.label}
				{q.required && <span className="text-red-500"> *</span>}
			</label>
			<div className="flex gap-2 text-xs">
				<button type="button" className={`px-3 py-1 rounded-md border ${mode === 'link' ? 'border-primary-600 text-primary-700' : 'border-slate-300 text-slate-600'}`} onClick={() => setMode('link')}>
					Paste a link
				</button>
				<button type="button" className={`px-3 py-1 rounded-md border ${mode === 'record' ? 'border-primary-600 text-primary-700' : 'border-slate-300 text-slate-600'}`} onClick={() => setMode('record')} disabled={!supported}>
					Record here{!supported ? ' (unsupported browser)' : ''}
				</button>
			</div>
			{mode === 'link' && (
				<>
					<input type="url" className={cls} placeholder="https://www.loom.com/share/… or an unlisted YouTube link" value={uploaded ? '' : val} onChange={(e) => onChange({ value: e.target.value, finished_at: new Date().toISOString() })} />
					{val && !uploaded && !isVideoLink(val) && <p className="text-2xs text-amber-600">That does not look like a Loom / YouTube / Vimeo / Drive link.</p>}
					{uploaded && <p className="text-2xs text-green-700">A recording is attached. Pasting a link replaces it.</p>}
				</>
			)}
			{mode === 'record' && (
				<div className="space-y-2">
					<video ref={videoRef} muted playsInline className="w-full max-w-sm rounded-md bg-slate-900 aspect-video" src={blob && !rec ? URL.createObjectURL(blob) : undefined} controls={!!blob && !rec} />
					<div className="flex items-center gap-2">
						{!rec && !blob && (
							<button type="button" className={btn} onClick={startRec}>
								Start recording
							</button>
						)}
						{rec && (
							<>
								<span className="font-mono text-sm text-red-600">● {seconds}s / 90s</span>
								<button type="button" className={btnGhost} onClick={() => rec.stop()}>
									Stop
								</button>
							</>
						)}
						{blob && !rec && (
							<>
								<button type="button" className={btn} onClick={upload} disabled={busy || uploaded}>
									{uploaded ? 'Uploaded' : busy ? 'Uploading…' : 'Use this take'}
								</button>
								<button
									type="button"
									className={btnGhost}
									onClick={() => {
										setBlob(null);
										onChange({ value: '' });
									}}
								>
									Re-record
								</button>
							</>
						)}
					</div>
				</div>
			)}
			{(err || error) && <p className="text-xs text-red-600">{err ?? error}</p>}
		</div>
	);
}
