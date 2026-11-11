'use client';

// JobCard: one content_jobs row (or a parent->child chain) with status, cost
// and actions. While any step is queued/submitted/running it re-runs the
// server component every few seconds through router.refresh(); no Realtime,
// the Lead Scraper discipline.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import { formatRelative } from '@/lib/format';
import { capabilityLabel, formatUsd, isActiveStatus, type StudioJob } from '@/lib/content-studio/shared';
import { cancelJobAction, retryJobAction, runNowAction } from '@/app/(app)/social/studio/actions';

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
	queued: 'default',
	submitted: 'primary',
	running: 'primary',
	done: 'success',
	failed: 'danger',
	cancelled: 'warning',
};

export function JobStatusBadge({ status }: { status: string }) {
	return (
		<Badge color={STATUS_COLOR[status] ?? 'default'}>
			<span className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-1.5', isActiveStatus(status) && 'bg-current')} />
			{status}
		</Badge>
	);
}

/** Polls while any of the given statuses is active. Use once per page. */
export function useJobPolling(active: boolean, everyMs = 5000) {
	const router = useRouter();
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => {
			if (document.visibilityState === 'visible') router.refresh();
		}, everyMs);
		return () => clearInterval(id);
	}, [active, everyMs, router]);
}

interface Props {
	job: StudioJob;
	/** Child steps in order (the video chain); each renders as a row. */
	steps?: StudioJob[];
	title?: string;
	children?: React.ReactNode;
	compact?: boolean;
}

export default function JobCard({ job, steps = [], title, children, compact }: Props) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const all = [job, ...steps];
	useJobPolling(all.some((j) => isActiveStatus(j.status)));

	function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
		setError(null);
		start(async () => {
			const res = await fn();
			if (!res.ok) setError(res.error ?? 'Something went wrong.');
			router.refresh();
		});
	}

	const total = all.reduce((s, j) => s + (j.cost_usd ?? 0), 0);

	return (
		<Card padding={compact ? 'sm' : 'md'} className="space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
						{title ?? `${capabilityLabel(job.capability)} · ${job.provider}`}
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						{formatRelative(job.created_at)} · {job.requested_via}
						{steps.length > 0 ? ` · ${steps.length + 1} steps` : ''}
					</p>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-xs text-slate-500 dark:text-slate-400">{formatUsd(total)}</span>
					{steps.length === 0 && <JobStatusBadge status={job.status} />}
				</div>
			</div>

			{steps.length > 0 && (
				<ol className="space-y-1.5">
					{all.map((s, i) => (
						<li key={s.id} className="flex items-center justify-between gap-3 text-xs">
							<span className="text-slate-600 dark:text-slate-300">
								<span className="text-slate-400 dark:text-slate-500 mr-2">{i + 1}.</span>
								{capabilityLabel(s.capability)} · {s.provider}
							</span>
							<span className="flex items-center gap-2">
								<span className="text-slate-400 dark:text-slate-500">{formatUsd(s.cost_usd)}</span>
								<JobStatusBadge status={s.status} />
								<StepActions job={s} pending={pending} onAct={act} />
							</span>
						</li>
					))}
				</ol>
			)}

			{all.some((j) => j.error) && (
				<Callout tone="error">
					{all
						.filter((j) => j.error)
						.map((j) => (
							<p key={j.id} className="text-xs">
								{steps.length > 0 ? `${capabilityLabel(j.capability)}: ` : ''}
								{j.error}
							</p>
						))}
				</Callout>
			)}
			{error && <Callout tone="error">{error}</Callout>}

			{children}

			{steps.length === 0 && (
				<div className="flex items-center gap-2">
					<StepActions job={job} pending={pending} onAct={act} />
				</div>
			)}
		</Card>
	);
}

function StepActions({ job, pending, onAct }: { job: StudioJob; pending: boolean; onAct: (fn: () => Promise<{ ok: boolean; error?: string }>) => void }) {
	if (job.status === 'queued') {
		return (
			<>
				<Button size="sm" variant="outline" disabled={pending} onClick={() => onAct(() => runNowAction(job.id))}>
					Run now
				</Button>
				<Button size="sm" variant="ghost" disabled={pending} onClick={() => onAct(() => cancelJobAction(job.id))}>
					Cancel
				</Button>
			</>
		);
	}
	if (job.status === 'submitted' || job.status === 'running') {
		return (
			<>
				<Button size="sm" variant="outline" disabled={pending} onClick={() => onAct(() => runNowAction(job.id))}>
					Check
				</Button>
				<Button size="sm" variant="ghost" disabled={pending} onClick={() => onAct(() => cancelJobAction(job.id))}>
					Cancel
				</Button>
			</>
		);
	}
	if (job.status === 'failed' || job.status === 'cancelled') {
		return (
			<Button size="sm" variant="outline" disabled={pending} onClick={() => onAct(() => retryJobAction(job.id))}>
				Retry
			</Button>
		);
	}
	return null;
}
