'use client';

// Admin → Hiring → Interviews (0132): the Hiring Process 2026 scorecard
// questions (4-point anchors, pillars) per interview level, and the
// candidate message templates.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { MessageTemplateRow } from '@/lib/hiring/server';
import { CHANNELS, INTERVIEW_KINDS, INTERVIEW_KIND_LABELS, SCALE, type ScorecardQuestion } from '@/lib/hiring/pipeline';
import { saveMessageTemplate, saveScorecardQuestion } from '@/app/(app)/hiring/actions';

function useSubmit<T extends { ok: boolean; error?: string }>(fn: (fd: FormData) => Promise<T>, okText: string) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await fn(fd);
			setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error: string }).error });
			router.refresh();
		});
	return { submit, pending, msg };
}

export default function InterviewsTab({ questions, templates, canManage }: { questions: ScorecardQuestion[]; templates: MessageTemplateRow[]; canManage: boolean }) {
	const q = useSubmit(saveScorecardQuestion, 'Question saved.');
	const t = useSubmit(saveMessageTemplate, 'Template saved.');
	const [newQ, setNewQ] = useState(false);
	const [newT, setNewT] = useState(false);
	const QForm = ({ x }: { x: ScorecardQuestion | null }) => (
		<form action={q.submit} className="grid sm:grid-cols-4 gap-2">
			<Input name="key" label="Key" defaultValue={x?.key ?? ''} pattern="[a-z][a-z0-9_]{1,60}" required readOnly={!!x} disabled={!canManage} />
			<Select name="interview_kind" label="Level" defaultValue={x?.interview_kind ?? 'culture_fit'} disabled={!canManage}>
				{INTERVIEW_KINDS.map((k) => (
					<option key={k} value={k}>
						{INTERVIEW_KIND_LABELS[k]}
					</option>
				))}
			</Select>
			<Input name="position" label="Order" type="number" defaultValue={x?.position ?? 100} disabled={!canManage} />
			<Input name="label" label="Short label" defaultValue={x?.label ?? ''} required disabled={!canManage} />
			<Textarea name="prompt" label="Question" rows={2} defaultValue={x?.prompt ?? ''} required className="sm:col-span-3" disabled={!canManage} />
			<Input name="pillars" label="Pillars (comma)" defaultValue={x?.pillars.join(', ') ?? ''} disabled={!canManage} />
			{([1, 2, 3, 4] as const).map((n) => (
				<Input key={n} name={`a${n}`} label={`${n} — ${SCALE[n]}`} defaultValue={x?.anchors[String(n)] ?? ''} disabled={!canManage} />
			))}
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
				<Checkbox name="is_active" defaultChecked={x?.is_active ?? true} disabled={!canManage} /> Active
			</label>
			{canManage && (
				<div className="sm:col-span-3 flex justify-end">
					<Button type="submit" size="sm" loading={q.pending}>
						Save
					</Button>
				</div>
			)}
		</form>
	);
	const TForm = ({ x }: { x: MessageTemplateRow | null }) => (
		<form action={t.submit} className="grid sm:grid-cols-4 gap-2">
			<Input name="key" label="Key" defaultValue={x?.key ?? ''} pattern="[a-z][a-z0-9_]{1,60}" required readOnly={!!x} disabled={!canManage} />
			<Input name="label" label="Label" defaultValue={x?.label ?? ''} required disabled={!canManage} />
			<Select name="channel" label="Channel" defaultValue={x?.channel ?? 'email'} disabled={!canManage}>
				{CHANNELS.map((c) => (
					<option key={c} value={c}>
						{c}
					</option>
				))}
			</Select>
			<Input name="stage_key" label="Stage (optional)" defaultValue={x?.stage_key ?? ''} disabled={!canManage} />
			<Input name="subject" label="Subject (email)" defaultValue={x?.subject ?? ''} className="sm:col-span-4" disabled={!canManage} />
			<Textarea name="body_md" label="Body — placeholders: {{first_name}} {{position}} {{brand}} {{sender_name}} {{sender_title}} {{signature}} {{booking_url}} {{interviewers}} {{interview_kind}} {{when}} {{timezone}} {{location}} {{next_step}} {{similar_roles}} {{alert_url}} {{portal_url}}" rows={8} defaultValue={x?.body_md ?? ''} required className="sm:col-span-4 text-xs" disabled={!canManage} />
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
				<Checkbox name="is_active" defaultChecked={x?.is_active ?? true} disabled={!canManage} /> Active
			</label>
			{canManage && (
				<div className="sm:col-span-3 flex justify-end">
					<Button type="submit" size="sm" loading={t.pending}>
						Save
					</Button>
				</div>
			)}
		</form>
	);
	return (
		<div className="space-y-6">
			<section className="space-y-3">
				<Callout tone="info">Hiring Process 2026 scorecards. Universal 4-point scale: {([1, 2, 3, 4] as const).map((n) => `${n} ${SCALE[n]}`).join(' · ')}. Culture Fit advances with no 1s and average ≥ 3.0 (2s are watch-outs); Job Fit needs no 1s on Q1 / Q2 / Q4 and average ≥ 3.0; Final strong hire = no 1s, average ≥ 3.2, a 4 on Q1-Q3; a 1 on Q1 or Q2 is no hire. The rules live in settings → scorecard_rules.</Callout>
				{q.msg && <Callout tone={q.msg.ok ? 'success' : 'error'}>{q.msg.text}</Callout>}
				{INTERVIEW_KINDS.filter((k) => questions.some((x) => x.interview_kind === k)).map((k) => (
					<Card key={k} className="space-y-3">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{INTERVIEW_KIND_LABELS[k]}</h2>
						{questions.filter((x) => x.interview_kind === k).map((x) => (
							<details key={x.key} className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
								<summary className="cursor-pointer text-sm text-slate-800 dark:text-slate-200 flex flex-wrap items-center gap-2">
									<span className="font-medium">{x.position}. {x.label}</span>
									<span className="text-xs text-slate-500 truncate">{x.prompt}</span>
									{x.pillars.map((p) => (
										<Badge key={p}>{p}</Badge>
									))}
									{x.is_template && <Badge color="accent">role-specific</Badge>}
									{!x.is_active && <Badge color="warning">inactive</Badge>}
								</summary>
								<div className="mt-3">
									<QForm x={x} />
								</div>
							</details>
						))}
					</Card>
				))}
				{canManage && (
					<Card>
						<Button size="sm" variant={newQ ? 'ghost' : 'outline'} onClick={() => setNewQ(!newQ)}>
							{newQ ? 'Close' : '+ New question'}
						</Button>
						{newQ && (
							<div className="mt-3">
								<QForm x={null} />
							</div>
						)}
					</Card>
				)}
			</section>
			<section className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Message templates</h2>
				<Callout tone="info">Invite / advance / reject / offer / reminders / no-show / closed role. Every message drafted from these is reviewed by a person before it sends; reminders are the one exception (pre-approved because the schedule was already reviewed).</Callout>
				{t.msg && <Callout tone={t.msg.ok ? 'success' : 'error'}>{t.msg.text}</Callout>}
				{templates.map((x) => (
					<details key={x.key} className="rounded-md border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
						<summary className="cursor-pointer text-sm text-slate-800 dark:text-slate-200 flex flex-wrap items-center gap-2">
							<span className="font-medium">{x.label}</span>
							<Badge>{x.channel}</Badge>
							{x.stage_key && <Badge>{x.stage_key}</Badge>}
							{!x.is_active && <Badge color="warning">inactive</Badge>}
							<span className="text-xs text-slate-500">{x.subject ?? x.body_md.slice(0, 80)}</span>
						</summary>
						<div className="mt-3">
							<TForm x={x} />
						</div>
					</details>
				))}
				{canManage && (
					<Card>
						<Button size="sm" variant={newT ? 'ghost' : 'outline'} onClick={() => setNewT(!newT)}>
							{newT ? 'Close' : '+ New template'}
						</Button>
						{newT && (
							<div className="mt-3">
								<TForm x={null} />
							</div>
						)}
					</Card>
				)}
			</section>
		</div>
	);
}
