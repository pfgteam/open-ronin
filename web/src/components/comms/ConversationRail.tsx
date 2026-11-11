'use client';

// Left rail of /chat. Team is live (channels, DMs, browse/join); Clients and
// Outreach are Phase 2/3 placeholders so the rail's final shape is visible now.

import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, Compass, Hash, Inbox, Lock, MessageSquare, Plus, Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { joinConversation } from '@/lib/comms/client';
import type { Conversation } from '@/lib/comms/types';
import { conversationTitle } from './ConversationHeader';

interface Props {
	conversations: Conversation[];
	loaded: boolean;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onNew: (mode: 'channel' | 'dm') => void;
	onJoined: () => void;
}

function UnreadBadge({ count }: { count: number }) {
	if (count <= 0) return null;
	return (
		<span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-primary-600 text-white text-2xs font-medium tabular-nums flex items-center justify-center shrink-0">
			{count > 99 ? '99+' : count}
		</span>
	);
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between px-3 pt-4 pb-1">
			<span className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{children}</span>
			{action}
		</div>
	);
}

function Row({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
	const isChannel = c.kind === 'channel';
	const Icon = isChannel ? (c.is_private ? Lock : Hash) : c.kind === 'group' ? Users : MessageSquare;
	const bold = c.unread_count > 0;
	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				className={clsx(
					'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
					active
						? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
						: 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45',
				)}
			>
				<Icon className={clsx('w-3.5 h-3.5 shrink-0', active ? 'text-primary-500' : 'text-slate-400')} />
				<span className={clsx('truncate', bold && 'font-semibold text-slate-900 dark:text-slate-100')}>{conversationTitle(c)}</span>
				<UnreadBadge count={c.unread_count} />
			</button>
		</li>
	);
}

export default function ConversationRail({ conversations, loaded, selectedId, onSelect, onNew, onJoined }: Props) {
	const [browse, setBrowse] = useState(false);
	const [joining, setJoining] = useState<string | null>(null);

	const mine = conversations.filter((c) => c.is_member);
	const inbox = mine.filter((c) => c.unread_count > 0).sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
	const channels = mine.filter((c) => c.kind === 'channel' && c.audience === 'internal').sort((a, b) => conversationTitle(a).localeCompare(conversationTitle(b)));
	const dms = mine.filter((c) => c.kind === 'dm' || c.kind === 'group');
	const browseable = conversations.filter((c) => !c.is_member && c.kind === 'channel' && !c.is_private);
	const inboxTotal = inbox.reduce((n, c) => n + c.unread_count, 0);

	async function join(id: string) {
		setJoining(id);
		try {
			await joinConversation(id);
			onJoined();
			onSelect(id);
		} finally {
			setJoining(null);
		}
	}

	const newButton = (mode: 'channel' | 'dm', label: string) => (
		<button
			type="button"
			onClick={() => onNew(mode)}
			aria-label={label}
			title={label}
			className="p-0.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
		>
			<Plus className="w-3.5 h-3.5" />
		</button>
	);

	return (
		<nav className="h-full overflow-y-auto pb-4" aria-label="Conversations">
			<div className="px-3 pt-3">
				<button
					type="button"
					onClick={() => inbox[0] && onSelect(inbox[0].id)}
					className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors"
				>
					<Inbox className="w-4 h-4 text-slate-400" />
					My Inbox
					<UnreadBadge count={inboxTotal} />
				</button>
				{inbox.length > 0 && (
					<ul className="mt-0.5 border-l border-slate-200 dark:border-slate-700 ml-4">
						{inbox.slice(0, 8).map((c) => (
							<Row key={`inbox-${c.id}`} c={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
						))}
					</ul>
				)}
			</div>

			<SectionLabel>Team</SectionLabel>
			{!loaded ? (
				<div className="px-3">
					<SkeletonRows rows={5} />
				</div>
			) : (
				<>
					<div className="flex items-center justify-between px-3 pt-1">
						<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Channels</span>
						{newButton('channel', 'New channel')}
					</div>
					<ul>
						{channels.map((c) => (
							<Row key={c.id} c={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
						))}
						{channels.length === 0 && <li className="px-3 py-1.5 text-xs text-slate-400">No channels yet.</li>}
					</ul>
					{browseable.length > 0 && (
						<div className="px-3 pt-1">
							<button
								type="button"
								onClick={() => setBrowse((v) => !v)}
								className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
							>
								{browse ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
								<Compass className="w-3 h-3" /> Browse channels ({browseable.length})
							</button>
							{browse && (
								<ul className="mt-1 space-y-0.5">
									{browseable.map((c) => (
										<li key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/45 transition-colors">
											<Hash className="w-3 h-3 text-slate-400 shrink-0" />
											<button type="button" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 text-left">
												<span className="block text-xs text-slate-700 dark:text-slate-300 truncate">{conversationTitle(c)}</span>
												<span className="block text-2xs text-slate-600 dark:text-slate-400 tabular-nums">{c.participant_count} members</span>
											</button>
											<Button size="sm" variant="outline" loading={joining === c.id} onClick={() => void join(c.id)}>
												Join
											</Button>
										</li>
									))}
								</ul>
							)}
						</div>
					)}

					<div className="flex items-center justify-between px-3 pt-3">
						<span className="text-xs font-medium text-slate-600 dark:text-slate-400">Direct messages</span>
						{newButton('dm', 'New DM')}
					</div>
					<ul>
						{dms.map((c) => (
							<Row key={c.id} c={c} active={c.id === selectedId} onClick={() => onSelect(c.id)} />
						))}
						{dms.length === 0 && <li className="px-3 py-1.5 text-xs text-slate-400">No direct messages yet.</li>}
					</ul>
				</>
			)}

			<SectionLabel>Clients</SectionLabel>
			<p className="px-3 text-xs text-slate-400">Client threads arrive in Phase 2.</p>

			<SectionLabel>Outreach</SectionLabel>
			<p className="px-3 text-xs text-slate-400">Phase 3.</p>
		</nav>
	);
}
