'use client';

// Floating chat drawer — the entry point to comms from every page (there is
// no top-level nav item for /chat by decision). A round button bottom-right
// with the unread total (polled every 30s, same no-Realtime rule as the
// page), opening a compact panel: DMs + unread conversations, then the
// shared MessageList/Composer for whichever one is picked. Hidden on /chat
// itself, where the full page already does the job.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft, ExternalLink, Hash, Lock, MessageCircle, MessageSquare, Users, X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useConversation } from '@/lib/comms/useConversation';
import { useConversationList } from '@/lib/comms/useConversationList';
import type { Conversation } from '@/lib/comms/types';
import { conversationTitle } from './ConversationHeader';
import Composer from './Composer';
import MessageList from './MessageList';

const BADGE_POLL_MS = 30_000;

function kindIcon(c: Conversation) {
	if (c.kind === 'channel') return c.is_private ? Lock : Hash;
	if (c.kind === 'group') return Users;
	return MessageSquare;
}

export default function ChatDrawer() {
	const pathname = usePathname();
	const { user } = useAuthStore();
	const [open, setOpen] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);

	const onChatPage = pathname === '/chat' || pathname.startsWith('/chat/');
	const enabled = Boolean(user) && !onChatPage;

	const list = useConversationList(BADGE_POLL_MS, enabled);
	const thread = useConversation(open ? activeId : null);

	const unreadTotal = useMemo(
		() => list.conversations.filter((c) => c.is_member).reduce((n, c) => n + c.unread_count, 0),
		[list.conversations],
	);
	const shortlist = useMemo(() => {
		const mine = list.conversations.filter((c) => c.is_member);
		const picked = mine.filter((c) => c.kind === 'dm' || c.kind === 'group' || c.unread_count > 0);
		return picked.sort((a, b) => b.unread_count - a.unread_count || (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
	}, [list.conversations]);
	const active = list.conversations.find((c) => c.id === activeId) ?? null;

	// Escape closes; when a thread is open the first Escape steps back to the list.
	useEffect(() => {
		if (!open) return;
		function onKey(e: KeyboardEvent) {
			if (e.key !== 'Escape') return;
			if (activeId) setActiveId(null);
			else setOpen(false);
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, activeId]);

	const { clearUnread, refresh } = list;
	const messageCount = thread.messages.length;
	useEffect(() => {
		if (open && activeId) clearUnread(activeId);
	}, [open, activeId, clearUnread, messageCount]);

	if (!enabled) return null;

	return (
		<>
			{open && (
				<div
					role="dialog"
					aria-label="Chat"
					className="fixed bottom-20 left-4 z-40 w-95 max-w-[calc(100vw-2rem)] h-140 max-h-[calc(100vh-6rem)] flex flex-col bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-panel overflow-hidden"
				>
					<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
						{active ? (
							<button
								type="button"
								onClick={() => setActiveId(null)}
								aria-label="Back to conversations"
								className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
							>
								<ArrowLeft className="w-4 h-4" />
							</button>
						) : (
							<MessageCircle className="w-4 h-4 text-primary-600 dark:text-primary-400" />
						)}
						<span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate flex-1">
							{active ? conversationTitle(active) : 'Chat'}
						</span>
						<Link
							href={active ? `/chat?c=${encodeURIComponent(active.id)}` : '/chat'}
							onClick={() => setOpen(false)}
							className="inline-flex items-center gap-1 text-2xs text-primary-600 dark:text-primary-400 hover:underline"
						>
							Open full page <ExternalLink className="w-3 h-3" />
						</Link>
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label="Close chat"
							className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
						>
							<X className="w-4 h-4" />
						</button>
					</div>

					{active ? (
						<>
							<MessageList messages={thread.messages} loading={thread.loading} error={thread.error} compact />
							<Composer
								participants={thread.participants}
								compact
								onSend={async (body, options) => {
									await thread.send(body, options);
									void refresh();
								}}
							/>
						</>
					) : (
						<ul className="flex-1 min-h-0 overflow-y-auto py-1">
							{!list.loaded ? (
								<li className="px-3 py-6 text-center text-xs text-slate-400">Loading…</li>
							) : shortlist.length === 0 ? (
								<li className="px-3 py-6 text-center text-xs text-slate-400">
									No unread messages or DMs.{' '}
									<Link href="/chat" onClick={() => setOpen(false)} className="text-primary-600 hover:underline">
										Browse channels
									</Link>
								</li>
							) : (
								shortlist.map((c) => {
									const Icon = kindIcon(c);
									return (
										<li key={c.id}>
											<button
												type="button"
												onClick={() => setActiveId(c.id)}
												className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/45 transition-colors"
											>
												<Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
												<span className="min-w-0 flex-1">
													<span className={clsx('block text-xs truncate', c.unread_count > 0 ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300')}>
														{conversationTitle(c)}
													</span>
													{c.last_message_preview && <span className="block text-2xs text-slate-600 dark:text-slate-400 truncate">{c.last_message_preview}</span>}
												</span>
												{c.unread_count > 0 && (
													<span className="min-w-4 h-4 px-1 rounded-full bg-primary-600 text-white text-2xs font-medium tabular-nums flex items-center justify-center shrink-0">
														{c.unread_count > 99 ? '99+' : c.unread_count}
													</span>
												)}
											</button>
										</li>
									);
								})
							)}
						</ul>
					)}
				</div>
			)}

			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label={unreadTotal > 0 ? `Chat (${unreadTotal} unread)` : 'Chat'}
				aria-expanded={open}
				className="fixed bottom-4 left-4 z-40 w-12 h-12 rounded-full bg-primary-600 text-white shadow-panel hover:bg-primary-700 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
			>
				<MessageCircle className="w-5 h-5" />
				{unreadTotal > 0 && (
					<span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-2xs font-medium tabular-nums flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
						{unreadTotal > 99 ? '99+' : unreadTotal}
					</span>
				)}
			</button>
		</>
	);
}
