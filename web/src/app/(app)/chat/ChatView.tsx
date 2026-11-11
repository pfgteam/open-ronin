'use client';

// /chat — three-pane team chat. Rail (conversations) · thread · nothing else
// yet (a right-side details pane is Phase 2). Selection lives in ?c= so a
// conversation is deep-linkable and the drawer's "Open full page" lands on
// the right thread.
//
// Height: AppLayout's <main> is the scroll container (100vh - 3.5rem TopNav)
// and wraps children in p-6, so the page pins itself to
// calc(100vh - 3.5rem - 3rem) and scrolls the rail and the message list
// internally — no double scrollbar.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Composer from '@/components/comms/Composer';
import ConversationHeader from '@/components/comms/ConversationHeader';
import ConversationRail from '@/components/comms/ConversationRail';
import MessageList from '@/components/comms/MessageList';
import NewConversationModal from '@/components/comms/NewConversationModal';
import { useConversation } from '@/lib/comms/useConversation';
import { useConversationList } from '@/lib/comms/useConversationList';

const LIST_POLL_MS = 20_000;

export default function ChatView() {
	const router = useRouter();
	const params = useSearchParams();
	const selectedId = params.get('c');
	const [modal, setModal] = useState<'channel' | 'dm' | null>(null);

	const list = useConversationList(LIST_POLL_MS);
	const thread = useConversation(selectedId);

	const selected = useMemo(() => list.conversations.find((c) => c.id === selectedId) ?? null, [list.conversations, selectedId]);

	const select = useCallback(
		(id: string) => {
			router.replace(`/chat?c=${encodeURIComponent(id)}`, { scroll: false });
		},
		[router],
	);

	// Opening a thread marks it read server-side (in the hook); mirror that
	// in the list so the rail badge drops immediately. Re-runs when new rows
	// land because the hook marks those read too.
	const { clearUnread, refresh: refreshList } = list;
	const messageCount = thread.messages.length;
	useEffect(() => {
		if (selectedId) clearUnread(selectedId);
	}, [selectedId, clearUnread, messageCount]);

	// Nothing selected yet: land on the first unread, else the first channel.
	useEffect(() => {
		if (selectedId || !list.loaded) return;
		const mine = list.conversations.filter((c) => c.is_member);
		const first = mine.find((c) => c.unread_count > 0) ?? mine.find((c) => c.kind === 'channel') ?? mine[0];
		if (first) select(first.id);
	}, [selectedId, list.loaded, list.conversations, select]);

	const { refreshParticipants, send } = thread;

	async function handleSend(body: string, options: { visibility: 'all' | 'staff_only'; mentions: string[] | null }) {
		await send(body, options);
		void refreshList();
	}

	return (
		// 5.5rem = TopNav h-12 (3rem) + AppLayout py-5 (2 × 1.25rem). Keep in
		// sync with both if the shell changes again (reskin 1/n broke 6.5rem).
		<div className="h-[calc(100vh-5.5rem)] min-h-96">
			<Card padding="none" className="h-full flex overflow-hidden">
				<aside className="w-70 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 min-h-0">
					<ConversationRail
						conversations={list.conversations}
						loaded={list.loaded}
						selectedId={selectedId}
						onSelect={select}
						onNew={setModal}
						onJoined={() => void refreshList()}
					/>
				</aside>

				<section className="flex-1 min-w-0 min-h-0 flex flex-col">
					{selected ? (
						<>
							<ConversationHeader
								conversation={selected}
								participants={thread.participants}
								onMembershipChange={() => {
									void refreshList();
									void refreshParticipants();
								}}
							/>
							<MessageList messages={thread.messages} loading={thread.loading} error={thread.error} />
							{selected.is_member ? (
								<Composer participants={thread.participants} onSend={handleSend} />
							) : (
								<p className="shrink-0 border-t border-slate-200 dark:border-slate-700 px-5 py-3 text-xs text-slate-500">
									You&apos;re previewing this channel. Join to post.
								</p>
							)}
						</>
					) : selectedId && list.loaded ? (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
							<MessageCircle className="w-8 h-8" />
							<p className="text-sm">That conversation isn&apos;t available.</p>
						</div>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
							<MessageCircle className="w-8 h-8" />
							<p className="text-sm">{list.loaded ? 'Pick a conversation or start one.' : 'Loading…'}</p>
						</div>
					)}
				</section>
			</Card>

			{modal && (
				<NewConversationModal
					mode={modal}
					onClose={() => setModal(null)}
					onCreated={(id) => {
						setModal(null);
						void refreshList();
						select(id);
					}}
				/>
			)}
		</div>
	);
}
