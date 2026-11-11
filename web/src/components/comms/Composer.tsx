'use client';

// Composer shared by /chat and the drawer. Enter sends, Shift+Enter inserts
// a newline. Typing `@` opens an inline picker listing the conversation's
// participants (agents first, marked with a Bot icon); picking an agent
// inserts `@slug ` and records the slug so comms_send_message gets an
// explicit mention rather than relying on body parsing. Picking a human
// inserts `@Name ` — the DB resolves human mentions itself.
//
// The "staff only" toggle tints the whole composer amber so it is obvious
// the message will be hidden from client/external participants.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Bot, EyeOff, SendHorizontal } from 'lucide-react';
import type { MessageVisibility, Participant } from '@/lib/comms/types';
import Avatar from './Avatar';

interface ComposerProps {
	participants: Participant[];
	onSend: (body: string, options: { visibility: MessageVisibility; mentions: string[] | null }) => Promise<void>;
	disabled?: boolean;
	placeholder?: string;
	compact?: boolean;
	/** Only internal conversations can carry staff-only messages that mean anything. */
	allowStaffOnly?: boolean;
}

interface MentionCandidate {
	key: string;
	label: string;
	insert: string;
	slug: string | null;
	isAgent: boolean;
	avatarUrl: string | null;
}

function candidatesFrom(participants: Participant[]): MentionCandidate[] {
	const out: MentionCandidate[] = [];
	for (const p of participants) {
		if (p.left_at) continue;
		if (p.participant_type === 'agent' && p.agent_identity_slug) {
			out.push({
				key: p.id,
				label: p.display_name ?? p.agent_identity_slug,
				insert: `@${p.agent_identity_slug} `,
				slug: p.agent_identity_slug,
				isAgent: true,
				avatarUrl: p.avatar_url,
			});
		} else if (p.participant_type === 'user' && p.display_name) {
			out.push({ key: p.id, label: p.display_name, insert: `@${p.display_name} `, slug: null, isAgent: false, avatarUrl: p.avatar_url });
		}
	}
	// Agents first, then people alphabetically.
	return out.sort((a, b) => Number(b.isAgent) - Number(a.isAgent) || a.label.localeCompare(b.label));
}

