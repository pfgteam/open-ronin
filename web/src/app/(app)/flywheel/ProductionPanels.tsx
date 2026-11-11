'use client';

// Production pipeline UI (F4): run-agent buttons, the draft card with the
// lane → verification → apply ladder, the posting-queue row.

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { AgentRow, DraftRow } from '@/lib/flywheel/production';
import { MEMBER_ROLE_LABELS, type MemberRole, type QueueRow } from '@/lib/flywheel/shared';
import ActionForm from './ActionForm';
import { draftPageCitations, humanizeDraftAction, reviewDraft, runAgentAction, updateQueueItem } from './productionActions';

export const DRAFT_STATUS_COLOR: Record<DraftRow['status'], 'default' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'> = { queued: 'default', generating: 'primary', draft: 'default', in_review: 'primary', verification: 'accent', approved: 'success', applied: 'success', rejected: 'danger', failed: 'danger' };
export const DRAFT_STATUS_LABEL: Record<DraftRow['status'], string> = { queued: 'Queued', generating: 'Generating', draft: 'Draft', in_review: 'Lane review', verification: 'Verification (Gabi)', approved: 'Approved', applied: 'Applied', rejected: 'Rejected', failed: 'Failed' };

export function RunAgentButton({ programId, targetId, agent, label, aiOn, notes }: { programId: string; targetId: string; agent: AgentRow; label?: string; aiOn: boolean; notes?: boolean }) {
	return (
		<ActionForm action={runAgentAction} success={`${agent.persona ?? agent.label} drafted — review it in Drafts.`} className="flex flex-wrap items-end gap-1.5">
			<input type="hidden" name="program_id" value={programId} />
			<input type="hidden" name="agent_key" value={agent.key} />
			<input type="hidden" name="target_id" value={targetId} />
			{notes && <Input name="notes" placeholder="Notes for the agent (optional)" />}
			<Button type="submit" size="sm" variant="outline" disabled={!aiOn} title={agent.is_placeholder ? 'Placeholder prompt until Chris’s is loaded' : undefined}>
				{label ?? `AI: ${agent.label}`}
				{agent.is_placeholder ? ' (placeholder)' : ''}
			</Button>
		</ActionForm>
	);
}

export function DraftCitationsButton({ programId, pageId, aiOn, planned }: { programId: string; pageId: string; aiOn: boolean; planned: number }) {
	return (
		<ActionForm action={draftPageCitations} success="Citation drafts queued — review them in Drafts.">
			<input type="hidden" name="program_id" value={programId} />
			<input type="hidden" name="page_id" value={pageId} />
			<input type="hidden" name="limit" value="8" />
			<Button type="submit" size="sm" variant="outline" disabled={!aiOn || planned === 0}>
				AI: draft {Math.min(8, planned)} planned citations
			</Button>
		</ActionForm>
	);
}

