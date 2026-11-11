'use client';

// Pipeline controls on the application page (0132): stage mover, schedule /
// edit interviews, scorecards (my card + AI prefill + others' submitted
// cards), draft + review messages, portal link.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Markdown from 'react-markdown';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { InterviewRow, MessageRow, MessageTemplateRow, ScorecardRow, StaffOption } from '@/lib/hiring/server';
import { INTERVIEW_KINDS, INTERVIEW_KIND_LABELS, INTERVIEW_STATUS_COLORS, LOCATION_KINDS, LOCATION_KIND_LABELS, SCALE, evaluateScorecard, scorecardStats, type InterviewConfig, type InterviewKind, type ScorecardAnswers, type ScorecardQuestion, type ScorecardRules } from '@/lib/hiring/pipeline';
import { formatDate, formatRelative } from '@/lib/format';
import { draftCandidateMessage, draftQuestions, issuePortalLink, moveStage, prefillFromTranscript, reviewMessage, saveInterview, saveScorecard, setInterviewStatus } from '../../../../actions';

type Msg = { ok: boolean; text: string } | null;

export function StageMover({ id, positionId, current, stages }: { id: string; positionId: string; current: string | null; stages: InterviewConfig }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<Msg>(null);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-1.5">
				{stages.stages.map((s, i) => {
					const idx = stages.stages.findIndex((x) => x.key === current);
					const state = s.key === current ? 'current' : idx >= 0 && i < idx ? 'done' : 'todo';
					return (
						<button
							key={s.key}
							type="button"
							disabled={pending || s.key === current}
							onClick={() =>
								start(async () => {
									setMsg(null);
									const r = await moveStage({ id, position_id: positionId, stage_key: s.key });
									setMsg(r.ok ? { ok: true, text: `Moved to ${s.label}.` } : { ok: false, text: r.error });
									router.refresh();
								})
							}
							className={`px-2.5 py-1 rounded-md text-xs border ${state === 'current' ? 'border-primary-600 bg-primary-700 text-white' : state === 'done' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/45'}`}
						>
							{s.label}
						</button>
					);
				})}
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
		</div>
	);
}

