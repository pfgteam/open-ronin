'use client';

// The in-app DISC-style questionnaire (decision 2): 24 groups of four
// adjectives; pick the one MOST like you and the one LEAST like you. Pure
// UI — the caller submits (staff action or the candidate portal API).
// Styled with plain Tailwind (no ui/* imports) so the public portal, which
// has no app shell, renders it too.

import { useMemo, useState } from 'react';
import { DISC_TRAITS, type DiscAnswer, type DiscQuestion, type DiscTrait } from '@/lib/hiring/onboarding';

export default function DiscQuestionnaire({ questions, onSubmit, busy, submitLabel = 'Submit' }: { questions: DiscQuestion[]; onSubmit: (answers: DiscAnswer[]) => void; busy?: boolean; submitLabel?: string }) {
	const [answers, setAnswers] = useState<Record<number, { most?: DiscTrait; least?: DiscTrait }>>({});
	const words = (q: DiscQuestion): Record<DiscTrait, string> => ({ D: q.d_word, I: q.i_word, S: q.s_word, C: q.c_word });
	// shuffle the four words per question once so the trait order is not a tell
	const order = useMemo(() => {
		const out: Record<number, DiscTrait[]> = {};
		for (const q of questions) {
			const arr = [...DISC_TRAITS];
			let seed = q.id * 2654435761;
			for (let i = arr.length - 1; i > 0; i--) {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff;
				const j = seed % (i + 1);
				[arr[i], arr[j]] = [arr[j], arr[i]];
			}
			out[q.id] = arr;
		}
		return out;
	}, [questions]);
	const complete = questions.filter((q) => answers[q.id]?.most && answers[q.id]?.least && answers[q.id]!.most !== answers[q.id]!.least).length;
	const set = (qid: number, which: 'most' | 'least', t: DiscTrait) =>
		setAnswers((prev) => {
			const cur = { ...(prev[qid] ?? {}) };
			cur[which] = t;
			// the same word cannot be both
			if (which === 'most' && cur.least === t) cur.least = undefined;
			if (which === 'least' && cur.most === t) cur.most = undefined;
			return { ...prev, [qid]: cur };
		});

	return (
		<div className="space-y-3">
			<p className="text-sm text-slate-700">For each row pick the word that is <strong>most</strong> like you and the word that is <strong>least</strong> like you at work. Go with your first instinct; there are no right answers. About 5 minutes.</p>
			<div className="rounded-lg border border-slate-200 overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-2xs uppercase tracking-wide text-slate-500">
						<tr>
							<th className="px-2 py-1.5 text-left w-8">#</th>
							<th className="px-2 py-1.5 text-left">Word</th>
							<th className="px-2 py-1.5 text-center w-16">Most</th>
							<th className="px-2 py-1.5 text-center w-16">Least</th>
						</tr>
					</thead>
					<tbody>
						{questions.map((q, qi) => {
							const w = words(q);
							const a = answers[q.id] ?? {};
							const done = a.most && a.least;
							return order[q.id].map((t, i) => (
								<tr key={`${q.id}-${t}`} className={`${qi % 2 ? 'bg-slate-50/60' : 'bg-white'} ${i === 0 ? 'border-t border-slate-200' : ''}`}>
									{i === 0 && <td rowSpan={4} className={`px-2 py-1 text-xs align-top tabular-nums ${done ? 'text-green-700' : 'text-slate-400'}`}>{qi + 1}{done ? ' ✓' : ''}</td>}
									<td className="px-2 py-1 text-slate-800">{w[t]}</td>
									<td className="px-2 py-1 text-center">
										<input type="radio" name={`most-${q.id}`} checked={a.most === t} onChange={() => set(q.id, 'most', t)} aria-label={`${w[t]} most like me`} className="accent-primary-700" />
									</td>
									<td className="px-2 py-1 text-center">
										<input type="radio" name={`least-${q.id}`} checked={a.least === t} onChange={() => set(q.id, 'least', t)} aria-label={`${w[t]} least like me`} className="accent-primary-700" />
									</td>
								</tr>
							));
						})}
					</tbody>
				</table>
			</div>
			<div className="flex items-center gap-3">
				<button
					type="button"
					disabled={busy || complete < questions.length}
					onClick={() => onSubmit(questions.map((q) => ({ q: q.id, most: answers[q.id]!.most!, least: answers[q.id]!.least! })))}
					className="rounded-md bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2"
				>
					{busy ? 'Saving…' : submitLabel}
				</button>
				<span className="text-xs text-slate-500">{complete} of {questions.length} answered</span>
			</div>
		</div>
	);
}
