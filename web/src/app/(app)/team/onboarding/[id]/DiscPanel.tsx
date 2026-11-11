'use client';

// DISC on a person: the result on file (bars + style + "How I Work Best"),
// the in-app questionnaire (self or an onboarding-circle member running it
// with them), and manual entry when results already exist (decision 2).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import DiscQuestionnaire from '@/components/hiring/DiscQuestionnaire';
import type { DiscResponseRow } from '@/lib/hiring/server';
import { DISC_TRAITS, DISC_TRAIT_LABELS, HOW_I_WORK_PROMPTS, styleToScores, type DiscAnswer, type DiscQuestion } from '@/lib/hiring/onboarding';
import { formatDate } from '@/lib/format';
import { enterDiscManually, submitDiscQuestionnaire } from '../actions';

export default function DiscPanel({ profileId, name, currentStyle, response, questions, canEnter, isSelf }: { profileId: string; name: string; currentStyle: string | null; response: DiscResponseRow | null; questions: DiscQuestion[]; canEnter: boolean; isSelf: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [mode, setMode] = useState<'view' | 'quiz' | 'manual'>('view');
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [manualStyle, setManualStyle] = useState(currentStyle ?? '');
	const [provider, setProvider] = useState('');
	const [summary, setSummary] = useState(response?.summary_md ?? '');
	const scores = response?.scores && Object.keys(response.scores).length ? response.scores : currentStyle ? styleToScores(currentStyle) : null;
	const style = response?.style ?? currentStyle;

	const submitQuiz = (answers: DiscAnswer[]) =>
		start(async () => {
			setMsg(null);
			const r = await submitDiscQuestionnaire({ profile_id: profileId, answers, summary_md: summary || null });
			if (!r.ok) setMsg({ ok: false, text: r.error });
			else {
				setMsg({ ok: true, text: `Saved: ${r.style}` });
				setMode('view');
				router.refresh();
			}
		});

	return (
		<Card padding="none">
			<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">DISC</h2>
				{style && <Badge color="primary" className="font-mono">{style}</Badge>}
				{response && <span className="text-2xs text-slate-500">{response.source === 'in_app' ? 'in-app questionnaire' : response.source === 'provider' ? response.provider ?? 'provider' : 'entered by hand'} · {formatDate(response.completed_at)}</span>}
			</div>
			<div className="px-3 py-3 space-y-3">
				{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
				{mode === 'view' && (
					<>
						{scores ? (
							<div className="space-y-1.5">
								{DISC_TRAITS.map((t) => (
									<div key={t} className="flex items-center gap-2 text-xs">
										<span className="w-4 font-mono font-semibold text-slate-700 dark:text-slate-300">{t}</span>
										<div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
											<div className="h-full bg-primary-600 rounded-full" style={{ width: `${Math.min(100, Math.max(0, scores[t] ?? 0))}%` }} />
										</div>
										<span className="w-10 text-right tabular-nums text-slate-600 dark:text-slate-400">{Math.round(scores[t] ?? 0)}%</span>
									</div>
								))}
								{style && /^[DISCdisc]+$/.test(style) && (
									<p className="text-2xs text-slate-600 dark:text-slate-400 pt-1">
										<strong>{DISC_TRAIT_LABELS[style[0].toUpperCase() as 'D' | 'I' | 'S' | 'C'].name}</strong> primary. {DISC_TRAIT_LABELS[style[0].toUpperCase() as 'D' | 'I' | 'S' | 'C'].blurb}
									</p>
								)}
							</div>
						) : (
							<p className="text-sm text-slate-500">{isSelf ? 'No DISC on file yet. The framework places it between days 45 and 60, once you have real relational context.' : `${name} has no DISC on file.`}</p>
						)}
						{response?.summary_md && (
							<div>
								<div className="text-2xs uppercase tracking-wide text-slate-500 mb-0.5">How I work best</div>
								<p className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300">{response.summary_md}</p>
							</div>
						)}
						{canEnter && (
							<div className="flex flex-wrap gap-2 pt-1">
								<Button size="sm" variant={style ? 'outline' : 'primary'} onClick={() => setMode('quiz')}>{isSelf ? 'Take the questionnaire' : 'Run the questionnaire'}</Button>
								<Button size="sm" variant="ghost" onClick={() => setMode('manual')}>Enter existing results</Button>
							</div>
						)}
					</>
				)}
				{mode === 'quiz' && (
					<div className="space-y-3">
						<DiscQuestionnaire questions={questions} onSubmit={submitQuiz} busy={pending} submitLabel="Submit my answers" />
						<Textarea label='"How I Work Best" (optional now; you can add it after seeing your result)' value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder={HOW_I_WORK_PROMPTS.join(' · ')} />
						<Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
					</div>
				)}
				{mode === 'manual' && (
					<div className="space-y-2">
						<Input label="Style (e.g. Si, CD, Ds/CD)" value={manualStyle} onChange={(e) => setManualStyle(e.target.value)} />
						<Input label="Source / provider (optional: Truity, Crystal, TTI, PDF on file…)" value={provider} onChange={(e) => setProvider(e.target.value)} />
						<Textarea label='"How I Work Best" summary (optional)' value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder={HOW_I_WORK_PROMPTS.join(' · ')} />
						<div className="flex gap-2">
							<Button size="sm" loading={pending} disabled={!manualStyle.trim()} onClick={() => start(async () => {
								setMsg(null);
								const r = await enterDiscManually({ profile_id: profileId, style: manualStyle, provider: provider || null, summary_md: summary || null });
								if (!r.ok) setMsg({ ok: false, text: r.error });
								else {
									setMsg({ ok: true, text: 'Saved.' });
									setMode('view');
									router.refresh();
								}
							})}>Save</Button>
							<Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
						</div>
					</div>
				)}
			</div>
		</Card>
	);
}
