'use client';

// Client pieces for the content request queue: the filing form (The Work),
// the row actions the queue uses (Content Studio) and the proposal decide
// row. Each calls a server action and shows the {ok, error} verdict in a
// Callout; the transition rules live in the database.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { formatRelative } from '@/lib/format';
import {
	ASSET_TYPE_LABELS,
	ASSET_TYPE_STUDIO_TOOL,
	ASSET_TYPES,
	PRIORITIES,
	STATUS_LABELS,
	isOpen,
	slaClock,
	type ContentRequestRow,
	type RequestStatus,
} from '@/lib/content-requests/shared';
import {
	acceptContentRequest,
	declineContentRequest,
	decideRequestProposal,
	deliverContentRequest,
	fileContentRequest,
	linkStudioJob,
} from '@/app/(app)/the-work/content-requests/actions';

type Result = { ok: true } | { ok: false; error: string };

function useAction(action: (fd: FormData) => Promise<Result>, onOk?: () => void) {
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const submit = (fd: FormData) =>
		start(async () => {
			setSaved(false);
			const r = await action(fd);
			setError(r.ok ? null : r.error);
			setSaved(r.ok);
			if (r.ok) onOk?.();
		});
	return { pending, error, saved, submit };
}

export interface ClientOption {
	id: string;
	name: string;
}

// ---------------------------------------------------------------- filing

/** `defaultClientId`: prefill from `?client=` (the client page's "Request content" button). Unknown ids fall back to none. */
export function FileRequestForm({ clients, defaultClientId }: { clients: ClientOption[]; defaultClientId?: string | null }) {
	const [key, setKey] = useState(0);
	const { pending, error, saved, submit } = useAction(fileContentRequest, () => setKey((k) => k + 1));
	const initialClient = defaultClientId && clients.some((c) => c.id === defaultClientId) ? defaultClientId : '';
	return (
		<form key={key} action={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<Select name="asset_type" label="Asset type" defaultValue="post" required>
				{ASSET_TYPES.map((t) => (
					<option key={t} value={t}>
						{ASSET_TYPE_LABELS[t]}
					</option>
				))}
			</Select>
			<Select name="client_id" label="Client" defaultValue={initialClient}>
				<option value="">No client (internal)</option>
				{clients.map((c) => (
					<option key={c.id} value={c.id}>
						{c.name}
					</option>
				))}
			</Select>
			<div className="sm:col-span-2">
				<Input name="title" label="What do you need" required minLength={3} maxLength={200} placeholder="One line: the asset, the moment, the audience" />
			</div>
			<Input type="date" name="due_on" label="Due date" />
			<Select name="priority" label="Priority" defaultValue="normal">
				{PRIORITIES.map((p) => (
					<option key={p} value={p}>
						{p}
					</option>
				))}
			</Select>
			<div className="sm:col-span-2">
				<Textarea name="brief" label="Brief" rows={4} maxLength={5000} placeholder="Goal, platform, tone, must-say claims, links to source material. The studio drafts from this." />
			</div>
			<div className="sm:col-span-2 flex items-center gap-3">
				<Button type="submit" size="sm" loading={pending}>
					File request
				</Button>
				{saved && <span className="text-xs text-green-700 dark:text-green-400">Filed. The content queue has 24 hours to accept it.</span>}
			</div>
			{error && (
				<div className="sm:col-span-2">
					<Callout tone="error">{error}</Callout>
				</div>
			)}
		</form>
	);
}

// ---------------------------------------------------------------- badges

const STATUS_COLOR: Record<RequestStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
	requested: 'warning',
	accepted: 'primary',
	in_studio: 'primary',
	delivered: 'success',
	declined: 'default',
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
	return <Badge color={STATUS_COLOR[status] ?? 'default'}>{STATUS_LABELS[status] ?? status}</Badge>;
}

const SLA_CLASS = {
	ok: 'text-slate-500 dark:text-slate-400',
	soon: 'text-amber-700 dark:text-amber-400',
	late: 'text-red-700 dark:text-red-400 font-medium',
	none: 'hidden',
} as const;

export function SlaClock({ row }: { row: ContentRequestRow }) {
	const c = slaClock(row);
	if (c.state === 'none') return null;
	return (
		<span className={clsx('text-2xs tabular-nums', SLA_CLASS[c.state])} title={c.clock === 'accept' ? `Accept by ${new Date(row.sla_accept_by).toLocaleString()}` : `Due ${row.due_on}`}>
			{c.label}
		</span>
	);
}

const PRIORITY_CLASS: Record<string, string> = {
	urgent: 'text-red-700 dark:text-red-400',
	high: 'text-amber-700 dark:text-amber-400',
	normal: 'text-slate-500 dark:text-slate-400',
	low: 'text-slate-500 dark:text-slate-400',
};

/** One line of facts under the title, shared by both pages. */
export function RequestMeta({ row, showRequester = true }: { row: ContentRequestRow; showRequester?: boolean }) {
	return (
		<p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5">
			<span>{ASSET_TYPE_LABELS[row.asset_type] ?? row.asset_type}</span>
			{row.client_name && <span>· {row.client_name}</span>}
			{showRequester && row.requester_name && <span>· by {row.requester_name}</span>}
			{row.identity_slug && <span>· proposed by {row.identity_slug}</span>}
			<span className={PRIORITY_CLASS[row.priority]}>· {row.priority}</span>
			{row.due_on && <span>· due {row.due_on}</span>}
			{row.assignee_name && <span>· {row.assignee_name}</span>}
			<span>· filed {formatRelative(row.created_at)}</span>
		</p>
	);
}

