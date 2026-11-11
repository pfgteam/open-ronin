'use client';

// Leader review + team rollup for a time study. Server pages pass the
// aggregated numbers; this component only renders and fires the review /
// reopen actions.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { fmtMinutes, type StudyCategory } from '@/lib/timeStudy/shared';
import { reopenTimeStudySubmission, reviewTimeStudySubmission } from './actions';
import { FALLBACK_COLOR } from '@/lib/colors';

export interface PersonRollup {
	userId: string;
	name: string;
	department: string | null;
	minutes: number;
	calendarMinutes: number;
	byCategory: Record<string, number>;
	submittedAt: string | null;
	reviewedAt: string | null;
	reviewNote: string | null;
}

export interface DeptRollup {
	department: string;
	people: number;
	minutes: number;
	byCategory: Record<string, number>;
}

interface Props {
	studyId: string;
	categories: StudyCategory[];
	people: PersonRollup[];
	departments: DeptRollup[];
	canReview: boolean;
	isAdmin: boolean;
}

function Bar({ byCategory, total, categories }: { byCategory: Record<string, number>; total: number; categories: StudyCategory[] }) {
	if (total === 0) return <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 w-full" />;
	return (
		<div className="h-2 rounded-full overflow-hidden flex w-full bg-slate-100 dark:bg-slate-700">
			{categories.map((c) => {
				const v = byCategory[c.slug] ?? 0;
				if (!v) return null;
				return <span key={c.slug} title={`${c.label}: ${fmtMinutes(v)}`} style={{ width: `${(v / total) * 100}%`, backgroundColor: c.color ?? FALLBACK_COLOR }} />;
			})}
		</div>
	);
}

export default function TimeStudyReview({ studyId, categories, people, departments, canReview, isAdmin }: Props) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [notes, setNotes] = useState<Record<string, string>>({});
	const active = categories.filter((c) => c.is_active);

	function review(userId: string) {
		startTransition(async () => {
			const res = await reviewTimeStudySubmission(studyId, userId, notes[userId]?.trim() || null);
			setMsg(res.ok ? { ok: true, text: 'Marked reviewed.' } : { ok: false, text: res.error });
			if (res.ok) router.refresh();
		});
	}
	function reopen(userId: string) {
		if (!confirm('Reopen this submission so the person can edit again?')) return;
		startTransition(async () => {
			const res = await reopenTimeStudySubmission(studyId, userId);
			setMsg(res.ok ? { ok: true, text: 'Reopened.' } : { ok: false, text: res.error });
			if (res.ok) router.refresh();
		});
	}

	const submitted = people.filter((p) => p.submittedAt).length;
	const reviewed = people.filter((p) => p.reviewedAt).length;
	const teamTotal = departments.reduce((a, d) => a + d.minutes, 0);
	const teamByCategory: Record<string, number> = {};
	for (const d of departments) for (const [k, v] of Object.entries(d.byCategory)) teamByCategory[k] = (teamByCategory[k] ?? 0) + v;

	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}

			{/* Team view with department breakdown */}
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Team view</h2>
					<span className="text-xs text-slate-400 tabular-nums">{fmtMinutes(teamTotal)} across {people.length} people</span>
					<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto">{submitted} submitted · {reviewed} reviewed</span>
				</div>
				<div className="px-4 py-3 space-y-2">
					<Bar byCategory={teamByCategory} total={teamTotal} categories={active} />
					<div className="flex flex-wrap gap-x-4 gap-y-1">
						{active.map((c) => {
							const v = teamByCategory[c.slug] ?? 0;
							if (!v) return null;
							return (
								<span key={c.slug} className="text-2xs text-slate-600 dark:text-slate-400 inline-flex items-center gap-1.5">
									<span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color ?? FALLBACK_COLOR }} />
									{c.label} <span className="tabular-nums">{fmtMinutes(v)} · {Math.round((v / teamTotal) * 100)}%</span>
								</span>
							);
						})}
					</div>
				</div>
				<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Department</th>
							<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">People</th>
							<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Time</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-1/2">Mix</th>
						</tr>
					</thead>
					<tbody>
						{departments.map((d) => (
							<tr key={d.department} className="border-t border-slate-200 dark:border-slate-700">
								<td className="px-4 py-1.5 text-slate-700 dark:text-slate-300">{d.department}</td>
								<td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{d.people}</td>
								<td className="px-3 py-1.5 text-right tabular-nums text-slate-900 dark:text-slate-100">{fmtMinutes(d.minutes)}</td>
								<td className="px-3 py-1.5"><Bar byCategory={d.byCategory} total={d.minutes} categories={active} /></td>
							</tr>
						))}
						{departments.length === 0 && (
							<tr><td colSpan={4} className="px-4 py-4 text-sm text-slate-500">No entries yet.</td></tr>
						)}
					</tbody>
				</table>
				</div>
			</Card>

			{/* Per-person review */}
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">People</h2>
				</div>
				<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Person</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Dept</th>
							<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Time</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 w-1/3">Mix</th>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
							{canReview && <th className="w-64" />}
						</tr>
					</thead>
					<tbody>
						{people.map((p) => (
							<tr key={p.userId} className="border-t border-slate-200 dark:border-slate-700 align-top">
								<td className="px-4 py-2 text-slate-900 dark:text-slate-100">
									<Link href={`/social/time-study?study=${studyId}&person=${p.userId}`} className="hover:text-primary-600">{p.name}</Link>
								</td>
								<td className="px-3 py-2 text-slate-500">{p.department ?? '—'}</td>
								<td className="px-3 py-2 text-right tabular-nums">
									{fmtMinutes(p.minutes)}
									{p.calendarMinutes > 0 && <span className="block text-2xs text-slate-600 dark:text-slate-400">{fmtMinutes(p.calendarMinutes)} from calendar</span>}
								</td>
								<td className="px-3 py-2"><Bar byCategory={p.byCategory} total={p.minutes} categories={active} /></td>
								<td className="px-3 py-2">
									{p.reviewedAt ? <Badge color="success">Reviewed</Badge> : p.submittedAt ? <Badge color="primary">Submitted</Badge> : <Badge color="default">In progress</Badge>}
									{p.reviewNote && <span className="block text-2xs text-slate-600 dark:text-slate-400 mt-0.5">“{p.reviewNote}”</span>}
								</td>
								{canReview && (
									<td className="px-3 py-2">
										{p.submittedAt && !p.reviewedAt && (
											<div className="flex items-center gap-2">
												<Input placeholder="Note (optional)" className="text-xs" value={notes[p.userId] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [p.userId]: e.target.value }))} />
												<Button size="sm" type="button" disabled={pending} onClick={() => review(p.userId)}>Mark reviewed</Button>
											</div>
										)}
										{p.submittedAt && isAdmin && (
											<button type="button" disabled={pending} onClick={() => reopen(p.userId)} className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 mt-1">
												Reopen
											</button>
										)}
									</td>
								)}
							</tr>
						))}
						{people.length === 0 && (
							<tr><td colSpan={canReview ? 6 : 5} className="px-4 py-4 text-sm text-slate-500">Nobody has entered anything yet.</td></tr>
						)}
					</tbody>
				</table>
				</div>
			</Card>
		</div>
	);
}
