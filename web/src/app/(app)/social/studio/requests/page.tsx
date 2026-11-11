// /social/studio/requests: the one content request queue (0110). Sorted by
// due date with the SLA clock on every row; accept creates the studio draft
// job, deliver closes request and job together. Agent proposals
// (content_request.create over MCP) wait in their own card until a person
// files them. Members of content_reviewers and admins work it; everyone
// else is sent to their own requests page.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { getAuthProfile } from '@/lib/supabase/server';
import { listJobs } from '@/lib/content-studio/server';
import { capabilityLabel } from '@/lib/content-studio/shared';
import {
	canManageContentRequests,
	listAssigneeOptions,
	listContentRequests,
	listRequestProposals,
	textProviderOptions,
	CONTENT_REQUESTS_PATH,
	CONTENT_QUEUE_PATH,
	ASSET_TYPE_LABELS,
	isOpen,
	slaClock,
	sortQueue,
} from '@/lib/content-requests/server';
import { ProposalDecide, QueueActions, RequestMeta, RequestStatusBadge, SlaClock } from '@/components/content-requests/RequestPieces';

export const metadata = { title: 'Content request queue' };
export const dynamic = 'force-dynamic';

export default async function ContentRequestQueuePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const manager = await canManageContentRequests();
	if (!manager) redirect(CONTENT_REQUESTS_PATH);

	const { view } = await searchParams;
	const showAll = view === 'all';
	const [{ rows, notApplied, error }, proposals, assignees, jobs] = await Promise.all([
		listContentRequests(),
		listRequestProposals(),
		listAssigneeOptions(),
		listJobs({ limit: 40 }),
	]);
	const sorted = sortQueue(showAll ? rows : rows.filter((r) => isOpen(r.status)));
	const openRows = rows.filter((r) => isOpen(r.status));
	const late = openRows.filter((r) => slaClock(r).state === 'late').length;
	const waiting = openRows.filter((r) => r.status === 'requested').length;
	const options = {
		providers: textProviderOptions(),
		assignees,
		jobs: jobs.map((j) => ({ id: j.id, label: `${capabilityLabel(j.capability)} via ${j.provider} · ${j.status} · ${j.created_at.slice(0, 10)}` })),
	};

	return (
		<div className="space-y-4">
			<PageHeader
				title="Content request queue"
				description={`${openRows.length} open · ${waiting} waiting to be accepted · ${late} past their clock · ${proposals.length} agent proposals`}
				actions={
					<Link href={CONTENT_REQUESTS_PATH} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
						File a request →
					</Link>
				}
			/>

			{notApplied && <Callout tone="warning">The content request queue (migration 0110) is not applied yet. Rows appear once it is.</Callout>}
			{error && <Callout tone="error">{error}</Callout>}

			{proposals.length > 0 && (
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Proposed by agents</h3>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Nothing is filed until a person files it. Filing starts the 24 hour accept clock.</p>
					</div>
					<div className="divide-y divide-slate-200 dark:divide-slate-700">
						{proposals.map((p) => (
							<div key={p.id} className="px-4 py-3 space-y-2">
								<div className="min-w-0">
									<p className="text-sm font-medium text-slate-900 dark:text-slate-100">{p.payload.title ?? '(untitled)'}</p>
									<p className="text-xs text-slate-500 dark:text-slate-400">
										{(ASSET_TYPE_LABELS as Record<string, string>)[p.payload.asset_type ?? ''] ?? p.payload.asset_type ?? 'other'}
										{p.client_name ? ` · ${p.client_name}` : ''}
										{p.payload.due_on ? ` · due ${p.payload.due_on}` : ''}
										{` · ${p.display_name ?? p.identity_slug}`}
									</p>
									{p.reasoning && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{p.reasoning}</p>}
									{p.payload.brief && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{p.payload.brief}</p>}
								</div>
								<ProposalDecide actionId={p.id} />
							</div>
						))}
					</div>
				</Card>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<FilterChipLink href={CONTENT_QUEUE_PATH} active={!showAll}>
					Open
				</FilterChipLink>
				<FilterChipLink href={`${CONTENT_QUEUE_PATH}?view=all`} active={showAll}>
					All
				</FilterChipLink>
			</div>

			<Card padding="none">
				<div className="divide-y divide-slate-200 dark:divide-slate-700">
					{sorted.length === 0 && <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Nothing in the queue.</p>}
					{sorted.map((r) => (
						<div key={r.id} className="px-4 py-3 space-y-2">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.title}</p>
									<RequestMeta row={r} />
									{r.brief && <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap line-clamp-3">{r.brief}</p>}
									{r.decision_note && !isOpen(r.status) && <p className="text-xs text-slate-500 dark:text-slate-400">{r.decision_note}</p>}
								</div>
								<div className="flex items-center gap-2 shrink-0">
									<SlaClock row={r} />
									<RequestStatusBadge status={r.status} />
								</div>
							</div>
							<QueueActions row={r} options={options} />
						</div>
					))}
				</div>
			</Card>
		</div>
	);
}
