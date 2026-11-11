'use client';

// The exec round (round 3) as one table instead of one question per screen:
// Self score | Leader score | Exec score. The exec column starts on the
// leader's rating and every row can be changed by hand. Changes autosave as a
// draft; untouched rows are written at submit. No Vantage Point outcome
// question here: the outcome is placed from the exec total.

import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import { GROUPS, GROUP_LABELS, RATINGS, type AnswerRow, type CycleQuestion } from '@/lib/calibration/shared';
import { saveCalibrationAnswer, saveCalibrationWrapUp, submitCalibrationRound } from '@/app/(app)/team/calibration/actions';

interface Props {
	scoreId: string;
	subjectName: string;
	questions: CycleQuestion[];
	/** The exec draft's own answers. */
	answers: AnswerRow[];
	selfAnswers: AnswerRow[];
	leaderAnswers: AnswerRow[];
	priorities: string | null;
	returnTo: string;
}

type Draft = { rating: number | null; notes: string };

const ratingOf = (rows: AnswerRow[], questionId: string) => rows.find((a) => a.cycle_question_id === questionId)?.rating ?? null;

function ReadOnlyScore({ value }: { value: number | null }) {
	return (
		<span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold tabular-nums">
			{value ?? '–'}
		</span>
	);
}

export default function ExecScorecardTable({ scoreId, subjectName, questions, answers, selfAnswers, leaderAnswers, priorities, returnTo }: Props) {
	const router = useRouter();
	// Rows whose current value is already in the database.
	const saved = useRef<Set<string>>(new Set(answers.filter((a) => a.rating != null).map((a) => a.cycle_question_id)));
	const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
		const m: Record<string, Draft> = {};
		for (const q of questions) {
			const own = answers.find((a) => a.cycle_question_id === q.id);
			// Start from the leader's rating; the exec changes what they disagree with.
			m[q.id] = { rating: own?.rating ?? ratingOf(leaderAnswers, q.id), notes: own?.notes ?? '' };
		}
		return m;
	});
	const [prio, setPrio] = useState(priorities ?? '');
	const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

	const persistAnswer = useCallback(
		async (questionId: string, d: Draft) => {
			setSaving('saving');
			const r = await saveCalibrationAnswer({ score_id: scoreId, cycle_question_id: questionId, rating: d.rating, notes: d.notes || null });
			if (r.ok) {
				saved.current.add(questionId);
				setSaving('saved');
				setError(null);
			} else {
				setSaving('error');
				setError(r.error);
			}
			return r;
		},
		[scoreId],
	);

	const setRating = (questionId: string, rating: number) => {
		const d = { ...(drafts[questionId] ?? { rating: null, notes: '' }), rating };
		setDrafts((prev) => ({ ...prev, [questionId]: d }));
		void persistAnswer(questionId, d);
	};

	const setNotes = (questionId: string, notes: string) => {
		const d = { ...(drafts[questionId] ?? { rating: null, notes: '' }), notes };
		setDrafts((prev) => ({ ...prev, [questionId]: d }));
		clearTimeout(timers.current[questionId]);
		timers.current[questionId] = setTimeout(() => void persistAnswer(questionId, d), 600);
	};

	const onPrio = (v: string) => {
		setPrio(v);
		clearTimeout(timers.current.__prio);
		timers.current.__prio = setTimeout(() => {
			setSaving('saving');
			void saveCalibrationWrapUp({ score_id: scoreId, priorities_md: v || null }).then((r) => {
				setSaving(r.ok ? 'saved' : 'error');
				setError(r.ok ? null : r.error);
			});
		}, 600);
	};

	useEffect(() => {
		const t = timers.current;
		return () => {
			for (const k of Object.keys(t)) clearTimeout(t[k]);
		};
	}, []);

	const unrated = questions.filter((q) => drafts[q.id]?.rating == null);

	const submit = () => {
		setError(null);
		startTransition(async () => {
			if (unrated.length) {
				setError(`Give every category an exec score before submitting (${unrated.length} left: ${unrated.map((g) => g.label).join(', ')}).`);
				return;
			}
			// Write everything still pending: rows left on the leader's rating, and
			// any notes or priorities still inside their debounce window.
			const pendingNotes = new Set(Object.keys(timers.current).filter((k) => k !== '__prio'));
			for (const k of Object.keys(timers.current)) clearTimeout(timers.current[k]);
			timers.current = {};
			const toWrite = questions.filter((q) => !saved.current.has(q.id) || pendingNotes.has(q.id));
			const results = await Promise.all(toWrite.map((q) => persistAnswer(q.id, drafts[q.id])));
			const failed = results.find((r) => !r.ok);
			if (failed && !failed.ok) {
				setError(failed.error);
				return;
			}
			const w = await saveCalibrationWrapUp({ score_id: scoreId, priorities_md: prio || null });
			if (!w.ok) {
				setError(w.error);
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

	const th = 'px-3 py-2 text-2xs uppercase tracking-wide font-medium text-slate-600 dark:text-slate-400';

	return (
		<div className="space-y-3">
			{error && <Callout tone="error">{error}</Callout>}
			<Card padding="none" className="overflow-hidden rounded-lg">
				<div className="bg-primary-700 text-white px-6 py-5 flex items-start justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold leading-tight">Review of {subjectName}</h2>
						<p className="text-sm mt-0.5">
							{questions.length} categories, rated 0–5 · the exec score starts on the leader&apos;s rating, change any row · saves as you go
						</p>
					</div>
					<span className="text-2xs inline-flex items-center gap-1 whitespace-nowrap mt-1">
						{saving === 'saving' && <><Loader2 className="w-3 h-3 animate-spin" /> Saving</>}
						{saving === 'saved' && <><Check className="w-3 h-3" /> Saved</>}
						{saving === 'error' && 'Not saved'}
					</span>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-200 dark:border-slate-700 text-left">
								<th scope="col" className={th}>Category</th>
								<th scope="col" className={`${th} text-center`}>Self score</th>
								<th scope="col" className={`${th} text-center`}>Leader score</th>
								<th scope="col" className={th}>Exec score</th>
							</tr>
						</thead>
						<tbody>
							{GROUPS.map((g) => {
								const rows = questions.filter((q) => q.group_key === g);
								if (rows.length === 0) return null;
								return (
									<Fragment key={g}>
										<tr className="bg-slate-50 dark:bg-slate-800/60">
											<th scope="colgroup" colSpan={4} className="px-3 py-1.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-300">
												{GROUP_LABELS[g]}
											</th>
										</tr>
										{rows.map((q) => {
											const d = drafts[q.id];
											return (
												<tr key={q.id} className="border-b border-slate-200 dark:border-slate-700 align-top">
													<th scope="row" className="px-3 py-3 text-left font-medium text-slate-900 dark:text-slate-100 min-w-[10rem]">
														{q.label}
													</th>
													<td className="px-3 py-3 text-center"><ReadOnlyScore value={ratingOf(selfAnswers, q.id)} /></td>
													<td className="px-3 py-3 text-center"><ReadOnlyScore value={ratingOf(leaderAnswers, q.id)} /></td>
													<td className="px-3 py-3 min-w-[16rem]">
														<div role="radiogroup" aria-label={`Exec score for ${q.label}`} className="flex gap-1">
															{RATINGS.map((rating) => {
																const selected = d?.rating === rating;
																return (
																	<button
																		key={rating}
																		type="button"
																		role="radio"
																		aria-checked={selected}
																		title={q.rubric[rating]}
																		onClick={() => setRating(q.id, rating)}
																		className={`w-8 h-8 rounded-full border text-sm font-semibold tabular-nums transition-colors ${
																			selected
																				? 'bg-primary-600 border-primary-600 text-white'
																				: 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-hover'
																		}`}
																	>
																		{rating}
																	</button>
																);
															})}
														</div>
														{d?.rating != null && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-snug">{q.rubric[d.rating]}</p>}
														<input
															type="text"
															value={d?.notes ?? ''}
															onChange={(e) => setNotes(q.id, e.target.value)}
															maxLength={4000}
															aria-label={`Notes for ${q.label}`}
															placeholder="Notes (optional)"
															className="mt-1.5 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
														/>
													</td>
												</tr>
											);
										})}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
				<div className="p-6 space-y-4">
					<div>
						<label htmlFor="exec-priorities" className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Top 3 priorities for next quarter (optional)</label>
						<textarea
							id="exec-priorities"
							rows={4}
							value={prio}
							onChange={(e) => onPrio(e.target.value)}
							maxLength={4000}
							placeholder={`What ${subjectName} should focus on next quarter.`}
							className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
						/>
					</div>
					<div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
						<p className="text-xs text-slate-600 dark:text-slate-400">The score appears after you submit.</p>
						<Button type="button" size="sm" onClick={submit} loading={pending} disabled={unrated.length > 0}>
							<Check className="w-3.5 h-3.5" /> Submit exec score
						</Button>
					</div>
				</div>
			</Card>
		</div>
	);
}
