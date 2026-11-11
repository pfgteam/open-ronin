'use client';

// Candidate-side DISC (0134): the questionnaire posts to /api/careers/portal/disc
// with the portal token; the result shows inline.

import { useState } from 'react';
import DiscQuestionnaire from '@/components/hiring/DiscQuestionnaire';
import { DISC_TRAITS, DISC_TRAIT_LABELS, type DiscAnswer, type DiscQuestion } from '@/lib/hiring/onboarding';

export default function PortalDisc({ token, questions, existing }: { token: string; questions: DiscQuestion[]; existing: { style: string; scores: Record<string, number> } | null }) {
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ style: string; scores: Record<string, number> } | null>(existing);
	const [err, setErr] = useState<string | null>(null);
	const [retake, setRetake] = useState(false);
	const submit = async (answers: DiscAnswer[]) => {
		setBusy(true);
		setErr(null);
		try {
			const r = await fetch('/api/careers/portal/disc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, answers }) });
			const j = (await r.json()) as { ok?: boolean; error?: string; style?: string; scores?: Record<string, number> };
			if (!r.ok || !j.ok) setErr(j.error ?? 'Could not save.');
			else {
				setResult({ style: j.style!, scores: j.scores! });
				setRetake(false);
			}
		} catch {
			setErr('Network error.');
		} finally {
			setBusy(false);
		}
	};
	if (result && !retake) {
		const primary = result.style[0]?.toUpperCase() as 'D' | 'I' | 'S' | 'C' | undefined;
		return (
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<span className="text-sm text-slate-700">Your work style:</span>
					<span className="font-mono text-base font-semibold text-slate-900">{result.style}</span>
				</div>
				<div className="space-y-1">
					{DISC_TRAITS.map((t) => (
						<div key={t} className="flex items-center gap-2 text-xs">
							<span className="w-4 font-mono font-semibold text-slate-700">{t}</span>
							<div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-primary-600 rounded-full" style={{ width: `${Math.min(100, result.scores[t] ?? 0)}%` }} /></div>
							<span className="w-10 text-right tabular-nums text-slate-600">{Math.round(result.scores[t] ?? 0)}%</span>
						</div>
					))}
				</div>
				{primary && DISC_TRAIT_LABELS[primary] && <p className="text-xs text-slate-600"><strong>{DISC_TRAIT_LABELS[primary].name}</strong> leads. {DISC_TRAIT_LABELS[primary].blurb} Thank you — your interviewers will see this alongside your application.</p>}
				<button type="button" onClick={() => setRetake(true)} className="text-xs text-primary-700 underline">Retake</button>
			</div>
		);
	}
	return (
		<div className="space-y-2">
			<DiscQuestionnaire questions={questions} onSubmit={submit} busy={busy} submitLabel="Submit my answers" />
			{err && <p className="text-xs text-red-600">{err}</p>}
		</div>
	);
}
