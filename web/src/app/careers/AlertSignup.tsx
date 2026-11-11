'use client';

// Job-alert opt-in (0129, round 3): on the careers page footer and on a
// closed role's page. Posts to /api/careers/alerts (service role, dedupes
// on email). The H5 comms layer sends the actual alerts.

import { useState } from 'react';

const cls = 'text-sm rounded-md border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500';

export default function AlertSignup({ positionId, tags, source, compact = false }: { positionId?: string | null; tags?: string[]; source: string; compact?: boolean }) {
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	if (done) return <p className="text-sm text-slate-600">You&apos;re on the list. We only email when a matching role opens; unsubscribe any time.</p>;
	return (
		<form
			className={compact ? 'flex flex-wrap gap-2 items-end' : 'space-y-2'}
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setError(null);
				const fd = new FormData(e.currentTarget);
				try {
					const res = await fetch('/api/careers/alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: fd.get('email'), name: fd.get('name'), position_id: positionId ?? null, tags: tags ?? [], source, company_url: fd.get('company_url') }) });
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
			{!compact && <input name="name" placeholder="Your name" className={`${cls} w-full`} maxLength={120} />}
			<input name="email" type="email" required placeholder="you@example.com" className={`${cls} ${compact ? 'w-64' : 'w-full'}`} maxLength={200} />
			<button type="submit" disabled={busy} className="rounded-md bg-primary-700 hover:bg-primary-800 text-white text-sm font-medium px-4 py-2 disabled:opacity-60">
				{busy ? 'Saving…' : 'Alert me about new roles'}
			</button>
			{error && <p className="text-xs text-red-600 w-full">{error}</p>}
		</form>
	);
}