export default function Composer({ participants, onSend, disabled, placeholder, compact = false, allowStaffOnly = true }: ComposerProps) {
	const [value, setValue] = useState('');
	const [staffOnly, setStaffOnly] = useState(false);
	const [sending, setSending] = useState(false);
	const [mentions, setMentions] = useState<string[]>([]);
	const [mentionQuery, setMentionQuery] = useState<{ start: number; text: string } | null>(null);
	const [highlight, setHighlight] = useState(0);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const candidates = useMemo(() => candidatesFrom(participants), [participants]);
	const matches = useMemo(() => {
		if (!mentionQuery) return [];
		const q = mentionQuery.text.toLowerCase();
		return candidates.filter((c) => c.label.toLowerCase().includes(q) || (c.slug ?? '').toLowerCase().includes(q)).slice(0, 8);
	}, [candidates, mentionQuery]);

	useEffect(() => setHighlight(0), [mentionQuery?.text]);

	// Auto-grow up to ~6 lines.
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, compact ? 96 : 160)}px`;
	}, [value, compact]);

	const detectMention = useCallback((text: string, caret: number) => {
		const before = text.slice(0, caret);
		const at = before.lastIndexOf('@');
		// `@` must start a word; the query may contain spaces (display names)
		// but not newlines, and gives up after 32 chars so a stray `@` in
		// prose doesn't keep the picker armed forever.
		if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) {
			setMentionQuery(null);
			return;
		}
		const query = before.slice(at + 1);
		if (query.includes('\n') || query.length > 32) {
			setMentionQuery(null);
			return;
		}
		setMentionQuery({ start: at, text: query });
	}, []);

	function pick(c: MentionCandidate) {
		if (!mentionQuery) return;
		const el = textareaRef.current;
		const caret = el?.selectionStart ?? value.length;
		const next = value.slice(0, mentionQuery.start) + c.insert + value.slice(caret);
		setValue(next);
		if (c.slug && !mentions.includes(c.slug)) setMentions((prev) => [...prev, c.slug as string]);
		setMentionQuery(null);
		requestAnimationFrame(() => {
			const pos = mentionQuery.start + c.insert.length;
			el?.focus();
			el?.setSelectionRange(pos, pos);
		});
	}

	async function submit() {
		const body = value.trim();
		if (!body || sending || disabled) return;
		setSending(true);
		// Only keep mention slugs that are still present in the body.
		const kept = mentions.filter((slug) => body.includes(`@${slug}`));
		try {
			await onSend(body, { visibility: staffOnly ? 'staff_only' : 'all', mentions: kept.length > 0 ? kept : null });
			setValue('');
			setMentions([]);
			setMentionQuery(null);
		} catch {
			// The hook surfaces the error; keep the draft so nothing is lost.
		} finally {
			setSending(false);
			textareaRef.current?.focus();
		}
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (mentionQuery && matches.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setHighlight((h) => (h + 1) % matches.length);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setHighlight((h) => (h - 1 + matches.length) % matches.length);
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				pick(matches[highlight]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				setMentionQuery(null);
				return;
			}
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	}

	const canSend = value.trim().length > 0 && !sending && !disabled;

	return (
		<div className={clsx('relative shrink-0 border-t', staffOnly ? 'border-amber-200 dark:border-amber-900/60' : 'border-slate-200 dark:border-slate-700', compact ? 'p-2' : 'p-3')}>
			{mentionQuery && matches.length > 0 && (
				<ul
					role="listbox"
					className="absolute bottom-full left-3 mb-1 w-64 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-panel z-30 py-1"
				>
					{matches.map((c, i) => (
						<li key={c.key} role="option" aria-selected={i === highlight}>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => pick(c)}
								onMouseEnter={() => setHighlight(i)}
								className={clsx(
									'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
									i === highlight ? 'bg-slate-100 dark:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/45',
								)}
							>
								<Avatar name={c.label} url={c.avatarUrl} isAgent={c.isAgent} size="xs" />
								<span className="truncate text-slate-800 dark:text-slate-200">{c.label}</span>
								{c.isAgent && <Bot className="w-3 h-3 text-slate-400 ml-auto shrink-0" />}
							</button>
						</li>
					))}
				</ul>
			)}
			<div
				className={clsx(
					'flex items-end gap-2 rounded-lg border px-3 py-2 transition-colors',
					'focus-within:ring-2 focus-within:ring-primary-500',
					staffOnly
						? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30'
						: 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800',
				)}
			>
				<textarea
					ref={textareaRef}
					rows={1}
					value={value}
					disabled={disabled}
					placeholder={placeholder ?? 'Message… (@ to mention)'}
					onChange={(e) => {
						setValue(e.target.value);
						detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
					}}
					onKeyDown={onKeyDown}
					onBlur={() => setMentionQuery(null)}
					className={clsx(
						'flex-1 resize-none bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100 disabled:opacity-50',
						compact ? 'text-xs' : 'text-sm',
					)}
					aria-label="Message"
				/>
				{allowStaffOnly && (
					<button
						type="button"
						onClick={() => setStaffOnly((v) => !v)}
						aria-pressed={staffOnly}
						title={staffOnly ? 'Staff only — hidden from clients and external participants' : 'Mark as staff only'}
						className={clsx(
							'shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-medium transition-colors',
							staffOnly
								? 'bg-amber-200/70 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
								: 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45',
						)}
					>
						<EyeOff className="w-3.5 h-3.5" />
						{!compact && 'staff only'}
					</button>
				)}
				<button
					type="button"
					onClick={() => void submit()}
					disabled={!canSend}
					aria-label="Send"
					className="shrink-0 rounded-md p-1.5 bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
				>
					<SendHorizontal className="w-3.5 h-3.5" />
				</button>
			</div>
			{!compact && (
				<p className="mt-1 text-2xs text-slate-600 dark:text-slate-400">
					Enter to send · Shift+Enter for a new line
					{staffOnly && <span className="text-amber-600 dark:text-amber-400"> · staff only</span>}
				</p>
			)}
		</div>
	);
}