export function InterviewForm({ applicationId, positionId, stages, people, interview, defaultStage, onDone }: { applicationId: string; positionId: string; stages: InterviewConfig; people: StaffOption[]; interview: InterviewRow | null; defaultStage: string | null; onDone?: () => void }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<Msg>(null);
	const stage = stages.stages.find((s) => s.key === (interview?.stage_key ?? defaultStage));
	const [picked, setPicked] = useState<Set<string>>(new Set(interview?.interviewer_ids ?? stage?.interviewer_ids ?? []));
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			fd.set('interviewer_ids', [...picked].join(','));
			const r = await saveInterview(fd);
			setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
			if (r.ok) onDone?.();
			router.refresh();
		});
	const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
	return (
		<form action={submit} className="grid sm:grid-cols-3 gap-3">
			{interview && <input type="hidden" name="id" value={interview.id} />}
			<input type="hidden" name="application_id" value={applicationId} />
			<input type="hidden" name="position_id" value={positionId} />
			{msg && <div className="sm:col-span-3"><Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout></div>}
			<Select name="stage_key" label="Stage" defaultValue={interview?.stage_key ?? defaultStage ?? ''}>
				{stages.stages.filter((s) => s.interview_kind).map((s) => (
					<option key={s.key} value={s.key}>
						{s.label}
					</option>
				))}
			</Select>
			<Select name="kind" label="Interview kind" defaultValue={interview?.kind ?? stage?.interview_kind ?? 'culture_fit'}>
				{INTERVIEW_KINDS.map((k) => (
					<option key={k} value={k}>
						{INTERVIEW_KIND_LABELS[k]}
					</option>
				))}
			</Select>
			<Input name="scheduled_at" label="When (your local time)" type="datetime-local" defaultValue={local(interview?.scheduled_at ?? null)} />
			<Input name="duration_min" label="Minutes" type="number" min={5} max={480} defaultValue={interview?.duration_min ?? stage?.default_minutes ?? 30} />
			<Select name="location_kind" label="Where" defaultValue={interview?.location_kind ?? stage?.location_kind ?? 'zoom'}>
				{LOCATION_KINDS.map((k) => (
					<option key={k} value={k}>
						{LOCATION_KIND_LABELS[k]}
					</option>
				))}
			</Select>
			<Input name="location_text" label="Meeting link or address" defaultValue={interview?.location_text ?? ''} placeholder="https://zoom.us/j/… or 123 Main St" />
			<Input name="booking_url" label="Booking link (Calendly / GHL) to send the candidate" defaultValue={interview?.booking_url ?? stage?.booking_url ?? ''} className="sm:col-span-2" />
			<Input name="timezone" label="Timezone shown to the candidate" defaultValue={interview?.timezone ?? 'America/Chicago'} />
			<div className="sm:col-span-3">
				<div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Interviewers</div>
				<div className="flex flex-wrap gap-1.5">
					{people.map((p) => (
						<label key={p.id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${picked.has(p.id) ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/30 text-primary-800 dark:text-primary-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
							<Checkbox checked={picked.has(p.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(p.id); else n.delete(p.id); setPicked(n); }} /> {p.name}
						</label>
					))}
				</div>
			</div>
			{interview && <Textarea name="transcript_md" label="Transcript (paste from Zoom / Gemini, or link a Sessions call)" rows={4} defaultValue={interview.transcript_md ?? ''} className="sm:col-span-2 font-mono text-xs" />}
			{interview && <Input name="recording_url" label="Recording URL" defaultValue={interview.recording_url ?? ''} />}
			<Textarea name="notes_md" label="Notes" rows={2} defaultValue={interview?.notes_md ?? ''} className="sm:col-span-3" />
			<div className="sm:col-span-3 flex gap-2">
				<Button type="submit" size="sm" loading={pending}>
					{interview ? 'Save interview' : 'Schedule interview'}
				</Button>
			</div>
		</form>
	);
}

export function InterviewCard({ interview, applicationId, positionId, stages, people, questions, rules, cards, meId, canReview }: { interview: InterviewRow; applicationId: string; positionId: string; stages: InterviewConfig; people: StaffOption[]; questions: ScorecardQuestion[]; rules: ScorecardRules; cards: ScorecardRow[]; meId: string; canReview: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<Msg>(null);
	const [edit, setEdit] = useState(false);
	const [showCard, setShowCard] = useState(false);
	const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—';
	const mine = cards.find((c) => c.scorer_id === meId);
	const ai = cards.find((c) => c.is_ai);
	const others = cards.filter((c) => !c.is_ai && c.scorer_id !== meId && c.submitted_at);
	const qs = questions.filter((q) => q.interview_kind === interview.kind);
	const amInterviewer = interview.interviewer_ids.includes(meId);
	const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
		start(async () => {
			setMsg(null);
			const r = await fn();
			setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error: string }).error });
			router.refresh();
		});
	return (
		<Card className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{INTERVIEW_KIND_LABELS[interview.kind]}</h3>
				<Badge color={INTERVIEW_STATUS_COLORS[interview.status]}>{interview.status.replace('_', ' ')}</Badge>
				<span className="text-xs text-slate-500">
					{interview.scheduled_at ? `${formatDate(interview.scheduled_at, 'EEE MMM d, h:mm a')} · ${interview.duration_min} min` : 'not scheduled'} · {LOCATION_KIND_LABELS[interview.location_kind]}
					{interview.interviewer_ids.length ? ` · ${interview.interviewer_ids.map(name).join(', ')}` : ' · no interviewers yet'}
				</span>
				{canReview && (
					<span className="ml-auto flex flex-wrap gap-1">
						<Button size="sm" variant="ghost" onClick={() => setEdit(!edit)}>
							{edit ? 'Close' : 'Edit'}
						</Button>
						{(interview.status === 'scheduled' || interview.status === 'proposed') && (
							<>
								<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => setInterviewStatus({ id: interview.id, application_id: applicationId, position_id: positionId, status: 'completed' }), 'Marked completed.')}>
									Completed
								</Button>
								<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => setInterviewStatus({ id: interview.id, application_id: applicationId, position_id: positionId, status: 'no_show' }), 'Marked no-show.')}>
									No-show
								</Button>
								<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => setInterviewStatus({ id: interview.id, application_id: applicationId, position_id: positionId, status: 'cancelled' }), 'Cancelled.')}>
									Cancel
								</Button>
							</>
						)}
					</span>
				)}
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
			{edit && <InterviewForm applicationId={applicationId} positionId={positionId} stages={stages} people={people} interview={interview} defaultStage={interview.stage_key} onDone={() => setEdit(false)} />}
			{interview.location_text && (
				<a href={interview.location_text} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline break-all">
					{interview.location_text}
				</a>
			)}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" loading={pending} onClick={() => act(() => draftQuestions({ interview_id: interview.id, application_id: applicationId, position_id: positionId }), 'Questions drafted.')}>
					{interview.ai_questions_md ? 'Redraft questions' : 'AI: tailored questions'}
				</Button>
				<Button size="sm" variant="outline" loading={pending} onClick={() => act(() => prefillFromTranscript({ interview_id: interview.id, application_id: applicationId, position_id: positionId }), 'Summary + scorecard prefill ready — confirm every score.')} disabled={!interview.transcript_md && !interview.session_call_id} title={interview.transcript_md ? '' : 'Paste a transcript first (Edit)'}>
					AI: summarize + prefill scorecard
				</Button>
				{(amInterviewer || canReview) && (
					<Button size="sm" onClick={() => setShowCard(!showCard)}>
						{mine?.submitted_at ? 'My scorecard (submitted)' : mine ? 'Continue my scorecard' : 'Fill my scorecard'}
					</Button>
				)}
			</div>
			{interview.ai_questions_md && (
				<details className="text-sm">
					<summary className="cursor-pointer text-slate-600 dark:text-slate-400">Interview brief + tailored questions</summary>
					<div className="prose prose-sm prose-slate dark:prose-invert max-w-none mt-2">
						<Markdown>{interview.ai_questions_md}</Markdown>
					</div>
				</details>
			)}
			{interview.ai_summary_md && (
				<details className="text-sm">
					<summary className="cursor-pointer text-slate-600 dark:text-slate-400">AI summary of the recording</summary>
					<div className="prose prose-sm prose-slate dark:prose-invert max-w-none mt-2">
						<Markdown>{interview.ai_summary_md}</Markdown>
					</div>
				</details>
			)}
			{showCard && <ScorecardForm interview={interview} applicationId={applicationId} positionId={positionId} questions={qs} rules={rules} mine={mine ?? null} ai={ai ?? null} onDone={() => setShowCard(false)} />}
			{(others.length > 0 || (mine?.submitted_at && !showCard) || ai) && (
				<div className="space-y-1.5 border-t border-slate-200 dark:border-slate-700 pt-2">
					{[...(mine?.submitted_at && !showCard ? [mine] : []), ...others, ...(ai ? [ai] : [])].map((c) => {
						const ev = evaluateScorecard(interview.kind, c.answers, rules);
						return (
							<div key={c.id} className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-2">
								<span className="font-medium text-slate-800 dark:text-slate-200">{c.is_ai ? 'AI prefill' : c.scorer_id === meId ? 'You' : name(c.scorer_id)}</span>
								<span className="font-mono">avg {c.avg_score ?? '—'}</span>
								{c.ones > 0 && <Badge color="danger">{c.ones}× 1</Badge>}
								{c.twos > 0 && <Badge color="warning">{c.twos}× 2</Badge>}
								{c.fours > 0 && <Badge color="success">{c.fours}× 4</Badge>}
								<Badge color={ev.verdict === 'strong_hire' || ev.verdict === 'advance' ? 'success' : ev.verdict === 'no_hire' ? 'danger' : 'warning'}>{(c.recommendation ?? ev.verdict).replace('_', ' ')}</Badge>
								{c.is_ai && <span className="text-2xs">(not a vote — confirm in your own card)</span>}
								{!c.submitted_at && !c.is_ai && <span className="text-2xs">draft</span>}
							</div>
						);
					})}
				</div>
			)}
		</Card>
	);
}

