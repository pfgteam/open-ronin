'use client';

import { useState } from 'react';

const QUESTIONS: Record<string, { key: string; label: string }[]> = {
	call: [
		{ key: 'understood', label: 'Did we understand your brand and goals?' },
		{ key: 'clear', label: 'Was the next step clear?' },
		{ key: 'improve', label: 'What could we have done better?' },
	],
	client: [
		{ key: 'onboarding', label: 'How was getting started?' },
		{ key: 'communication', label: 'How is communication with your team?' },
		{ key: 'improve', label: 'What would make this a 5?' },
	],
	prospect: [
		{ key: 'experience', label: 'How was your experience with us so far?' },
		{ key: 'improve', label: 'What could we have done better?' },
	],
};

const cls = 'w-full text-sm rounded-md border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500';

export default function FeedbackForm({ token, kind }: { token: string; kind: string }) {
	const [rating, setRating] = useState<number | null>(null);
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const qs = QUESTIONS[kind] ?? QUESTIONS.prospect;
	if (done) return <p className="text-sm text-slate-600 text-center py-6">Thank you — that helps us get better.</p>;
	return (
		<form
			className="space-y-4"
			onSubmit={async (e) => {
				e.preventDefault();
				if (!rating) return setError('Pick a rating first.');
				setBusy(true);
				setError(null);
				const fd = new FormData(e.currentTarget);
				const answers: Record<string, string> = {};
				for (const q of qs) answers[q.key] = String(fd.get(q.key) ?? '');
				try {
					const res = await fetch(`/api/intake/feedback/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating, answers, comment: String(fd.get('comment') ?? '') }) });
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
			<div>
				<div className="text-sm font-medium text-slate-800 mb-2">Overall</div>
				<div className="flex gap-2">
					{[1, 2, 3, 4, 5].map((n) => (
						<button key={n} type="button" onClick={() => setRating(n)} className={`h-10 w-10 rounded-md border text-sm font-semibold ${rating === n ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 hover:border-primary-400'}`} aria-label={`${n} of 5`}>
							{n}
						</button>
					))}
				</div>
			</div>
			{qs.map((q) => (
				<div key={q.key}>
					<label className="text-sm font-medium text-slate-800 block mb-1">{q.label}</label>
					<textarea name={q.key} rows={2} className={cls} />
				</div>
			))}
			<div>
				<label className="text-sm font-medium text-slate-800 block mb-1">Anything else?</label>
				<textarea name="comment" rows={2} className={cls} />
			</div>
			{error && <p className="text-sm text-red-600">{error}</p>}
			<button type="submit" disabled={busy} className="inline-flex items-center justify-center rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50">
				{busy ? 'Sending…' : 'Send feedback'}
			</button>
		</form>
	);
}
