'use client';

// Message list shared by /chat and the floating drawer. Groups consecutive
// messages from the same sender within 5 minutes under one header, keeps the
// view pinned to the bottom when new rows arrive (unless the reader has
// scrolled up), and renders bodies through the safe markdown renderer.

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, EyeOff, AlertTriangle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { formatRelative } from '@/lib/format';
import type { Message } from '@/lib/comms/types';
import Avatar from './Avatar';
import MarkdownBody from './MarkdownBody';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Minute-level relative time for chat; falls back to formatRelative past a day. */
export function formatChatTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(diff)) return '';
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return formatRelative(iso);
}

function senderKey(m: Message): string {
	return m.sender_participant_id ?? m.sender_agent_slug ?? m.sender_profile_id ?? (m.is_mine ? 'me' : m.sender_name ?? '?');
}

interface Group {
	key: string;
	messages: Message[];
}

function groupMessages(messages: Message[]): Group[] {
	const groups: Group[] = [];
	for (const m of messages) {
		const last = groups[groups.length - 1];
		const prev = last?.messages[last.messages.length - 1];
		const sameSender = prev && senderKey(prev) === senderKey(m);
		const close = prev && new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime() < GROUP_WINDOW_MS;
		if (last && sameSender && close && prev.visibility === m.visibility) {
			last.messages.push(m);
		} else {
			groups.push({ key: m.id, messages: [m] });
		}
	}
	return groups;
}

const PROVIDER_LABEL: Record<string, string> = {
	slack: 'Slack',
	discord: 'Discord',
	email: 'Email',
	sms: 'SMS',
	whatsapp: 'WhatsApp',
};

function providerLabel(provider: string): string {
	return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function WhyExpander({ why }: { why: unknown }) {
	const [open, setOpen] = useState(false);
	let pretty = '';
	try {
		pretty = typeof why === 'string' ? why : JSON.stringify(why, null, 2);
	} catch {
		pretty = String(why);
	}
	return (
		<div className="mt-1">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-center gap-1 text-2xs text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
			>
				{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
				why
			</button>
			{open && (
				<pre className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 text-2xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
					{pretty}
				</pre>
			)}
		</div>
	);
}

function MessageRow({ m, compact }: { m: Message; compact: boolean }) {
	const muted = m.visibility === 'staff_only' || m.payload?.failure === true;
	return (
		<div
			className={clsx(
				'group/msg relative rounded-md px-2 py-0.5 -mx-2 transition-colors',
				muted
					? 'bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
					: 'hover:bg-hover',
				m.pending && 'opacity-60',
			)}
		>
			{muted && (
				<span className="inline-flex items-center gap-1 text-2xs text-amber-700 dark:text-amber-400 mb-0.5">
					{m.payload?.failure ? <AlertTriangle className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
					{m.payload?.failure ? 'failed' : 'staff only'}
				</span>
			)}
			<MarkdownBody body={m.body} className={clsx(compact ? 'text-xs' : 'text-sm', !muted && 'text-slate-800 dark:text-slate-200')} />
			{m.payload?.why !== undefined && m.payload?.why !== null && <WhyExpander why={m.payload.why} />}
		</div>
	);
}

interface MessageListProps {
	messages: Message[];
	loading: boolean;
	error?: string | null;
	/** Drawer mode: tighter type and spacing. */
	compact?: boolean;
	emptyText?: string;
}

export default function MessageList({ messages, loading, error, compact = false, emptyText }: MessageListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);

	function onScroll() {
		const el = scrollRef.current;
		if (!el) return;
		stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
	}

	// Pin to the newest message unless the reader scrolled up to read history.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !stickToBottom.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messages]);

	const groups = groupMessages(messages);

	return (
		<div ref={scrollRef} onScroll={onScroll} className={clsx('flex-1 min-h-0 overflow-y-auto', compact ? 'px-3 py-2' : 'px-5 py-4')}>
			{loading && messages.length === 0 ? (
				<SkeletonRows rows={6} />
			) : error && messages.length === 0 ? (
				<p className="text-xs text-red-600 dark:text-red-400">{error}</p>
			) : groups.length === 0 ? (
				<p className="text-xs text-slate-400 text-center py-8">{emptyText ?? 'No messages yet. Say hello.'}</p>
			) : (
				<div className={compact ? 'space-y-3' : 'space-y-4'}>
					{groups.map((g) => {
						const first = g.messages[0];
						const isAgent = first.sender_type === 'agent';
						const external = first.provider && first.provider !== 'openronin';
						return (
							<div key={g.key} className="flex gap-2.5">
								<Avatar name={first.sender_name} url={first.sender_avatar_url} isAgent={isAgent} size={compact ? 'sm' : 'md'} className="mt-0.5" />
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline gap-1.5 flex-wrap">
										<span className={clsx('font-medium text-slate-900 dark:text-slate-100', compact ? 'text-xs' : 'text-sm')}>
											{first.sender_name ?? (first.is_mine ? 'You' : 'Unknown')}
										</span>
										{isAgent && <Badge color="accent" className="text-2xs px-1.5 py-0">AI</Badge>}
										{external && <Badge className="text-2xs px-1.5 py-0">{providerLabel(first.provider)}</Badge>}
										<span className="text-2xs text-slate-600 dark:text-slate-400" title={new Date(first.sent_at).toLocaleString()}>
											{formatChatTime(first.sent_at)}
										</span>
									</div>
									<div className="space-y-0.5 mt-0.5">
										{g.messages.map((m) => (
											<MessageRow key={m.id} m={m} compact={compact} />
										))}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