function ScorecardForm({ interview, applicationId, positionId, questions, rules, mine, ai, onDone }: { interview: InterviewRow; applicationId: string; positionId: string; questions: ScorecardQuestion[]; rules: ScorecardRules; mine: ScorecardRow | null; ai: ScorecardRow | null; onDone: () => void }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<Msg>(null);
	const [answers, setAnswers] = useState<ScorecardAnswers>(mine?.answers ?? {});
	const [note, setNote] = useState(mine?.overall_note ?? '');
	const stats = useMemo(() => scorecardStats(answers), [answers]);
	const ev = useMemo(() => evaluateScorecard(interview.kind, answers, rules), [answers, interview.kind, rules]);
	const locked = !!mine?.submitted_at;
	const set = (k: string, patch: { score?: number | null; note?: string | null }) => setAnswers((a) => ({ ...a, [k]: { ...(a[k] ?? {}), ...patch } }));
	const submit = (submitFlag: boolean) =>
		start(async () => {
			setMsg(null);
			const fd = new FormData();
			fd.set('interview_id', interview.id);
			fd.set('application_id', applicationId);
			fd.set('position_id', positionId);
			fd.set('kind', interview.kind);
			fd.set('answers_json', JSON.stringify(answers));
			fd.set('overall_note', note);
			fd.set('submit', String(submitFlag));
			const r = await saveScorecard(fd);
			setMsg(r.ok ? { ok: true, text: submitFlag ? `Submitted · avg ${r.avg} · ${r.verdict.replace('_', ' ')}` : 'Draft saved.' } : { ok: false, text: r.error });
			if (r.ok && submitFlag) onDone();
			router.refresh();
		});
	return (
		<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-3">
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<span className="font-medium text-slate-800 dark:text-slate-200">Scale:</span>
				{([1, 2, 3, 4] as const).map((n) => (
					<span key={n} className="text-slate-600 dark:text-slate-400">
						{n} {SCALE[n]}
					</span>
				))}
				{ai && Object.keys(ai.answers).length > 0 && !locked && (
					<Button size="sm" variant="ghost" onClick={() => setAnswers((a) => ({ ...ai.answers, ...a }))}>
						Load AI prefill into empty rows
					</Button>
				)}
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
			{questions.map((q) => {
				const cur = answers[q.key]?.score ?? null;
				const aiA = ai?.answers[q.key];
				return (
					<div key={q.key} className="space-y-1">
						<div className="text-sm text-slate-900 dark:text-slate-100">
							<span className="font-medium">{q.label}</span>
							{q.pillars.length > 0 && <span className="text-2xs text-slate-500 ml-2">{q.pillars.join(' · ')}</span>}
						</div>
						<div className="text-xs text-slate-600 dark:text-slate-400">{q.prompt}</div>
						<div className="flex flex-wrap gap-1.5">
							{([1, 2, 3, 4] as const).map((n) => (
								<button key={n} type="button" disabled={locked} title={q.anchors[String(n)] ?? SCALE[n]} onClick={() => set(q.key, { score: cur === n ? null : n })} className={`w-9 h-9 rounded-md border text-sm font-medium ${cur === n ? (n === 1 ? 'bg-red-600 border-red-600 text-white' : n === 2 ? 'bg-amber-500 border-amber-500 text-slate-900' : n === 4 ? 'bg-green-600 border-green-600 text-white' : 'bg-primary-700 border-primary-700 text-white') : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45'}`}>
									{n}
								</button>
							))}
							<span className="text-2xs text-slate-500 self-center">{cur ? q.anchors[String(cur)] : ''}</span>
						</div>
						<Input value={answers[q.key]?.note ?? ''} onChange={(e) => set(q.key, { note: e.target.value })} placeholder={aiA?.note ? `AI: ${aiA.note}` : 'Evidence (one line)'} disabled={locked} className="text-xs" />
					</div>
				);
			})}
			<Textarea label="Overall note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} />
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<span className="font-mono">avg {stats.avg ?? '—'}</span>
				<Badge color={ev.verdict === 'strong_hire' || ev.verdict === 'advance' ? 'success' : ev.verdict === 'no_hire' ? 'danger' : ev.verdict === 'incomplete' ? 'default' : 'warning'}>{ev.verdict.replace('_', ' ')}</Badge>
				<span className="text-slate-500">{ev.reasons.join(' · ')}</span>
				{ev.watchouts.length > 0 && <span className="text-amber-700 dark:text-amber-400">watch-outs: {ev.watchouts.join(', ')}</span>}
			</div>
			{!locked && (
				<div className="flex gap-2">
					<Button size="sm" variant="outline" loading={pending} onClick={() => submit(false)}>
						Save draft
					</Button>
					<Button size="sm" loading={pending} onClick={() => submit(true)} disabled={stats.n === 0}>
						Submit scorecard
					</Button>
				</div>
			)}
		</div>
	);
}

