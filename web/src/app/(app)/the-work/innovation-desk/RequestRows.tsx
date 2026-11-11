// Shared row rendering for the Innovation Desk (/the-work/innovation-desk)
// and its admin pipeline (/admin/innovation-desk). Server markup only; the
// actions are plain <form action> posts so the pages stay server components.

import Badge from '@/components/ui/Badge';
import { CheckCircle2 } from 'lucide-react';
import { inputClass } from '@/app/(app)/team/_form';
import {
	KIND_LABELS,
	STATUS_COLORS,
	STATUS_LABELS,
	TWO_STEP_KINDS,
	URGENCY_COLORS,
	payloadSummary,
	type RequestKind,
	type RequestPayload,
} from '@/lib/requests/kinds';
import {
	completeStaffRequest,
	decideStaffRequest,
	startReviewStaffRequest,
	withdrawStaffRequest,
} from './actions';

export interface RequestRow {
	id: string;
	kind: string;
	title: string;
	body_md: string | null;
	payload: RequestPayload;
	requester_id: string;
	reviewer_group_id: string;
	status: string;
	decided_at: string | null;
	decision_note_md: string | null;
	created_at: string;
	requester: { first_name: string | null; last_name: string | null } | null;
}

export function fmtDate(d: string) {
	return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

export function requesterName(r: RequestRow): string {
	return [r.requester?.first_name, r.requester?.last_name].filter(Boolean).join(' ') || 'Unknown';
}

const btnPrimary = 'rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-3 py-1.5';
const btnGhost =
	'rounded-md border border-slate-300 dark:border-slate-600 text-sm font-medium px-3 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/45';

/** Title line + kind/requester/context line, shared by queue and pipeline rows. */
export function RequestSummary({ r, showRequester = true }: { r: RequestRow; showRequester?: boolean }) {
	const context = payloadSummary(r.kind, r.payload);
	return (
		<div className="min-w-0">
			<p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
				{r.title}
				{r.kind === 'software_change' && r.payload.urgency && (
					<Badge color={URGENCY_COLORS[r.payload.urgency] ?? 'default'}>{r.payload.urgency}</Badge>
				)}
			</p>
			<p className="text-xs text-slate-500 dark:text-slate-400">
				{KIND_LABELS[r.kind as RequestKind] ?? r.kind}
				{context && <> · {context}</>}
				{showRequester && <> · {requesterName(r)}</>}
				{' · '}filed {fmtDate(r.created_at)}
				{r.decision_note_md && <> · “{r.decision_note_md}”</>}
			</p>
			{r.body_md && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-wrap">{r.body_md}</p>}
		</div>
	);
}

/** Reviewer controls for one request: start review, approve/deny, complete. */
export function ReviewerActions({ r, returnTo }: { r: RequestRow; returnTo: string }) {
	const twoStep = TWO_STEP_KINDS.has(r.kind);
	return (
		<div className="flex flex-wrap items-center gap-2">
			{r.status === 'pending' && twoStep && (
				<form action={startReviewStaffRequest}>
					<input type="hidden" name="id" value={r.id} />
					<input type="hidden" name="return_to" value={returnTo} />
					<button type="submit" className={btnGhost}>Start review</button>
				</form>
			)}
			{['pending', 'in_review'].includes(r.status) && (
				<form action={decideStaffRequest} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="id" value={r.id} />
					<input type="hidden" name="return_to" value={returnTo} />
					<input name="note" placeholder="Decision note (optional)" className={inputClass + ' max-w-xs'} />
					<button type="submit" name="decision" value="approved" className={btnPrimary}>Approve</button>
					<button type="submit" name="decision" value="denied" className={btnGhost}>Deny</button>
				</form>
			)}
			{r.status === 'approved' && twoStep && (
				<form action={completeStaffRequest} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="id" value={r.id} />
					<input type="hidden" name="return_to" value={returnTo} />
					<input name="note" placeholder="Resolution note (optional)" className={inputClass + ' max-w-xs'} />
					<button type="submit" className={btnPrimary}>Mark completed</button>
				</form>
			)}
		</div>
	);
}

export function StatusBadge({ status }: { status: string }) {
	return (
		<span className="inline-flex items-center gap-2">
			<Badge color={STATUS_COLORS[status] ?? 'default'}>{STATUS_LABELS[status] ?? status}</Badge>
			{status === 'completed' && <CheckCircle2 className="w-4 h-4 text-slate-400" />}
		</span>
	);
}

export function WithdrawButton({ r, returnTo }: { r: RequestRow; returnTo: string }) {
	if (r.status !== 'pending') return null;
	return (
		<form action={withdrawStaffRequest}>
			<input type="hidden" name="id" value={r.id} />
			<input type="hidden" name="return_to" value={returnTo} />
			<button type="submit" className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline">
				Withdraw
			</button>
		</form>
	);
}