// ---------------------------------------------------------------- requester actions

export function WithdrawButton({ row }: { row: ContentRequestRow }) {
	const { pending, error, submit } = useAction(declineContentRequest);
	if (row.status !== 'requested') return null;
	return (
		<form action={submit} className="flex items-center gap-2">
			<input type="hidden" name="id" value={row.id} />
			<Button type="submit" size="sm" variant="ghost" loading={pending}>
				Withdraw
			</Button>
			{error && <span className="text-2xs text-red-700 dark:text-red-400">{error}</span>}
		</form>
	);
}

// ---------------------------------------------------------------- queue actions

export interface QueueOptions {
	providers: { id: string; label: string }[];
	assignees: { id: string; name: string }[];
	/** Recent studio jobs the queue may link to an accepted request. */
	jobs: { id: string; label: string }[];
}

export function QueueActions({ row, options }: { row: ContentRequestRow; options: QueueOptions }) {
	const accept = useAction(acceptContentRequest);
	const link = useAction(linkStudioJob);
	const deliver = useAction(deliverContentRequest);
	const decline = useAction(declineContentRequest);
	const [mode, setMode] = useState<'idle' | 'decline' | 'deliver' | 'link'>('idle');
	const pending = accept.pending || link.pending || deliver.pending || decline.pending;
	const error = accept.error ?? link.error ?? deliver.error ?? decline.error;
	if (!isOpen(row.status)) return null;

	return (
		<div className="space-y-2">
			{row.status === 'requested' && (
				<form action={accept.submit} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="id" value={row.id} />
					<Select name="provider" size="sm" defaultValue={options.providers[0]?.id ?? 'none'} aria-label="Draft with">
						<option value="none">Accept only (no draft)</option>
						{options.providers.map((p) => (
							<option key={p.id} value={p.id}>
								Draft with {p.label}
							</option>
						))}
					</Select>
					<Select name="assignee_id" size="sm" defaultValue="" aria-label="Assign to">
						<option value="">Assign to me</option>
						{options.assignees.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</Select>
					<Button type="submit" size="sm" loading={accept.pending} disabled={pending}>
						Accept
					</Button>
					<Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(mode === 'decline' ? 'idle' : 'decline')}>
						Decline
					</Button>
				</form>
			)}

			{row.status === 'accepted' && (
				<div className="flex flex-wrap items-center gap-2">
					<Link href={ASSET_TYPE_STUDIO_TOOL[row.asset_type] ?? '/social/studio'}>
						<Button type="button" size="sm" variant="outline">
							Open studio tool
						</Button>
					</Link>
					<Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setMode(mode === 'link' ? 'idle' : 'link')}>
						Link a job
					</Button>
					<Button type="button" size="sm" disabled={pending} onClick={() => setMode(mode === 'deliver' ? 'idle' : 'deliver')}>
						Deliver
					</Button>
					<Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(mode === 'decline' ? 'idle' : 'decline')}>
						Decline
					</Button>
				</div>
			)}

			{row.status === 'in_studio' && (
				<div className="flex flex-wrap items-center gap-2">
					{row.studio_job_id && (
						<Link href={`/social/studio/jobs?job=${row.studio_job_id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
							Studio job · {row.studio_job_status ?? 'queued'}
						</Link>
					)}
					<Button type="button" size="sm" disabled={pending} onClick={() => setMode(mode === 'deliver' ? 'idle' : 'deliver')}>
						Deliver
					</Button>
					<Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setMode(mode === 'decline' ? 'idle' : 'decline')}>
						Decline
					</Button>
				</div>
			)}

			{mode === 'link' && (
				<form action={link.submit} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="id" value={row.id} />
					<Select name="job_id" size="sm" defaultValue="" required aria-label="Studio job">
						<option value="">Pick a recent studio job</option>
						{options.jobs.map((j) => (
							<option key={j.id} value={j.id}>
								{j.label}
							</option>
						))}
					</Select>
					<Button type="submit" size="sm" loading={link.pending}>
						Link
					</Button>
				</form>
			)}
			{mode === 'deliver' && (
				<form action={deliver.submit} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="id" value={row.id} />
					<Input name="note" placeholder="Where it landed (link, folder), optional" className="max-w-sm" />
					<Button type="submit" size="sm" loading={deliver.pending}>
						Mark delivered
					</Button>
				</form>
			)}
			{mode === 'decline' && (
				<form action={decline.submit} className="flex flex-wrap items-center gap-2">
					<input type="hidden" name="id" value={row.id} />
					<Input name="note" placeholder="Why (the requester sees this)" className="max-w-sm" />
					<Button type="submit" size="sm" variant="secondary" loading={decline.pending}>
						Confirm decline
					</Button>
				</form>
			)}
			{error && <Callout tone="error">{error}</Callout>}
		</div>
	);
}

// ---------------------------------------------------------------- proposals

export function ProposalDecide({ actionId }: { actionId: string }) {
	const { pending, error, submit } = useAction(decideRequestProposal);
	return (
		<form action={submit} className="flex flex-wrap items-center gap-2">
			<input type="hidden" name="action_id" value={actionId} />
			<Input name="note" placeholder="Note (optional)" className="max-w-xs" />
			<Button type="submit" name="decision" value="approved" size="sm" loading={pending}>
				File it
			</Button>
			<Button type="submit" name="decision" value="rejected" size="sm" variant="ghost" disabled={pending}>
				Reject
			</Button>
			{error && <span className="text-2xs text-red-700 dark:text-red-400">{error}</span>}
		</form>
	);
}
