'use client';

// Multi-page renderer for the public intake form. Pages come from the
// `page` key on each field; conditional logic hides fields live; required
// visible fields block "Next". Submits once to /api/intake/form/<slug> and
// shows the routing copy the server returns.

import { useMemo, useState } from 'react';
import { visibleFields, type FormField, type FormValues } from '@/lib/forms/logic';

const cls = 'w-full text-sm rounded-md border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500';

interface Copy {
	title?: string;
	body?: string;
	cta_label?: string;
	cta_url?: string;
}

export default function PublicIntakeForm({ slug, fields, pages }: { slug: string; fields: FormField[]; pages: Record<string, number> }) {
	const [values, setValues] = useState<FormValues>({});
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<{ routing: string; copy: Copy | null } | null>(null);
	const shown = visibleFields(fields, values);
	const pageNumbers = useMemo(() => [...new Set(shown.map((f) => pages[f.key] ?? 1))].sort((a, b) => a - b), [shown, pages]);
	const current = shown.filter((f) => (pages[f.key] ?? 1) === page);
	const lastPage = pageNumbers[pageNumbers.length - 1] ?? 1;
	const idx = pageNumbers.indexOf(page);
	const set = (k: string, v: FormValues[string]) => setValues((x) => ({ ...x, [k]: v }));

	function pageValid(): string | null {
		for (const f of current) {
			const v = values[f.key];
			const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
			if (f.required && empty) return `${f.label} is required.`;
			if (f.type === 'email' && typeof v === 'string' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'Please enter a valid email.';
		}
		return null;
	}

	async function submit() {
		const err = pageValid();
		if (err) return setError(err);
		setError(null);
		setBusy(true);
		try {
			const res = await fetch(`/api/intake/form/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
			const body = (await res.json()) as { ok?: boolean; error?: string; routing?: string; copy?: Copy | null };
			if (!res.ok || !body.ok) {
				setError(body.error ?? 'Something went wrong. Please try again.');
				return;
			}
			setDone({ routing: body.routing ?? 'nurture', copy: body.copy ?? null });
		} catch {
			setError('Network error. Please try again.');
		} finally {
			setBusy(false);
		}
	}

	if (done) {
		const c = done.copy ?? {};
		return (
			<div className="space-y-3 text-center py-6">
				<h2 className="text-lg font-semibold">{c.title ?? 'Thank you!'}</h2>
				<p className="text-sm text-slate-600">{c.body ?? 'Our team will reach out shortly.'}</p>
				{c.cta_url && (
					<a href={c.cta_url} className="inline-flex items-center justify-center rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800">
						{c.cta_label ?? 'Book a call'}
					</a>
				)}
			</div>
		);
	}

	return (
		<form
			className="space-y-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (page === lastPage) void submit();
				else {
					const err = pageValid();
					if (err) return setError(err);
					setError(null);
					setPage(pageNumbers[idx + 1] ?? lastPage);
				}
			}}
		>
			{/* honeypot */}
			<input type="text" name="company_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden onChange={(e) => set('company_url', e.target.value)} />
			<div className="flex items-center gap-2 text-2xs text-slate-500">
				{pageNumbers.map((p) => (
					<span key={p} className={`h-1.5 flex-1 rounded-full ${p <= page ? 'bg-primary-600' : 'bg-slate-200'}`} />
				))}
				<span className="tabular-nums">
					{idx + 1} / {pageNumbers.length}
				</span>
			</div>
			{current.map((f) => (
				<div key={f.key}>
					<label className="text-sm font-medium text-slate-800 block mb-1">
						{f.label}
						{f.required && <span className="text-red-500 ml-0.5">*</span>}
					</label>
					{f.type === 'textarea' ? (
						<textarea rows={3} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className={cls} />
					) : f.type === 'select' ? (
						<div className="grid gap-1.5">
							{(f.options ?? []).map((o) => {
								const sel = values[f.key] === o;
								return (
									<button
										key={o}
										type="button"
										onClick={() => set(f.key, o)}
										className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${sel ? 'border-primary-500 bg-primary-50 text-primary-900' : 'border-slate-200 hover:bg-slate-50'}`}
									>
										{o}
									</button>
								);
							})}
						</div>
					) : f.type === 'checkbox' ? (
						<label className="inline-flex items-center gap-1.5 text-sm">
							<input type="checkbox" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> Yes
						</label>
					) : (
						<input
							type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'number' ? 'number' : 'text'}
							value={String(values[f.key] ?? '')}
							onChange={(e) => set(f.key, e.target.value)}
							className={cls}
							autoComplete={f.type === 'email' ? 'email' : f.key === 'phone' ? 'tel' : f.key === 'full_name' ? 'name' : 'off'}
						/>
					)}
					{f.help && <p className="text-2xs text-slate-500 mt-1">{f.help}</p>}
				</div>
			))}
			{error && <p className="text-sm text-red-600">{error}</p>}
			<div className="flex items-center justify-between pt-2">
				<button type="button" disabled={idx <= 0 || busy} onClick={() => setPage(pageNumbers[idx - 1] ?? page)} className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40">
					Back
				</button>
				<button type="submit" disabled={busy} className="inline-flex items-center justify-center rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50">
					{busy ? 'Sending…' : page === lastPage ? 'Submit' : 'Next'}
				</button>
			</div>
		</form>
	);
}
