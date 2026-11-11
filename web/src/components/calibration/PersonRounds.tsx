// One person's three rounds for the open cycle, as seen by `viewer` (0118).
// Shared by Self -> Calibration (subject = viewer) and Team -> Calibration ->
// person (subject = a report / anyone, for exec). Server component.
//
// Rules it renders:
//   - the round whose turn it is shows the form to the right scorer, a
//     "waiting on X" card to everyone else;
//   - a submitted round shows totals (no weights) to everyone;
//   - a round not yet reached shows a locked card;
//   - a draft is visible only to its scorer (RLS hides it from others).

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Lock } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import ExecScorecardTable from './ExecScorecardTable';
import ScorecardForm from './ScorecardForm';
import SubmittedRound from './SubmittedRound';
import { startCalibrationRound } from '@/app/(app)/team/calibration/actions';
import { loadAnswers, loadCycleQuestions, loadScores, type Cycle } from '@/lib/calibration/server';
import { ROUNDS, ROUND_LABELS, nextRound, type Round, type ScoreRow } from '@/lib/calibration/shared';

interface Person { id: string; first_name: string | null; last_name: string | null; manager_id: string | null }

const nameOf = (p: Pick<Person, 'first_name' | 'last_name'> | null | undefined) =>
	p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed' : 'Unknown';

export default async function PersonRounds({
	supabase,
	cycle,
	subject,
	viewerId,
	viewerIsExec,
	viewerIsAdmin,
	returnTo,
}: {
	supabase: SupabaseClient;
	cycle: Cycle;
	subject: Person;
	viewerId: string;
	viewerIsExec: boolean;
	viewerIsAdmin: boolean;
	returnTo: string;
}) {
	const [{ scores, scorecardAvailable }, { questions }] = await Promise.all([
		loadScores(supabase, { cycleId: cycle.id, subjectId: subject.id }),
		loadCycleQuestions(supabase, cycle.id),
	]);
	const byRound = (r: Round) => scores.find((s) => s.round === r) ?? null;
	const answers = await loadAnswers(supabase, scores.map((s) => s.id));
	const scorerIds = [...new Set(scores.map((s) => s.scorer_id).concat(subject.manager_id ? [subject.manager_id] : []))];
	const { data: scorers } = scorerIds.length
		? await supabase.from('profiles').select('id, first_name, last_name').in('id', scorerIds)
		: { data: [] as Person[] };
	const who = (id: string | null | undefined) => (id ? nameOf((scorers ?? []).find((s) => s.id === id) as Person | undefined) : null);
	const leaderName = subject.manager_id ? who(subject.manager_id) : null;
	const isSelf = subject.id === viewerId;
	const isLeader = subject.manager_id === viewerId || viewerIsAdmin;
	const cycleOpen = cycle.status === 'open';
	const nxt = nextRound(scores);

	if (!scorecardAvailable) {
		return (
			<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
				<p className="text-sm text-amber-800 dark:text-amber-300">
					The scorecard needs migration <code>0118_calibration_scorecard.sql</code>, which is written but not applied yet.
				</p>
			</Card>
		);
	}
	if (questions.length === 0) {
		return (
			<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
				<p className="text-sm text-amber-800 dark:text-amber-300">
					This cycle has no questions yet. An admin syncs them from Admin → Calibration → Questions.
				</p>
			</Card>
		);
	}

	const canWrite: Record<Round, boolean> = {
		self: isSelf && cycleOpen,
		leader: isLeader && !isSelf && cycleOpen,
		exec: viewerIsExec && cycleOpen,
	};
	const waitingOn: Record<Round, string> = {
		self: isSelf ? 'you' : nameOf(subject),
		leader: leaderName ?? 'their leader (manager not set)',
		exec: viewerIsExec ? 'you' : 'Alex + Toni',
	};

	return (
		<div className="space-y-4">
			{ROUNDS.map((r) => {
				const row = byRound(r);
				const reached = nxt === r || !!row?.submitted_at;
				if (row?.submitted_at) {
					return (
						<SubmittedRound
							key={r}
							score={row}
							questions={questions}
							answers={answers.filter((a) => a.score_id === row.id)}
							scorerName={who(row.scorer_id)}
							title={ROUND_LABELS[r]}
						/>
					);
				}
				if (!reached) {
					return (
						<Card key={r} className="flex items-center justify-between gap-2">
							<h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{ROUND_LABELS[r]}</h3>
							<Badge color="default"><Lock className="w-3 h-3 inline mr-1" />Opens after the {r === 'leader' ? 'self' : 'leader'} round is submitted</Badge>
						</Card>
					);
				}
				// it is this round's turn
				if (!canWrite[r]) {
					return (
						<Card key={r} className="flex items-center justify-between gap-2 flex-wrap">
							<h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{ROUND_LABELS[r]}</h3>
							<Badge color="warning">{cycleOpen ? `Waiting on ${waitingOn[r]}` : 'Cycle closed'}</Badge>
						</Card>
					);
				}
				if (!row) {
					return (
						<Card key={r} className="space-y-2">
							<div className="flex items-center justify-between gap-2 flex-wrap">
								<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ROUND_LABELS[r]}</h3>
								<Badge color="warning">Your turn</Badge>
							</div>
							<p className="text-sm text-slate-600 dark:text-slate-400">
								{questions.length} categories, one per screen, each rated 0–5 against a written rubric. Your progress saves as you go; the score shows once you submit.
							</p>
							<form action={startCalibrationRound}>
								<input type="hidden" name="cycle_id" value={cycle.id} />
								<input type="hidden" name="subject_id" value={subject.id} />
								<input type="hidden" name="round" value={r} />
								<input type="hidden" name="return_to" value={returnTo} />
								<Button type="submit" size="sm">Start {r === 'self' ? 'my self-assessment' : `the ${r} round`}</Button>
							</form>
						</Card>
					);
				}
				return (
					<div key={r} className="space-y-2">
						<div className="flex items-center justify-between gap-2 flex-wrap">
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ROUND_LABELS[r]}</h3>
							<Badge color="warning">Draft · your turn</Badge>
						</div>
						{r === 'exec' ? (
							<ExecScorecardTable
								scoreId={row.id}
								subjectName={nameOf(subject)}
								questions={questions}
								answers={answers.filter((a) => a.score_id === row.id)}
								selfAnswers={answers.filter((a) => a.score_id === byRound('self')?.id)}
								leaderAnswers={answers.filter((a) => a.score_id === byRound('leader')?.id)}
								priorities={row.priorities_md}
								returnTo={returnTo}
							/>
						) : (
							<ScorecardForm
								scoreId={row.id}
								round={r}
								subjectName={nameOf(subject)}
								questions={questions}
								answers={answers.filter((a) => a.score_id === row.id)}
								priorities={row.priorities_md}
								returnTo={returnTo}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

export type { ScoreRow };
