'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { ReportRow, ReportTemplateRow } from '@/lib/flywheel/reports';
import ActionForm from '../ActionForm';
import { draftReportAction, reviewReport, runHealthCheck, setFlag } from '../reportActions';

const COLOR: Record<ReportRow['status'], 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'> = { ai_generated: 'default', awaiting_review: 'warning', approved: 'primary', sent: 'success', delivered: 'success', opened: 'accent', failed: 'danger', cancelled: 'default' };

export function ReportCard({ report, clientName }: { report: ReportRow; clientName: string }) {
	const [open, setOpen] = useState(report.status === 'awaiting_review' || report.status === 'ai_generated');
	const r = report;
	return (
		<Card>
			<button type="button" className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)}>
				<div className="min-w-0">
					<h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
						{clientName} · {r.subject ?? r.kind}
					</h3>
					<p className="text-2xs text-slate-500">
						{r.kind.replace('_', ' ')} · {r.period_from} → {r.period_to} · to {r.to_email ?? 'no portal contact'}
						{r.sent_at ? ` · sent ${r.sent_at.slice(0, 10)}` : ''}
						{r.opened_at ? ` · opened ${r.opened_at.slice(0, 10)} (${r.open_count}×)` : ''}
					</p>
				</div>
				<Badge color={COLOR[r.status]}>{r.status.replace('_', ' ')}</Badge>
			</button>
			{open && (
				<ActionForm action={reviewReport} success="Saved." className="mt-3 space-y-2">
					<input type="hidden" name="id" value={r.id} />
					{r.program_id && <input type="hidden" name="program_id" value={r.program_id} />}
					{r.error && <p className="text-xs text-red-600">{r.error}</p>}
					<div className="grid gap-2 md:grid-cols-2">
						<Input name="subject" defaultValue={r.subject ?? ''} readOnly={['sent', 'delivered', 'opened'].includes(r.status)} />
						<Input name="to_email" type="email" defaultValue={r.to_email ?? ''} placeholder="Recipient" readOnly={['sent', 'delivered', 'opened'].includes(r.status)} />
					</div>
					<Textarea name="body_md" rows={14} defaultValue={r.body_md ?? ''} className="font-mono text-xs" readOnly={['sent', 'delivered', 'opened'].includes(r.status)} />
					{!['sent', 'delivered', 'opened', 'cancelled'].includes(r.status) && (
						<div className="flex flex-wrap gap-1.5">
							<Button type="submit" name="decision" value="save" size="sm" variant="ghost">
								Save edits
							</Button>
							{r.status === 'ai_generated' && (
								<Button type="submit" name="decision" value="review" size="sm" variant="outline">
									Send to review
								</Button>
							)}
							{r.status !== 'approved' && (
								<Button type="submit" name="decision" value="approve" size="sm" variant="outline">
									Approve
								</Button>
							)}
							<Button type="submit" name="decision" value={r.status === 'approved' ? 'send' : 'approve_send'} size="sm">
								{r.status === 'approved' ? 'Send now' : 'Approve + send'}
							</Button>
							<Button type="submit" name="decision" value="cancel" size="sm" variant="ghost">
								Cancel
							</Button>
						</div>
					)}
				</ActionForm>
			)}
		</Card>
	);
}

export function DraftReportForm({ programs, templates }: { programs: { id: string; client_id: string; client_name: string }[]; templates: ReportTemplateRow[] }) {
	const today = new Date().toISOString().slice(0, 10);
	const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
	const [programId, setProgramId] = useState(programs[0]?.id ?? '');
	const prog = programs.find((p) => p.id === programId);
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Draft a report</h2>
			<ActionForm action={draftReportAction} success="Drafted — review it in the list." className="space-y-2">
				<input type="hidden" name="client_id" value={prog?.client_id ?? ''} />
				<Select label="Program" name="program_id" value={programId} onChange={(e) => setProgramId(e.target.value)} size="sm">
					{programs.map((p) => (
						<option key={p.id} value={p.id}>
							{p.client_name}
						</option>
					))}
				</Select>
				<Select label="Template" name="template_key" size="sm" defaultValue={templates[0]?.key}>
					{templates.map((t) => (
						<option key={t.key} value={t.key}>
							{t.label}
						</option>
					))}
				</Select>
				<div className="grid grid-cols-2 gap-2">
					<Input label="From" name="from" type="date" defaultValue={weekAgo} />
					<Input label="To" name="to" type="date" defaultValue={today} />
				</div>
				<Button type="submit" size="sm" disabled={!prog}>
					AI: draft
				</Button>
			</ActionForm>
		</Card>
	);
}

export function HealthFlags({ flags, programId }: { flags: { id: string; program_id: string; kind: string; severity: string; summary: string; opened_at: string; client_name: string }[]; programId?: string }) {
	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Health flags ({flags.length})</h2>
				<ActionForm action={runHealthCheck} success="Checked.">
					{programId && <input type="hidden" name="program_id" value={programId} />}
					<Button type="submit" size="sm" variant="outline">
						Run check
					</Button>
				</ActionForm>
			</div>
			<p className="text-2xs text-slate-500 mb-2">Approval overdue · wave &gt; 72 h · pages / citations behind pace · missed report or call · no visibility movement at 90 d · recording missed. Bells go to the Strategist, Gabi and Alex once a day; feeds Clients → Health.</p>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700">
				{flags.map((f) => (
					<li key={f.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
						<span>
							<Badge color={f.severity === 'critical' ? 'danger' : f.severity === 'warning' ? 'warning' : 'default'}>{f.kind.replace('_', ' ')}</Badge>{' '}
							{!programId && <span className="font-medium text-slate-900 dark:text-slate-100">{f.client_name}: </span>}
							<span className="text-slate-700 dark:text-slate-300">{f.summary}</span>
							<span className="text-2xs text-slate-500"> · since {f.opened_at.slice(0, 10)}</span>
						</span>
						<ActionForm action={setFlag} success={null} className="flex gap-1 shrink-0">
							<input type="hidden" name="id" value={f.id} />
							<input type="hidden" name="program_id" value={f.program_id} />
							<Button type="submit" name="action" value="mute_7" size="sm" variant="ghost">
								Mute 7 d
							</Button>
							<Button type="submit" name="action" value="resolve" size="sm" variant="ghost">
								Resolve
							</Button>
						</ActionForm>
					</li>
				))}
				{flags.length === 0 && <li className="py-2 text-xs text-slate-500">No open flags.</li>}
			</ul>
		</Card>
	);
}