export function DraftCard({ draft, programId, myRoles, canManage, people }: { draft: DraftRow; programId: string; myRoles: MemberRole[]; canManage: boolean; people?: { id: string; name: string }[] }) {
	const [open, setOpen] = useState(draft.status === 'in_review' || draft.status === 'verification');
	const isLane = myRoles.includes(draft.lane) || canManage;
	const isVerifier = myRoles.includes('verifier') || canManage;
	const rc = draft.rules_check;
	const name = (id: string | null) => people?.find((p) => p.id === id)?.name ?? (id ? id.slice(0, 8) : '—');
	return (
		<Card>
			<button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
				<div className="min-w-0">
					<h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{draft.title ?? draft.kind}</h3>
					<p className="text-2xs text-slate-500">
						{draft.kind} · {draft.agent_key ?? 'manual'} · {MEMBER_ROLE_LABELS[draft.lane]} · {draft.created_at.slice(0, 16).replace('T', ' ')}
						{draft.model ? ` · ${draft.model}` : ''}
					</p>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{rc && (rc.ok ? <Badge color="success">rules ok</Badge> : <Badge color="danger">rules: {rc.failed.join(', ')}</Badge>)}
					<Badge color={DRAFT_STATUS_COLOR[draft.status]}>{DRAFT_STATUS_LABEL[draft.status]}</Badge>
				</div>
			</button>
			{open && (
				<div className="mt-3 space-y-2">
					{draft.error && <Callout tone="error">{draft.error}</Callout>}
					{draft.review_note && <Callout tone="info">Note: {draft.review_note}</Callout>}
					<p className="text-2xs text-slate-500">
						{draft.reviewed_at ? `Lane review ${draft.reviewed_at.slice(0, 10)} by ${name(draft.reviewed_by)}` : 'Not lane-reviewed'}
						{draft.verified_at ? ` · verified ${draft.verified_at.slice(0, 10)} by ${name(draft.verified_by)}` : ''}
						{draft.applied_at ? ` · applied ${draft.applied_at.slice(0, 10)}` : ''}
					</p>
					<ActionForm action={reviewDraft} success="Saved." className="space-y-2">
						<input type="hidden" name="draft_id" value={draft.id} />
						<input type="hidden" name="program_id" value={programId} />
						<Input name="title" defaultValue={draft.title ?? ''} readOnly={draft.status === 'applied'} />
						<div className={draft.humanized_md ? 'grid gap-2 md:grid-cols-2' : ''}>
							<div>
								{draft.humanized_md && <p className="text-2xs uppercase tracking-wide text-slate-500 mb-1">Raw AI draft</p>}
								<Textarea name="content_md" rows={draft.kind === 'page' || draft.kind === 'script' || draft.kind === 'plan' ? 18 : 8} defaultValue={draft.content_md ?? ''} readOnly={draft.status === 'applied'} className="font-mono text-xs" />
							</div>
							{draft.humanized_md && (
								<div>
									<p className="text-2xs uppercase tracking-wide text-green-700 dark:text-green-400 mb-1">Humanized (this is what gets applied)</p>
									<Textarea name="humanized_md" rows={draft.kind === 'page' || draft.kind === 'script' || draft.kind === 'plan' ? 18 : 8} defaultValue={draft.humanized_md} readOnly={draft.status === 'applied'} className="font-mono text-xs" />
									{draft.humanize_notes && <pre className="mt-1 whitespace-pre-wrap text-2xs text-slate-500">{draft.humanize_notes}</pre>}
								</div>
							)}
						</div>
						{draft.structured && (
							<details className="text-xs">
								<summary className="cursor-pointer text-slate-500">Structured output (JSON; editable)</summary>
								<Textarea name="structured_json" rows={10} defaultValue={JSON.stringify(draft.structured, null, 2)} readOnly={draft.status === 'applied'} className="font-mono text-xs mt-1" />
							</details>
						)}
						<Input name="review_note" placeholder="Review note (required to request changes / reject)" />
						{draft.status !== 'applied' && (
							<div className="flex flex-wrap gap-1.5">
								<Button type="submit" name="decision" value="save" size="sm" variant="ghost">
									Save edits
								</Button>
								{draft.status === 'draft' && (
									<Button type="submit" name="decision" value="to_review" size="sm" variant="outline">
										Send to lane review
									</Button>
								)}
								{draft.status === 'in_review' && isLane && (
									<>
										<Button type="submit" name="decision" value="to_verification" size="sm">
											Lane OK → verification
										</Button>
										<Button type="submit" name="decision" value="changes" size="sm" variant="ghost">
											Request changes
										</Button>
									</>
								)}
								{draft.status === 'verification' && isVerifier && (
									<>
										<Button type="submit" name="decision" value="approve_apply" size="sm">
											Verify + approve + apply
										</Button>
										<Button type="submit" name="decision" value="approve" size="sm" variant="outline">
											Verify + approve
										</Button>
										<Button type="submit" name="decision" value="changes" size="sm" variant="ghost">
											Request changes
										</Button>
									</>
								)}
								{draft.status === 'approved' && (
									<Button type="submit" name="decision" value="apply" size="sm">
										Apply to {draft.target_kind}
									</Button>
								)}
								{['draft', 'in_review', 'verification', 'failed', 'generating'].includes(draft.status) && (isLane || isVerifier) && (
									<Button type="submit" name="decision" value="reject" size="sm" variant="ghost">
										Reject
									</Button>
								)}
							</div>
						)}
					</ActionForm>
					{draft.status !== 'applied' && ['page', 'citation', 'plan', 'script', 'visibility_report', 'recap', 'report'].includes(draft.kind) && (
						<ActionForm action={humanizeDraftAction} success="Humanized — compare the two columns, edit, then send on." className="flex flex-wrap items-end gap-1.5 border-t border-slate-200 dark:border-slate-700 pt-2">
							<input type="hidden" name="draft_id" value={draft.id} />
							<input type="hidden" name="program_id" value={programId} />
							<div className="flex-1 min-w-[240px]">
								<Input name="source_context" placeholder="Optional: paste the source (podcast episode notes, transcript excerpt) the human layer should draw from" />
							</div>
							<Button type="submit" size="sm" variant="outline">
								{draft.humanized_md ? 'Re-run humanize pass' : 'Humanize pass (human layer)'}
							</Button>
						</ActionForm>
					)}
				</div>
			)}
		</Card>
	);
}


