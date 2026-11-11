'use client';

// Global toast system with Undo support (Linear-style). Mounted once in
// AppLayout via <ToastProvider>. Any client component can call:
//
//   const { toast } = useToast();
//   toast({ message: 'Archived', undo: async () => { …revert… } });
//
// Design decisions:
// - Bottom-center stack, max 4 visible, auto-dismiss after 5s (paused on hover).
// - `undo` replaces confirm() dialogs: do the action immediately, offer a
//   window to take it back — faster than asking permission upfront.
// - Destructive-feeling actions (archive) use the Gmail pattern via
//   `undoWindow()`: a 10s Undo toast, then a small confirmation once the
//   window closes and the action is final, or "Action undone" if Undo was hit.
// - No portal lib needed; fixed overlay matches the drawer/modal pattern
//   already used across the app.

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Undo2, X, CheckCircle2, AlertTriangle } from 'lucide-react';

/** Undo window for archive-style actions (Alex, 2026-09-14: 10 seconds). */
export const UNDO_WINDOW_MS = 10_000;
/** How long the post-window confirmation bubble stays up. */
const CONFIRM_MS = 2_500;

export interface ToastOptions {
	message: string;
	variant?: 'default' | 'success' | 'error';
	/** When set, renders an Undo button. Called at most once; toast dismisses after. */
	undo?: () => void | Promise<unknown>;
	/** Auto-dismiss delay in ms. 0 = sticky. Default 5000. */
	duration?: number;
	/**
	 * Fires once when the toast leaves the screen WITHOUT Undo being clicked
	 * (timer ran out, X clicked, or evicted by newer toasts) — i.e. the action
	 * it described is now final. Not called after Undo.
	 */
	onCommit?: () => void;
	/** Shown as a short confirmation after a successful Undo. */
	undoneMessage?: string;
}

/** Options for the Gmail-style archive/undo pattern. */
export interface UndoWindowOptions {
	message: string;
	undo: () => void | Promise<unknown>;
	/** Confirmation copy once the window closes and the action is final. */
	committedMessage: string;
	/** Confirmation copy after Undo. Default "Action undone". */
	undoneMessage?: string;
	/** Override the window length; defaults to UNDO_WINDOW_MS. */
	duration?: number;
}

interface ToastItem extends ToastOptions {
	id: number;
}

interface ToastContextValue {
	toast: (options: ToastOptions) => void;
	/**
	 * Undo-window toast: shows `message` with an Undo button for
	 * UNDO_WINDOW_MS, then a small `committedMessage` confirmation when the
	 * window closes untouched, or `undoneMessage` after Undo.
	 */
	undoWindow: (options: UndoWindowOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
	return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<ToastItem[]>([]);
	const nextId = useRef(1);
	const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
	// Items whose Undo was clicked — their onCommit must not fire on removal.
	const undone = useRef(new Set<number>());

	const clearTimer = useCallback((id: number) => {
		const t = timers.current.get(id);
		if (t) { clearTimeout(t); timers.current.delete(id); }
	}, []);

	// Remove a toast from the stack. `committed` = it left without Undo, so
	// its onCommit hook (if any) fires exactly once.
	const remove = useCallback((id: number, committed: boolean) => {
		clearTimer(id);
		setToasts((list) => {
			const item = list.find((x) => x.id === id);
			if (item && committed && !undone.current.has(id)) {
				// Defer so we never call setState (a follow-up toast) mid-updater.
				const hook = item.onCommit;
				if (hook) setTimeout(hook, 0);
			}
			undone.current.delete(id);
			return list.filter((x) => x.id !== id);
		});
	}, [clearTimer]);

	const dismiss = useCallback((id: number) => remove(id, true), [remove]);

	const scheduleDismiss = useCallback((id: number, ms: number) => {
		if (ms <= 0) return;
		clearTimer(id);
		timers.current.set(id, setTimeout(() => dismiss(id), ms));
	}, [clearTimer, dismiss]);

	const toast = useCallback((options: ToastOptions) => {
		const id = nextId.current++;
		setToasts((list) => {
			// Max 4 on screen; anything evicted is treated as committed.
			const evicted = list.slice(0, Math.max(0, list.length - 3));
			for (const e of evicted) {
				clearTimer(e.id);
				if (e.onCommit && !undone.current.has(e.id)) setTimeout(e.onCommit, 0);
				undone.current.delete(e.id);
			}
			return [...list.slice(-3), { ...options, id }];
		});
		scheduleDismiss(id, options.duration ?? 5000);
	}, [clearTimer, scheduleDismiss]);

	const undoWindow = useCallback((o: UndoWindowOptions) => {
		toast({
			message: o.message,
			undo: o.undo,
			duration: o.duration ?? UNDO_WINDOW_MS,
			undoneMessage: o.undoneMessage ?? 'Action undone',
			onCommit: () => toast({ message: o.committedMessage, variant: 'success', duration: CONFIRM_MS }),
		});
	}, [toast]);

	async function handleUndo(item: ToastItem) {
		undone.current.add(item.id);
		remove(item.id, false);
		try {
			await item.undo?.();
			if (item.undoneMessage) toast({ message: item.undoneMessage, duration: CONFIRM_MS });
		} catch {
			// Undo itself failed — surface it, nothing more we can do.
			toast({ message: 'Could not undo that action.', variant: 'error' });
		}
	}

	return (
		<ToastContext.Provider value={{ toast, undoWindow }}>
			{children}
			{toasts.length > 0 && (
				<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-full max-w-md px-4 pointer-events-none">
					{toasts.map((t) => (
						<div
							key={t.id}
							onMouseEnter={() => clearTimer(t.id)}
							onMouseLeave={() => scheduleDismiss(t.id, t.undo ? Math.min(t.duration ?? 5000, 4000) : 2000)}
							className="pointer-events-auto w-full flex items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-900 dark:bg-slate-800 dark:border-slate-600 text-slate-100 shadow-panel px-3.5 py-2.5 text-sm"
							role="status"
						>
							{t.variant === 'error' ? (
								<AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
							) : (
								<CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
							)}
							<span className="flex-1 min-w-0 truncate">{t.message}</span>
							{t.undo && (
								<button
									type="button"
									onClick={() => handleUndo(t)}
									className="inline-flex items-center gap-1 text-xs font-medium text-slate-100 bg-slate-700/70 hover:bg-slate-600 rounded-md px-2 py-1 shrink-0 transition-colors"
								>
									<Undo2 className="w-3 h-3" /> Undo
								</button>
							)}
							<button
								type="button"
								onClick={() => dismiss(t.id)}
								className="text-slate-400 hover:text-slate-200 shrink-0 transition-colors"
								aria-label="Dismiss"
							>
								<X className="w-3.5 h-3.5" />
							</button>
						</div>
					))}
				</div>
			)}
		</ToastContext.Provider>
	);
}
