'use client';

// Onboarding tab (F2): the Day 0 → 30 checklist by phase, the conversational
// intake (internal run or client link), and the discovery-call extract.

import Link from 'next/link';
import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { ACCESS_OPTION_LABELS, intakeProgress, nextIntakeQuestion, type IntakeQuestion } from '@/lib/flywheel/intake';
import type { IntakeExtractRow, IntakeSessionRow, OnboardingBundle } from '@/lib/flywheel/server';
import type { ProgramRow } from '@/lib/flywheel/shared';
import ActionForm from '../ActionForm';
import { answerIntake, applyExtract, applyIntakeSession, extractFromTranscript, openIntakeSession, setOnboardingTask, startOnboarding } from '../actions';

const PHASE_ORDER = ['Pre-Kickoff', 'Discovery Call', 'Transcript & Intake', 'Access & Audits', 'Plan Generation', 'Loom Walkthrough', 'Plan Delivery', 'Approval Window', 'Technical Foundation', 'Seed Video Production', 'First Wave Live'];

export function OnboardingChecklist({ program, onboarding, people }: { program: ProgramRow; onboarding: OnboardingBundle; people: { id: string; name: string }[] }) {
	const [phaseOpen, setPhaseOpen] = useState<string | null>(null);
	if (!onboarding.project_id) {
		return (
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Start onboarding</h2>
				<p className="text-xs text-slate-500 mb-3">Instantiates the Day 0 → 30 checklist (65 tasks, 11 phases) as a Work Engine project for this client; due dates count from kickoff, assignees come from the team roles above (Strategist, SEO/Tech, Content, Video, Distribution).</p>
				<ActionForm action={startOnboarding} success="Onboarding started." className="flex flex-wrap items-end gap-2">
					<input type="hidden" name="program_id" value={program.id} />
					<Input label="Kickoff" name="kickoff_on" type="date" defaultValue={program.kickoff_on ?? new Date().toISOString().slice(0, 10)} />
					<Button type="submit" size="sm">
						Start the 30-day checklist
					</Button>
				</ActionForm>
			</Card>
		);
	}
	const p = onboarding.progress;
	const phases = PHASE_ORDER.filter((ph) => onboarding.tasks.some((t) => t.phase === ph));
	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Day 0 → 30 checklist</h2>
				<div className="flex items-center gap-2 text-xs">
					{p && (
						<>
							<Badge color={p.done === p.total ? 'success' : 'primary'}>
								{p.done}/{p.total} done
							</Badge>
							{p.overdue > 0 && <Badge color="danger">{p.overdue} overdue</Badge>}
						</>
					)}
					<Link href={`/the-work/${onboarding.project_id}`} className="text-primary-600 hover:underline">
						Open in The Work
					</Link>
				</div>
			</div>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700">
				{phases.map((ph) => {
					const tasks = onboarding.tasks.filter((t) => t.phase === ph);
					const done = tasks.filter((t) => t.status === 'done').length;
					const overdue = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && t.due_at && new Date(t.due_at) < new Date()).length;
					const open = phaseOpen ? phaseOpen === ph : done < tasks.length && overdue > 0;
					return (
						<li key={ph} className="py-2">
							<button type="button" className="w-full flex items-center justify-between text-left" onClick={() => setPhaseOpen(open ? '' : ph)}>
								<span className="text-sm font-medium text-slate-900 dark:text-slate-100">{ph}</span>
								<span className="flex items-center gap-2 text-xs">
									{overdue > 0 && <Badge color="danger">{overdue} overdue</Badge>}
									<Badge color={done === tasks.length ? 'success' : 'default'}>
										{done}/{tasks.length}
									</Badge>
								</span>
							</button>
							{open && (
								<ul className="mt-2 space-y-1">
									{tasks.map((t) => {
										const late = t.status !== 'done' && t.status !== 'cancelled' && t.due_at && new Date(t.due_at) < new Date();
										return (
											<li key={t.id}>
												<ActionForm action={setOnboardingTask} success={null} className="flex items-start gap-2 text-xs">
													<input type="hidden" name="program_id" value={program.id} />
													<input type="hidden" name="task_id" value={t.id} />
													<input type="hidden" name="status" value={t.status === 'done' ? 'todo' : 'done'} />
													<Checkbox checked={t.status === 'done'} onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()} />
													<span className={`flex-1 ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
														{t.is_lead_indicator && <span className="text-amber-600 mr-1">★</span>}
														{t.title}
														<span className={`ml-2 text-2xs ${late ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
															{t.due_at ? `due ${t.due_at.slice(0, 10)}` : ''}
															{t.assignee_name ? ` · ${t.assignee_name}` : ' · unassigned'}
														</span>
													</span>
												</ActionForm>
											</li>
										);
									})}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
			<details className="mt-3 text-xs">
				<summary className="cursor-pointer text-slate-500">Reassign a task</summary>
				<ActionForm action={setOnboardingTask} success="Reassigned." className="mt-2 grid gap-2 md:grid-cols-[1fr_200px_auto]">
					<input type="hidden" name="program_id" value={program.id} />
					<Select name="task_id" size="sm" defaultValue="">
						<option value="">Task</option>
						{onboarding.tasks.map((t) => (
							<option key={t.id} value={t.id}>
								{t.phase}: {t.title.slice(0, 70)}
							</option>
						))}
					</Select>
					<Select name="assignee_id" size="sm" defaultValue="">
						<option value="">Unassigned</option>
						{people.map((pp) => (
							<option key={pp.id} value={pp.id}>
								{pp.name}
							</option>
						))}
					</Select>
					<input type="hidden" name="status" value="todo" />
					<Button type="submit" size="sm" variant="outline">
						Assign
					</Button>
				</ActionForm>
			</details>
		</Card>
	);
}

export function IntakePanel({ program, sessions, script, appUrl }: { program: ProgramRow; sessions: IntakeSessionRow[]; script: IntakeQuestion[]; appUrl: string }) {
	const [token, setToken] = useState<string | null>(null);
	const openInternal = sessions.find((s) => s.opened_by === 'internal' && s.status === 'open') ?? null;
	const clientSessions = sessions.filter((s) => s.opened_by === 'client');
	return (
		<Card>
			<div className="flex items-center justify-between mb-1">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Conversational intake</h2>
				{program.intake_completed_at && <Badge color="success">intake applied {program.intake_completed_at.slice(0, 10)}</Badge>}
			</div>
			<p className="text-xs text-slate-500 mb-3">One question at a time (Rapty-style); answers write structured fields on the program and facts into the list. Run it yourself from the discovery call, or send the client a link (the portal, F5, shows the same script). The Settings tab is the form fallback.</p>
			{token && (
				<Callout tone="success" className="mb-3">
					Client intake link (shown once; 30-day expiry): <code className="break-all">{appUrl}/portal/intake/{token}</code>
				</Callout>
			)}
			<div className="flex flex-wrap gap-2 mb-3">
				{!openInternal && (
					<ActionForm action={openIntakeSession} success={null}>
						<input type="hidden" name="program_id" value={program.id} />
						<Button type="submit" size="sm" variant="outline">
							Run the intake here
						</Button>
					</ActionForm>
				)}
				<ActionForm action={async (fd) => { const r = await openIntakeSession(fd); if (r.ok && r.token) setToken(r.token); return r; }} success="Client link created.">
					<input type="hidden" name="program_id" value={program.id} />
					<input type="hidden" name="for_client" value="on" />
					<Button type="submit" size="sm" variant="outline">
						Create a client intake link
					</Button>
				</ActionForm>
			</div>
			{openInternal && <IntakeChat session={openInternal} script={script} programId={program.id} />}
			{clientSessions.length > 0 && (
				<div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Client sessions</h3>
					<ul className="space-y-1 text-xs">
						{clientSessions.map((s) => (
							<li key={s.id} className="flex items-center justify-between gap-2">
								<span className="text-slate-700 dark:text-slate-300">
									{s.created_at.slice(0, 10)} · {s.status} · {intakeProgress(script, s.answers)}% of required answered
								</span>
								{s.status === 'submitted' && (
									<ActionForm action={applyIntakeSession} success="Applied to the program.">
										<input type="hidden" name="session_id" value={s.id} />
										<input type="hidden" name="program_id" value={program.id} />
										<Button type="submit" size="sm">
											Apply to program
										</Button>
									</ActionForm>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</Card>
	);
}

function IntakeChat({ session, script, programId }: { session: IntakeSessionRow; script: IntakeQuestion[]; programId: string }) {
	const q = nextIntakeQuestion(script, session.answers);
	const pct = intakeProgress(script, session.answers);
	return (
		<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-3">
			<div className="flex items-center justify-between text-2xs text-slate-500">
				<span>{session.transcript.length / 2} of {script.length} questions</span>
				<span>{pct}% of required</span>
			</div>
			<div className="max-h-56 overflow-y-auto space-y-1.5 text-xs">
				{session.transcript.map((m, i) => (
					<div key={i} className={m.role === 'user' ? 'text-right' : ''}>
						<span className={`inline-block rounded-md px-2 py-1 ${m.role === 'user' ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-900 dark:text-primary-200' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>{m.text}</span>
					</div>
				))}
				{q && (
					<div>
						<span className="inline-block rounded-md px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200">{q.ask}</span>
					</div>
				)}
			</div>
			{q ? (
				<ActionForm key={q.key} action={answerIntake} success={null} className="space-y-2" resetOnSuccess>
					<input type="hidden" name="session_id" value={session.id} />
					<input type="hidden" name="program_id" value={programId} />
					<input type="hidden" name="key" value={q.key} />
					{q.type === 'multi' ? (
						<div className="flex flex-wrap gap-3 text-xs text-slate-700 dark:text-slate-300">
							{(q.options ?? []).map((o) => (
								<label key={o} className="flex items-center gap-1">
									<Checkbox name="value_multi" value={o} /> {ACCESS_OPTION_LABELS[o] ?? o}
								</label>
							))}
						</div>
					) : q.type === 'long' || q.type === 'list' ? (
						<Textarea name="value" rows={q.type === 'list' ? 4 : 3} placeholder={q.type === 'list' ? 'One per line' : ''} />
					) : (
						<Input name="value" type={q.type === 'email' ? 'email' : 'text'} />
					)}
					<div className="flex gap-2">
						<Button type="submit" size="sm">
							Answer
						</Button>
						{!q.required && (
							<Button type="submit" name="skip" value="on" size="sm" variant="ghost">
								Skip
							</Button>
						)}
					</div>
				</ActionForm>
			) : (
				<ActionForm action={applyIntakeSession} success="Applied to the program.">
					<input type="hidden" name="session_id" value={session.id} />
					<input type="hidden" name="program_id" value={programId} />
					<Callout tone="success" className="mb-2">All questions answered.</Callout>
					<Button type="submit" size="sm">
						Apply answers to the program
					</Button>
				</ActionForm>
			)}
		</div>
	);
}

export function ExtractPanel({ program, extracts, calls, aiOn }: { program: ProgramRow; extracts: IntakeExtractRow[]; calls: { id: string; occurred_at: string; call_type: string; has_transcript: boolean }[]; aiOn: boolean }) {
	const [open, setOpen] = useState<string | null>(null);
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Discovery call → intake extract</h2>
			<p className="text-xs text-slate-500 mb-3">Pick the Sessions call (Zoom transcript) or paste the transcript. The AI pulls every onboarding field, 6–10 facts, keyword hypotheses and angles into a draft you review and apply. Nothing writes to the program until you click Apply.</p>
			{!aiOn && <Callout tone="warning" className="mb-3">No text provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY): paste the fields into Settings by hand, or run the conversational intake.</Callout>}
			<ActionForm action={extractFromTranscript} success="Extract drafted — review it below." className="grid gap-2">
				<input type="hidden" name="program_id" value={program.id} />
				<Select name="call_id" size="sm" defaultValue={program.discovery_call_id ?? ''}>
					<option value="">Paste a transcript instead</option>
					{calls.map((c) => (
						<option key={c.id} value={c.id} disabled={!c.has_transcript}>
							{c.occurred_at.slice(0, 10)} · {c.call_type}
							{c.has_transcript ? '' : ' (no transcript)'}
						</option>
					))}
				</Select>
				<Textarea name="transcript" rows={5} placeholder="Or paste the discovery-call transcript / notes here" />
				<div>
					<Button type="submit" size="sm" disabled={!aiOn}>
						Extract intake
					</Button>
				</div>
			</ActionForm>
			{extracts.length > 0 && (
				<ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
					{extracts.map((e) => (
						<li key={e.id} className="py-2 text-xs">
							<div className="flex items-center justify-between gap-2">
								<span className="text-slate-700 dark:text-slate-300">
									{e.created_at.slice(0, 16).replace('T', ' ')} · {e.source}
									{e.model ? ` · ${e.model}` : ''} · <Badge color={e.status === 'applied' ? 'success' : e.status === 'discarded' ? 'default' : 'warning'}>{e.status}</Badge>
								</span>
								<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>
									{open === e.id ? 'Close' : 'Review'}
								</Button>
							</div>
							{open === e.id && (
								<ActionForm action={applyExtract} success="Applied." className="mt-2 space-y-2" onDone={() => setOpen(null)}>
									<input type="hidden" name="extract_id" value={e.id} />
									<input type="hidden" name="program_id" value={program.id} />
									{Array.isArray(e.extract.open_questions) && (e.extract.open_questions as string[]).length > 0 && (
										<Callout tone="info">Open questions for the client: {(e.extract.open_questions as string[]).join(' · ')}</Callout>
									)}
									<Textarea name="extract_json" rows={16} defaultValue={JSON.stringify(e.extract, null, 2)} className="font-mono text-xs" readOnly={e.status !== 'draft'} />
									{e.status === 'draft' && (
										<div className="flex gap-2">
											<Button type="submit" size="sm">
												Apply to program
											</Button>
											<Button type="submit" name="discard" value="on" size="sm" variant="ghost">
												Discard
											</Button>
										</div>
									)}
								</ActionForm>
							)}
						</li>
					))}
				</ul>
			)}
		</Card>
	);
}