export function QueueItem({ row, people }: { row: QueueRow; people: { id: string; name: string }[] }) {
	const [open, setOpen] = useState(false);
	const late = row.due_at && row.status !== 'posted' && row.status !== 'verified' && new Date(row.due_at) < new Date();
	return (
		<li className="py-2">
			<div className="flex items-center justify-between gap-2 text-xs">
				<button type="button" className="min-w-0 text-left" onClick={() => setOpen((v) => !v)}>
					<span className="font-medium text-slate-900 dark:text-slate-100">{row.client_name ?? ''}</span>
					<span className="text-slate-500"> · {row.channel_key} · page {row.page_number ?? '?'} “{row.page_keyword ?? ''}”</span>
					{row.title && <div className="text-slate-600 dark:text-slate-400 truncate">{row.title}</div>}
				</button>
				<span className="flex items-center gap-1 shrink-0">
					<Badge>{row.poster_kind.replace('_', ' ')}</Badge>
					<Badge color={row.status === 'verified' ? 'success' : row.status === 'posted' ? 'success' : row.status === 'claimed' ? 'primary' : row.status === 'dropped' ? 'default' : 'warning'}>{row.status}</Badge>
					{late && <Badge color="danger">past 72 h</Badge>}
					{row.due_at && !late && <span className="text-2xs text-slate-500">due {row.due_at.slice(0, 10)}</span>}
				</span>
			</div>
			{open && (
				<div className="mt-2 space-y-2">
					{row.draft_md && <pre className="whitespace-pre-wrap text-xs rounded-md bg-slate-50 dark:bg-slate-800/60 p-2 max-h-56 overflow-y-auto text-slate-700 dark:text-slate-300">{row.draft_md}</pre>}
					<ActionForm action={updateQueueItem} success="Updated." className="grid gap-1.5 md:grid-cols-[140px_160px_1fr_1fr_auto]">
						<input type="hidden" name="id" value={row.id} />
						<input type="hidden" name="program_id" value={row.program_id} />
						<Select name="poster_kind" size="sm" defaultValue={row.poster_kind}>
							<option value="person">Person</option>
							<option value="network">Owned network</option>
							<option value="fourth_pillar">Fourth Pillar</option>
						</Select>
						<Select name="assignee_id" size="sm" defaultValue={row.assignee_id ?? ''}>
							<option value="">Unassigned</option>
							{people.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</Select>
						<Input name="network_property" placeholder="Property / outlet / account" defaultValue={row.network_property ?? ''} />
						<Input name="posted_url" placeholder="Live URL (required to mark posted)" defaultValue={row.posted_url ?? ''} />
						<div className="flex gap-1">
							{row.status === 'queued' && (
								<Button type="submit" name="status" value="claimed" size="sm" variant="outline">
									Claim
								</Button>
							)}
							{(row.status === 'queued' || row.status === 'claimed') && (
								<Button type="submit" name="status" value="posted" size="sm">
									Posted
								</Button>
							)}
							{row.status === 'posted' && (
								<Button type="submit" name="status" value="verified" size="sm">
									Verify live
								</Button>
							)}
							{row.status !== 'verified' && (
								<Button type="submit" name="status" value="dropped" size="sm" variant="ghost">
									Drop
								</Button>
							)}
							<Button type="submit" size="sm" variant="ghost">
								Save
							</Button>
						</div>
					</ActionForm>
				</div>
			)}
		</li>
	);
}
