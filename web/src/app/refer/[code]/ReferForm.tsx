'use client';

import { useState } from 'react';

const cls = 'w-full text-sm rounded-md border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500';

export default function ReferForm({ code }: { code: string }) {
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	if (done) {
		return (
			<div className="text-center py-6 space-y-2">
				<h2 className="text-lg font-semibold">Thank you!</h2>
				<p className="text-sm text-slate-600">We&apos;ll reach out to them this week and keep you posted.</p>
			</div>
		);
	}
	return (
		<form
			className="space-y-3"
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setError(null);
				const fd = new FormData(e.currentTarget);
				const body = Object.fromEntries(fd.entries());
				try {
					const res = await fetch(`/api/intake/refer/${code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
					const j = (await res.json()) as { ok?: boolean; error?: string };
					if (!res.ok || !j.ok) setError(j.error ?? 'Something went wrong.');
					else setDone(true);
				} catch {
					setError('Network error. Please try again.');
				} finally {
					setBusy(false);
				}
			}}
		>
			<input type="text" name="company_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
			<fieldset className="space-y-2">
				<legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">The brand</legend>
				<input name="brand" required placeholder="Brand name" className={cls} />
				<input name="website" placeholder="Website or Instagram" className={cls} />
				<input name="contact_name" required placeholder="Contact name" className={cls} />
				<input name="email" type="email" placeholder="Contact email" className={cls} />
				<input name="phone" type="tel" placeholder="Contact phone" className={cls} />
				<textarea name="why" rows={3} placeholder="Why are they a fit? What do they do, and why now?" className={cls} />
			</fieldset>
			<fieldset className="space-y-2">
				<legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">You</legend>
				<input name="your_name" required placeholder="Your name" className={cls} />
				<input name="your_email" type="email" required placeholder="Your email (for the commission)" className={cls} />
			</fieldset>
			{error && <p className="text-sm text-red-600">{error}</p>}
			<button type="submit" disabled={busy} className="inline-flex items-center justify-center rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50">
				{busy ? 'Sending…' : 'Send the referral'}
			</button>
		</form>
	);
}
