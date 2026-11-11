'use client';

// The scorecard form (0118): one question per screen, Jotform style. Answer
// choices are the six rubric descriptions (0-5), plus an optional notes box.
// Next / Back; every change autosaves as a draft (debounced). No score shows
// before Submit. The last screen holds the free-text "Top 3 priorities". The
// exec round does not use this form: see ExecScorecardTable.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import { GROUP_LABELS, type AnswerRow, type CycleQuestion, type Round } from '@/lib/calibration/shared';
import { saveCalibrationAnswer, saveCalibrationWrapUp, submitCalibrationRound } from '@/app/(app)/team/calibration/actions';

interface Props {
	scoreId: string;
	round: Round;
	subjectName: string;
	questions: CycleQuestion[];
	answers: AnswerRow[];
	priorities: string | null;
	returnTo: string;
}

type Draft = { rating: number | null; notes: string };

export default function ScorecardForm({ scoreId, round, subjectName, questions, answers, priorities, returnTo }: Props) {
	const router = useRouter();
	const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
		const m: Record<string, Draft> = {};
		for (const q of questions) {
			const a = answers.find((x) => x.cycle_question_id === q.id);
			m[q.id] = { rating: a?.rating ?? null, notes: a?.notes ?? '' };
		}
		return m;
	});
	const [prio, setPrio] = useState(priorities ?? '');
	// Start on the first unanswered question (resume a draft where it left off).
	const firstGap = useMemo(() => {
		const i = questions.findIndex((q) => drafts[q.id]?.rating == null);
		return i < 0 ? questions.length : i;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const [step, setStep] = useState(firstGap);
	const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

	const total = questions.length;
	const isWrapUp = step >= total;
	const answered = questions.filter((q) => drafts[q.id]?.rating != null).length;
	const q = isWrapUp ? null : questions[step];

	const persistAnswer = useCallback(
		(questionId: string, d: Draft) => {
			setSaving('saving');
			void saveCalibrationAnswer({ score_id: scoreId, cycle_question_id: questionId, rating: d.rating, notes: d.notes || null }).then((r) => {
				if (r.ok) {
					setSaving('saved');
					setError(null);
				} else {
					setSaving('error');
					setError(r.error);
				}
			});
		},
		[scoreId],
	);

	const setRating = (questionId: string, rating: number) => {
		const d = { ...(drafts[questionId] ?? { rating: null, notes: '' }), rating };
		setDrafts((prev) => ({ ...prev, [questionId]: d }));
		persistAnswer(questionId, d);
	};

	const setNotes = (questionId: string, notes: string) => {
		const d = { ...(drafts[questionId] ?? { rating: null, notes: '' }), notes };
		setDrafts((prev) => ({ ...prev, [questionId]: d }));
		clearTimeout(timers.current[questionId]);
		timers.current[questionId] = setTimeout(() => persistAnswer(questionId, d), 600);
	};

	const persistWrapUp = useCallback(
		(patch: { priorities_md?: string | null }) => {
			setSaving('saving');
			void saveCalibrationWrapUp({ score_id: scoreId, ...patch }).then((r) => {
				if (r.ok) {
					setSaving('saved');
					setError(null);
				} else {
					setSaving('error');
					setError(r.error);
				}
			});
		},
		[scoreId],
	);

	const onPrio = (v: string) => {
		setPrio(v);
		clearTimeout(timers.current.__prio);
		timers.current.__prio = setTimeout(() => persistWrapUp({ priorities_md: v || null }), 600);
	};

	useEffect(() => {
		const t = timers.current;
		return () => {
			for (const k of Object.keys(t)) clearTimeout(t[k]);
		};
	}, []);

	const submit = () => {
		setError(null);
		startTransition(async () => {
			// flush any pending notes save first
			for (const k of Object.keys(timers.current)) clearTimeout(timers.current[k]);
			const gaps = questions.filter((x) => drafts[x.id]?.rating == null);
			if (gaps.length) {
				setError(`Rate every category before submitting (${gaps.length} left: ${gaps.map((g) => g.label).join(', ')}).`);
				setStep(questions.indexOf(gaps[0]));
				return;
			}
			const r = await submitCalibrationRound({ score_id: scoreId, return_to: returnTo });
			if (!r.ok) {
				setError(r.error);
				return;
			}
			router.push(`${returnTo}${returnTo.includes('?') ? '&' : '?'}submitted=1`);
			router.refresh();
		});
	};

	const progress = Math.round((Math.min(step, total) / total) * 100);
	const whose = round === 'self' ? 'yourself' : subjectName;

	return (
		<div className="space-y-3">
			{/* progress */}
			<div className="flex items-center gap-3">
				<div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
					<div className="h-full bg-primary-500 transition-all" style={{ width: `${progress}%` }} />
				</div>
				<span className="text-2xs tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
					{isWrapUp ? 'Wrap-up' : `${step + 1} of ${total}`} · {answered}/{total} rated
				</span>
				<span className="text-2xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 w-20 justify-end">
					{saving === 'saving' && <><Loader2 className="w-3 h-3 animate-spin" /> Saving</>}
					{saving === 'saved' && <><Check className="w-3 h-3" /> Saved</>}
					{saving === 'error' && <span className="text-red-600 dark:text-red-400">Not saved</span>}
				</span>
			</div>

			{error && <Callout tone="error">{error}</Callout>}

			<Card padding="none" className="overflow-hidden rounded-lg">
				{/* Teal header band (Jotform-style form head). primary-700, not -600:
				    white on -600 is 3.7:1, under AA for the small subtitle. */}
				<div className="bg-primary-700 text-white px-6 py-5">
					<h2 className="text-lg font-semibold leading-tight">
						{round === 'self' ? 'Self-assessment' : `Review of ${subjectName}`}
					</h2>
					<p className="text-sm mt-0.5">
						{isWrapUp ? 'Wrap-up' : `${step + 1} of ${total}`} · {total} categories, rated 0–5 · saves as you go
					</p>
				</div>
				<div className="p-6 space-y-4">
				{q ? (
					<>
						<div>
							<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">{GROUP_LABELS[q.group_key]}</p>
							<h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{q.label}</h2>
							<p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
								{q.prompt} — thinking about {whose} this quarter, pick the description that fits best.
							</p>
						</div>
						<div role="radiogroup" aria-label={q.label} className="space-y-1.5">
							{q.rubric.map((text, rating) => {
								const selected = drafts[q.id]?.rating === rating;
								return (
									<button
										key={rating}
										type="button"
										role="radio"
										aria-checked={selected}
										onClick={() => setRating(q.id, rating)}
										className={`w-full text-left flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors ${
											selected
												? 'border-primary-500 bg-primary-50 dark:bg-primary-950/40 text-primary-900 dark:text-primary-100'
												: 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-hover'
										}`}
									>
										<span className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold tabular-nums border ${
											selected ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400'
										}`}>
											{rating}
										</span>
										<span className="text-sm leading-snug">{text}</span>
									</button>
								);
							})}
						</div>
						<div>
							<label htmlFor={`notes-${q.id}`} className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Notes (optional)</label>
							<textarea
								id={`notes-${q.id}`}
								rows={2}
								value={drafts[q.id]?.notes ?? ''}
								onChange={(e) => setNotes(q.id, e.target.value)}
								maxLength={4000}
								placeholder="Evidence, examples, context."
								className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
							/>
						</div>
					</>
				) : (
					<>
						<div>
							<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Wrap-up</p>
							<h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-0.5">Almost done</h2>
							<p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
								{answered === total ? 'Every category is rated.' : `${total - answered} ${total - answered === 1 ? 'category is' : 'categories are'} still unrated — go back to finish them.`} The score appears after you submit.
							</p>
						</div>
						<div>
							<label htmlFor="priorities" className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Top 3 priorities for next quarter (optional)</label>
							<textarea
								id="priorities"
								rows={4}
								value={prio}
								onChange={(e) => onPrio(e.target.value)}
								maxLength={4000}
								placeholder={round === 'self' ? 'What you will focus on next quarter.' : `What ${subjectName} should focus on next quarter.`}
								className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
							/>
						</div>
					</>
				)}

				<div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
					<Button type="button" variant="outline" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
						<ChevronLeft className="w-3.5 h-3.5" /> Back
					</Button>
					{isWrapUp ? (
						<Button type="button" size="sm" onClick={submit} loading={pending} disabled={answered < total}>
							<Check className="w-3.5 h-3.5" /> Submit {round === 'exec' ? 'exec score' : round === 'leader' ? 'leader score' : 'self-assessment'}
						</Button>
					) : (
						<Button type="button" size="sm" onClick={() => setStep((s) => Math.min(total, s + 1))}>
							Next <ChevronRight className="w-3.5 h-3.5" />
						</Button>
					)}
				</div>
				</div>
			</Card>
			<div className="flex flex-wrap gap-1 justify-center">
				{questions.map((x, i) => (
					<button
						key={x.id}
						type="button"
						onClick={() => setStep(i)}
						title={x.label}
						aria-label={`Go to ${x.label}`}
						className={`w-2.5 h-2.5 rounded-full border transition-colors ${
							i === step ? 'border-primary-600 bg-primary-600' : drafts[x.id]?.rating != null ? 'border-primary-300 bg-primary-200 dark:border-primary-700 dark:bg-primary-800' : 'border-slate-300 dark:border-slate-600 bg-transparent'
						}`}
					/>
				))}
				<button
					type="button"
					onClick={() => setStep(total)}
					title="Wrap-up"
					aria-label="Go to wrap-up"
					className={`w-2.5 h-2.5 rounded-sm border transition-colors ${isWrapUp ? 'border-primary-600 bg-primary-600' : 'border-slate-300 dark:border-slate-600'}`}
				/>
			</div>
		</div>
	);
}