export function MessagePanel({ applicationId, positionId, messages, templates, interviews, hasPhone }: { applicationId: string; positionId: string; messages: MessageRow[]; templates: MessageTemplateRow[]; interviews: InterviewRow[]; hasPhone: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<Msg>(null);
	const [compose, setCompose] = useState(false);
	const [tpl, setTpl] = useState('');
	const chosen = templates.find((t) => t.key === tpl);
	const draft = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await draftCandidateMessage(fd);
			setMsg(r.ok ? { ok: true, text: 'Drafted. Review it below, then approve / send.' } : { ok: false, text: r.error });
			if (r.ok) setCompose(false);
			router.refresh();
		});
	const review = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await reviewMessage(fd);
			setMsg(r.ok ? { ok: true, text: r.status === 'sent' ? 'Sent.' : r.status === 'approved' ? 'Approved; it goes out on the next tick.' : r.status === 'cancelled' ? 'Cancelled.' : 'Saved.' } : { ok: false, text: r.error });
			router.refresh();
		});
	return (
		<Card className="space-y-3">
			<div className="flex items-center gap-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Messages</h2>
				<span className="text-2xs text-slate-500">every message is reviewed by a person before it sends</span>
				<Button size="sm" variant={compose ? 'ghost' : 'outline'} className="ml-auto" onClick={() => setCompose(!compose)}>
					{compose ? 'Close' : '+ Draft'}
				</Button>
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
			{compose && (
				<form action={draft} className="grid sm:grid-cols-3 gap-2">
					<input type="hidden" name="application_id" value={applicationId} />
					<input type="hidden" name="position_id" value={positionId} />
					<Select name="template_key" label="Template" value={tpl} onChange={(e) => setTpl(e.target.value)}>
						<option value="">— free text —</option>
						{templates.filter((t) => t.is_active).map((t) => (
							<option key={t.key} value={t.key}>
								{t.label} ({t.channel})
							</option>
						))}
					</Select>
					<Select name="channel" label="Channel" defaultValue={chosen?.channel ?? 'email'}>
						<option value="email">Email (careers@)</option>
						<option value="sms" disabled={!hasPhone}>
							SMS (hiring number){hasPhone ? '' : ' — no phone'}
						</option>
						<option value="whatsapp" disabled={!hasPhone}>
							WhatsApp{hasPhone ? '' : ' — no phone'}
						</option>
					</Select>
					<Select name="interview_id" label="About interview (fills {{when}}, {{interviewers}}, {{location}})" defaultValue="">
						<option value="">—</option>
						{interviews.map((i) => (
							<option key={i.id} value={i.id}>
								{INTERVIEW_KIND_LABELS[i.kind]}
								{i.scheduled_at ? ` · ${formatDate(i.scheduled_at, 'MMM d h:mm a')}` : ''}
							</option>
						))}
					</Select>
					<Input name="booking_url" label="{{booking_url}}" placeholder="https://calendly.com/…" className="sm:col-span-2" />
					<Input name="next_step" label="{{next_step}}" />
					{!tpl && <Input name="subject" label="Subject (email)" className="sm:col-span-3" />}
					{!tpl && <Textarea name="body_md" label="Body" rows={5} className="sm:col-span-3" />}
					<div className="sm:col-span-3">
						<Button type="submit" size="sm" loading={pending}>
							Draft for review
						</Button>
					</div>
				</form>
			)}
			<ul className="divide-y divide-slate-200 dark:divide-slate-700">
				{messages.length === 0 && <li className="py-2 text-sm text-slate-500">No messages yet.</li>}
				{messages.map((m) => (
					<li key={m.id} className="py-2 space-y-1">
						<div className="flex flex-wrap items-center gap-2 text-xs">
							<Badge color={m.status === 'sent' ? 'success' : m.status === 'approved' ? 'primary' : m.status === 'failed' ? 'danger' : m.status === 'cancelled' ? 'default' : 'warning'}>{m.status}</Badge>
							<Badge>{m.channel}</Badge>
							<span className="text-slate-600 dark:text-slate-400">{m.subject ?? m.template_key ?? 'message'}</span>
							<span className="text-slate-500 ml-auto">{m.sent_at ? `sent ${formatRelative(m.sent_at)}` : m.scheduled_for ? `scheduled ${formatDate(m.scheduled_for, 'MMM d h:mm a')}` : formatRelative(m.created_at)}</span>
						</div>
						{m.error && <p className="text-2xs text-red-600">{m.error}</p>}
						{m.status === 'draft' || m.status === 'approved' || m.status === 'failed' ? (
							<form action={review} className="space-y-1.5">
								<input type="hidden" name="id" value={m.id} />
								{m.channel === 'email' && <Input name="subject" defaultValue={m.subject ?? ''} className="text-xs" />}
								<Textarea name="body_md" rows={m.channel === 'email' ? 6 : 3} defaultValue={m.body_md} className="text-xs" />
								<div className="flex flex-wrap gap-1.5">
									<Button type="submit" name="decision" value="save" size="sm" variant="ghost" loading={pending}>
										Save edits
									</Button>
									{m.status !== 'approved' && (
										<Button type="submit" name="decision" value="approve" size="sm" variant="outline" loading={pending}>
											Approve (queue)
										</Button>
									)}
									<Button type="submit" name="decision" value="approve_send" size="sm" loading={pending}>
										Approve + send now
									</Button>
									<Button type="submit" name="decision" value="cancel" size="sm" variant="ghost" loading={pending}>
										Cancel
									</Button>
								</div>
							</form>
						) : (
							<p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap line-clamp-4">{m.body_md}</p>
						)}
					</li>
				))}
			</ul>
		</Card>
	);
}

export function PortalLinkButton({ candidateId, applicationId, positionId }: { candidateId: string; applicationId: string; positionId: string }) {
	const [pending, start] = useTransition();
	const [url, setUrl] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	return (
		<div className="space-y-1">
			<Button
				size="sm"
				variant="outline"
				loading={pending}
				onClick={() =>
					start(async () => {
						setErr(null);
						const r = await issuePortalLink({ candidate_id: candidateId, application_id: applicationId, position_id: positionId });
						if (!r.ok) return setErr(r.error);
						setUrl(r.url);
					})
				}
			>
				Candidate portal link (14 days)
			</Button>
			{url && <code className="block text-2xs break-all rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1">{url}</code>}
			{err && <p className="text-2xs text-red-600">{err}</p>}
		</div>
	);
}

export type { InterviewKind };
