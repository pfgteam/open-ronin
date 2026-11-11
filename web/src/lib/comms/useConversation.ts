'use client';

// useConversation — messages + participants for one conversation.
//
// POLLING, NOT REALTIME. MIGRATION_READINESS.md lists Supabase Realtime as
// off-limits ("no subscriptions in the app"), so this hook polls instead:
//   - messages every 4s while the conversation is open, fetching only rows
//     with sent_at > the newest row we hold (cheap: an indexed range scan
//     that returns nothing most ticks);
//   - paused while document.hidden (no point burning requests on a
//     background tab) and resumed with an immediate tick on visibilitychange.
// The conversation list polls separately (20s) in the page/drawer.
//
// Sending is optimistic: the row is appended with a temp id, the RPC runs,
// then an incremental fetch replaces the placeholder with the server row.
// Mark-read fires on open and whenever new rows arrive while visible.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
	listMessages,
	listMessagesAfter,
	listParticipants,
	markRead,
	sendMessage,
} from './client';
import type { Message, MessageVisibility, Participant } from './types';

export const MESSAGE_POLL_MS = 4000;

export interface SendOptions {
	visibility?: MessageVisibility;
	mentions?: string[] | null;
}

export interface ConversationState {
	messages: Message[];
	participants: Participant[];
	loading: boolean;
	error: string | null;
	send: (body: string, options?: SendOptions) => Promise<void>;
	refresh: () => Promise<void>;
	refreshParticipants: () => Promise<void>;
}

function mergeMessages(prev: Message[], incoming: Message[]): Message[] {
	if (incoming.length === 0) return prev;
	const seen = new Set(prev.filter((m) => !m.pending).map((m) => m.id));
	const fresh = incoming.filter((m) => !seen.has(m.id));
	if (fresh.length === 0) return prev;
	// Drop optimistic rows that the server has now echoed back (matched by
	// body + mine), then append and keep chronological order.
	const freshBodies = new Set(fresh.filter((m) => m.is_mine).map((m) => m.body));
	const kept = prev.filter((m) => !(m.pending && freshBodies.has(m.body)));
	return [...kept, ...fresh].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}

export function useConversation(conversationId: string | null): ConversationState {
	const [messages, setMessages] = useState<Message[]>([]);
	const [participants, setParticipants] = useState<Participant[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Newest server sent_at we hold — the cursor for incremental polls.
	const cursorRef = useRef<string | null>(null);
	const activeIdRef = useRef<string | null>(conversationId);
	const inFlightRef = useRef(false);

	const refreshParticipants = useCallback(async () => {
		if (!conversationId) return;
		try {
			const rows = await listParticipants(conversationId);
			if (activeIdRef.current === conversationId) setParticipants(rows);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not load participants');
		}
	}, [conversationId]);

	// Fetch rows newer than the cursor and merge them in.
	const fetchIncremental = useCallback(async () => {
		if (!conversationId) return;
		try {
			const cursor = cursorRef.current;
			const rows = cursor ? await listMessagesAfter(conversationId, cursor) : await listMessages(conversationId);
			if (activeIdRef.current !== conversationId) return;
			if (rows.length > 0) {
				cursorRef.current = rows[rows.length - 1].sent_at;
				setMessages((prev) => mergeMessages(prev, rows));
				if (rows.some((m) => !m.is_mine)) void markRead(conversationId);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not load messages');
		}
	}, [conversationId]);

	// Poll tick. Guarded so a slow response never overlaps the next one, and
	// skipped entirely on hidden tabs.
	const poll = useCallback(async () => {
		if (!conversationId || inFlightRef.current) return;
		if (typeof document !== 'undefined' && document.hidden) return;
		inFlightRef.current = true;
		try {
			await fetchIncremental();
		} finally {
			inFlightRef.current = false;
		}
	}, [conversationId, fetchIncremental]);

	// Full reload — used on open and after a send to reconcile.
	const refresh = useCallback(async () => {
		if (!conversationId) return;
		try {
			const rows = await listMessages(conversationId);
			if (activeIdRef.current !== conversationId) return;
			cursorRef.current = rows.length > 0 ? rows[rows.length - 1].sent_at : null;
			setMessages(rows);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not load messages');
		}
	}, [conversationId]);

	// Open: reset, load everything, mark read.
	useEffect(() => {
		activeIdRef.current = conversationId;
		cursorRef.current = null;
		setMessages([]);
		setParticipants([]);
		setError(null);
		if (!conversationId) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		void (async () => {
			try {
				const [rows, people] = await Promise.all([listMessages(conversationId), listParticipants(conversationId)]);
				if (cancelled) return;
				cursorRef.current = rows.length > 0 ? rows[rows.length - 1].sent_at : null;
				setMessages(rows);
				setParticipants(people);
				void markRead(conversationId);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load conversation');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [conversationId]);

	// Poll loop, paused on hidden tabs.
	useEffect(() => {
		if (!conversationId) return;
		const timer = setInterval(() => void poll(), MESSAGE_POLL_MS);
		function onVisible() {
			if (!document.hidden) void poll();
		}
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [conversationId, poll]);

	const send = useCallback(
		async (body: string, options: SendOptions = {}) => {
			if (!conversationId) return;
			const trimmed = body.trim();
			if (!trimmed) return;
			const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const optimistic: Message = {
				id: tempId,
				conversation_id: conversationId,
				sender_participant_id: null,
				connection_id: null,
				body: trimmed,
				body_format: 'markdown',
				payload: null,
				direction: 'outbound',
				visibility: options.visibility ?? 'all',
				provider: 'openronin',
				provider_message_id: null,
				in_reply_to_message_id: null,
				attachments: null,
				sent_at: new Date().toISOString(),
				edited_at: null,
				deleted_at: null,
				sender_type: 'user',
				sender_profile_id: null,
				sender_agent_slug: null,
				sender_name: 'You',
				sender_avatar_url: null,
				is_mine: true,
				pending: true,
			};
			setMessages((prev) => [...prev, optimistic]);
			try {
				await sendMessage({
					conversationId,
					body: trimmed,
					visibility: options.visibility ?? 'all',
					mentions: options.mentions ?? null,
				});
				// Reconcile: pull anything newer than our cursor (includes the
				// row we just wrote) and let mergeMessages retire the placeholder.
				await fetchIncremental();
				setMessages((prev) => prev.filter((m) => m.id !== tempId));
			} catch (e) {
				setMessages((prev) => prev.filter((m) => m.id !== tempId));
				setError(e instanceof Error ? e.message : 'Could not send message');
				throw e;
			}
		},
		[conversationId, fetchIncremental],
	);

	return { messages, participants, loading, error, send, refresh, refreshParticipants };
}
