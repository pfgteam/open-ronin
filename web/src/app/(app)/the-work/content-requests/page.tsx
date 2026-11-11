// /the-work/content-requests: file a content request and watch it move
// (0110, BOT_ROSTER_SYNTHESIS Tier A #5). Sits next to the Innovation Desk:
// same shape (a form on top, my rows below), different engine. The queue
// that works the requests is /social/studio/requests.

import Link from 'next/link';
import { Clapperboard } from 'lucide-react';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import { getAuthProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { listClientOptions } from '@/lib/content-studio/server';
import { canManageContentRequests, listContentRequests, CONTENT_QUEUE_PATH, sortQueue } from '@/lib/content-requests/server';
import { FileRequestForm, RequestMeta, RequestStatusBadge, SlaClock, WithdrawButton } from '@/components/content-requests/RequestPieces';

export const metadata = { title: 'Content Requests' };
export const dynamic = 'force-dynamic';

export default async function ContentRequestsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
	// ?client=<clients_v2.id> prefills the form (+ New › Request › Content from a client page).
	const { client: prefillClient } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');

	const [{ rows, notApplied, error }, clients, manager] = await Promise.all([listContentRequests(), listClientOptions(), canManageContentRequests()]);
	const mine = sortQueue(rows.filter((r) => r.requester_id === profile.id));
	const open = mine.filter((r) => ['requested', 'accepted', 'in_studio'].includes(r.status)).length;

	return (
		<div className="space-y-4">
			<PageHeader
				title="Content Requests"
				description="Ask the content team for a post, video, clip, thumbnail or podcast episode. The queue accepts within 24 hours and the Content Studio drafts from your brief."
				actions={
					manager ? (
						<Link href={CONTENT_QUEUE_PATH} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
							Work the queue →
						</Link>
					) : null
				}
			/>

			{notApplied && (
				<Callout tone="warning">
					The content request queue (migration 0110) is not applied yet. The form appears now; filing will be refused until it is.
				</Callout>
			)}
			{error && <Callout tone="error">{error}</Callout>}

			<Card>
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
					<Clapperboard className="w-4 h-4 text-slate-400" />
					New request
				</h3>
				<FileRequestForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} defaultClientId={prefillClient ?? null} />
			</Card>

			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">My requests</h3>
					<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{mine.length === 0 ? 'Nothing filed yet.' : `${open} open · ${mine.length - open} closed`}</p>
				</div>
				<div className="divide-y divide-slate-100 dark:divide-slate-700/60">
					{mine.map((r) => (
						<div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{r.title}</p>
								<RequestMeta row={r} showRequester={false} />
								{r.decision_note && <p className="text-xs text-slate-600 dark:text-slate-400">{r.decision_note}</p>}
							</div>
							<div className="flex items-center gap-2 shrink-0">
								<SlaClock row={r} />
								<RequestStatusBadge status={r.status} />
								<WithdrawButton row={r} />
							</div>
						</div>
					))}
				</div>
			</Card>
		</div>
	);
}
