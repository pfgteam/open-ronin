'use client';

// The bell — in-app notification inbox (migration 0039).
//
// Client component with its own fetch: the header is client-side already, so
// the browser client is the right tool. The query filters by the viewer
// EXPLICITLY rather than leaning on RLS alone — see the comment on load().
// First sender is the weekly check-in reminder; THE_WORK_PLAN 9.4 wants the
// same bell for assigned / mentioned / overdue, hence the generic shape
// (kind + title + body + href).
//
// hrefs are relative by database CHECK (0039) — the bell must not become a
// redirect vector.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth';
import { formatRelative } from '@/lib/format';
import Popover from '@/components/ui/Popover';

interface Notification {
	id: string;
	kind: string;
	title: string;
	body: string | null;
	href: string | null;
	read_at: string | null;
	created_at: string;
}

const RECENT_LIMIT = 20;

export default function NotificationBell() {
	const { user } = useAuthStore();
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<Notification[]>([]);
	const [loaded, setLoaded] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// Defense in depth: filter by the viewer explicitly instead of trusting RLS
	// alone. 0039 shipped a `FOR ALL USING (is_admin())` policy, and because RLS
	// policies are OR-ed, every admin's bell showed the whole company's inbox
	// (fixed in 0040). One permissive policy should not be able to do that again.
	const load = useCallback(async () => {
		if (!user?.id) return;
		const supabase = createClient();
		const { data } = await supabase
			.from('notifications')
			.select('id, kind, title, body, href, read_at, created_at')
			.eq('user_id', user.id)
			.order('created_at', { ascending: false })
			.limit(RECENT_LIMIT);
		setItems((data ?? []) as Notification[]);
		setLoaded(true);
	}, [user?.id]);

	useEffect(() => {
		void load();
	}, [load]);

	const unread = items.filter((n) => !n.read_at);

	async function markRead(ids: string[]) {
		if (ids.length === 0 || !user?.id) return;
		const now = new Date().toISOString();
		// Optimistic: the row is the user's own, RLS allows the update, and a
		// failure only means the badge reappears on the next load.
		setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
		const supabase = createClient();
		await supabase.from('notifications').update({ read_at: now }).in('id', ids).eq('user_id', user.id);
	}

	return (
		<div>
			<button
				ref={buttonRef}
				onClick={() => {
					setOpen(!open);
					if (!open) void load();
				}}
				className="relative p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition-colors"
				aria-label={unread.length > 0 ? `Notifications (${unread.length} unread)` : 'Notifications'}
			>
				<Bell className="w-4 h-4" />
				{unread.length > 0 && (
					<span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary-600 text-white text-2xs font-medium tabular-nums flex items-center justify-center">
						{unread.length > 9 ? '9+' : unread.length}
					</span>
				)}
			</button>

			<Popover open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} placement="bottom-end" width="w-80">
				<div className="py-1 max-h-96 overflow-y-auto">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<span className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
							Notifications
						</span>
						{unread.length > 0 && (
							<button
								onClick={() => void markRead(unread.map((n) => n.id))}
								className="text-2xs text-primary-600 hover:underline"
							>
								Mark all read
							</button>
						)}
					</div>

					{!loaded ? (
						<p className="px-3 py-6 text-center text-xs text-slate-400">Loading…</p>
					) : items.length === 0 ? (
						<p className="px-3 py-6 text-center text-xs text-slate-400">Nothing yet.</p>
					) : (
						<ul>
							{items.map((n) => {
								const row = (
									<>
										<div className="flex items-start gap-2">
											{!n.read_at && (
												<span className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 shrink-0" />
											)}
											<div className={n.read_at ? 'pl-3.5' : ''}>
												<p className="text-xs font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
												{n.body && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">{n.body}</p>}
												<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">{formatRelative(n.created_at)}</p>
											</div>
										</div>
									</>
								);
								return (
									<li key={n.id} className="border-b border-slate-50 dark:border-slate-700/40 last:border-0">
										{n.href ? (
											<Link
												href={n.href}
												onClick={() => {
													void markRead([n.id]);
													setOpen(false);
												}}
												className="block px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
											>
												{row}
											</Link>
										) : (
											<button
												onClick={() => void markRead([n.id])}
												className="block w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
											>
												{row}
											</button>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</Popover>
		</div>
	);
}
