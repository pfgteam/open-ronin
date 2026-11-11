'use client';

// Conversation list with the same polling rules as useConversation (no
// Realtime): every LIST_POLL_MS while the tab is visible, plus an immediate
// tick when the tab becomes visible again. `refresh` is exposed so a send,
// join, or create can pull the list straight away.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listConversations } from './client';
import type { Conversation } from './types';

export function useConversationList(pollMs: number, enabled = true) {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inFlight = useRef(false);

	const refresh = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		try {
			const rows = await listConversations();
			setConversations(rows);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not load conversations');
		} finally {
			inFlight.current = false;
			setLoaded(true);
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		void refresh();
		const timer = setInterval(() => {
			if (!document.hidden) void refresh();
		}, pollMs);
		function onVisible() {
			if (!document.hidden) void refresh();
		}
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [enabled, pollMs, refresh]);

	/** Zero a conversation's unread count locally (after mark-read) so the badge drops without waiting for the next poll. */
	const clearUnread = useCallback((id: string) => {
		setConversations((prev) => prev.map((c) => (c.id === id && c.unread_count > 0 ? { ...c, unread_count: 0 } : c)));
	}, []);

	return { conversations, loaded, error, refresh, clearUnread };
}
