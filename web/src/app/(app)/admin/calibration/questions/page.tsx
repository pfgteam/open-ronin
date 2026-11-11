// /admin/calibration/questions — the master scorecard (0118): categories,
// group, weight, prompt and the six rubric descriptions. Weights are visible
// here only. Edits apply to the NEXT cycle opened; an open cycle that nobody
// has started can be re-synced from here.

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadCycles } from '@/lib/calibration/server';
import { GROUP_LABELS, GROUPS, type GroupKey } from '@/lib/calibration/shared';
import { quarterLabel } from '@/lib/work/timeframe';
import { inputClass, selectClass } from '../../../team/_form';
import { resyncCalibrationCycle, saveCalibrationQuestion } from '../actions';

export const metadata = { title: 'Calibration questions · Admin' };
export const dynamic = 'force-dynamic';

interface QuestionRow {
	id: string;
	key: string;
	group_key: GroupKey;
	label: string;
	prompt: string;
	weight: number | string;
	position: number;
	rubric: string[];
	is_active: boolean;
}

function QuestionForm({ q, open }: { q: QuestionRow | null; open?: boolean }) {
	return (
		<details open={open} className="group rounded-md border border-slate-200 dark:border-slate-700">
			<summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-3 text-sm">
				{q ? (
					<>
						<span className="tabular-nums text-slate-400 w-5">{q.position}</span>
						<span className="font-medium text-slate-900 dark:text-slate-100 flex-1">{q.label}</span>
						<Badge color="default">{GROUP_LABELS[q.group_key]}</Badge>
						<span className="tabular-nums text-slate-700 dark:text-slate-300 w-10 text-right">{Number(q.weight)} pts</span>
						{!q.is_active && <Badge color="warning">inactive</Badge>}
					</>
				) : (
					<span className="font-medium text-primary-600 dark:text-primary-400">+ Add a category</span>
				)}
			</summary>
			<form action={saveCalibrationQuestion} className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
				{q && <input type="hidden" name="id" value={q.id} />}
				<label className="flex flex-col gap-1">
					<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Label</span>
					<input name="label" defaultValue={q?.label ?? ''} className={inputClass} required maxLength={120} />
				</label>
				<label className="flex flex-col gap-1">
					<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Prompt (shown on the question screen)</span>
					<input name="prompt" defaultValue={q?.prompt ?? ''} className={inputClass} required maxLength={300} />
				</label>
				<label className="flex flex-col gap-1">
					<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Group</span>
					<select name="group_key" defaultValue={q?.group_key ?? 'core'} className={selectClass}>
						{GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
					</select>
				</label>
				<div className="grid grid-cols-3 gap-3">
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Weight (pts)</span>
						<input name="weight" type="number" step="0.5" min={0} max={100} defaultValue={q ? Number(q.weight) : 5} className={inputClass} required />
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Order</span>
						<input name="position" type="number" min={0} max={999} defaultValue={q?.position ?? 99} className={inputClass} required />
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Key</span>
						<input name="key" defaultValue={q?.key ?? ''} className={inputClass} required pattern="[a-z0-9_]{2,40}" title="lowercase letters, digits, underscores" readOnly={!!q} />
					</label>
				</div>
				<div className="sm:col-span-2">
					<p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Rubric — what each rating looks like</p>
					<div className="space-y-1.5">
						{[0, 1, 2, 3, 4, 5].map((i) => (
							<label key={i} className="flex items-start gap-2">
								<span className="mt-2 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-2xs font-semibold text-slate-700 dark:text-slate-200">{i}</span>
								<textarea name={`rubric_${i}`} rows={1} defaultValue={q?.rubric[i] ?? ''} className={inputClass} required maxLength={600} />
							</label>
						))}
					</div>
				</div>
				<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
					<input type="checkbox" name="is_active" defaultChecked={q ? q.is_active : true} className="rounded-sm border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500" />
					Active (copied into the next cycle)
				</label>
				<div className="flex justify-end">
					<Button type="submit" size="sm">{q ? 'Save' : 'Add category'}</Button>
				</div>
			</form>
		</details>
	);
}

export default async function CalibrationQuestionsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; synced?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (profile.role !== 'admin' && profile.role !== 'exec') {
		return (
			<Card>
				<div className="text-center py-12 text-slate-500">
					<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
					<p className="text-sm">Calibration questions are managed by admin accounts.</p>
				</div>
			</Card>
		);
	}
	const supabase = await createClient();
	const [{ data: rows, error }, { cycles, quarters }] = await Promise.all([
		supabase.from('calibration_questions').select('id, key, group_key, label, prompt, weight, position, rubric, is_active').order('position'),
		loadCycles(supabase),
	]);
	const questions = ((rows ?? []) as unknown as QuestionRow[]).map((q) => ({ ...q, rubric: Array.isArray(q.rubric) ? q.rubric.map(String) : [] }));
	const active = questions.filter((q) => q.is_active);
	const groupSum = (g: GroupKey) => active.filter((q) => q.group_key === g).reduce((a, q) => a + Number(q.weight), 0);
	const total = GROUPS.reduce((a, g) => a + groupSum(g), 0);
	const open = cycles.find((c) => c.status === 'open') ?? null;
	const openQuarter = open ? quarters.find((q) => q.id === open.quarter_id) : null;
	const { count: openScores } = open
		? await supabase.from('calibration_scores').select('id', { count: 'exact', head: true }).eq('cycle_id', open.id)
		: { count: 0 };

	return (
		<>
			<PageHeader
				title="Calibration questions"
				description="Categories, groups, weights and the 0–5 rubric. Weights are visible only here."
				actions={<Link href="/admin/calibration" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">← Calibration</Link>}
			/>
			<div className="space-y-4 max-w-4xl">
				{sp.error && <Callout tone="error">{sp.error}</Callout>}
				{sp.saved && !sp.error && <Callout tone="success">Saved. Applies to the next cycle you open{open ? ' (or re-sync the open one below while nobody has started)' : ''}.</Callout>}
				{sp.synced && !sp.error && <Callout tone="success">Re-synced {sp.synced} questions into the open cycle.</Callout>}
				{error && <Callout tone="warning">The questions table needs migration <code>0118_calibration_scorecard.sql</code>, written but not applied.</Callout>}

				<Card>
					<div className="flex items-end gap-6 flex-wrap">
						<div>
							<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">Total</p>
							<p className={`text-2xl font-semibold tabular-nums ${total === 100 ? 'text-slate-900 dark:text-slate-100' : 'text-amber-600 dark:text-amber-400'}`}>{total}<span className="text-sm font-normal text-slate-500"> / 100</span></p>
						</div>
						{GROUPS.map((g) => (
							<div key={g}>
								<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium">{GROUP_LABELS[g]}</p>
								<p className="text-lg tabular-nums text-slate-800 dark:text-slate-200">{groupSum(g)}<span className="text-2xs text-slate-500"> pts · {active.filter((q) => q.group_key === g).length} categories</span></p>
							</div>
						))}
						{total !== 100 && <span className="text-xs text-amber-700 dark:text-amber-400">Weights should add up to 100.</span>}
					</div>
					{open && openQuarter && (
						<div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-wrap text-xs text-slate-600 dark:text-slate-400">
							<span>{quarterLabel(openQuarter)} is open and scores against its own snapshot of these questions.</span>
							{(openScores ?? 0) === 0 ? (
								<form action={resyncCalibrationCycle} className="ml-auto">
									<input type="hidden" name="cycle_id" value={open.id} />
									<Button type="submit" variant="outline" size="sm">Re-sync the open cycle</Button>
								</form>
							) : (
								<span className="ml-auto">Frozen: {openScores} {openScores === 1 ? 'person has' : 'people have'} started. Edits apply to the next cycle.</span>
							)}
						</div>
					)}
				</Card>

				{GROUPS.map((g) => (
					<div key={g} className="space-y-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{GROUP_LABELS[g]} · {groupSum(g)} pts</h2>
						{questions.filter((q) => q.group_key === g).map((q) => <QuestionForm key={q.id} q={q} />)}
					</div>
				))}
				<QuestionForm q={null} />
			</div>
		</>
	);
}
