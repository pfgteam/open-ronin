'use client';

// The individual's time-study grid: 14 days x 10-minute slots. Pick a
// category, then click or drag across cells to paint it; right-click (or
// the Clear brush) erases. Every change is queued and flushed to the server
// a second later (progressive save), and the status line says when the last
// save landed. Calendar-sourced cells render with a dot; manual entries win
// over them.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import { clsx } from 'clsx';
import { CalendarDays, Check, Eraser, Send } from 'lucide-react';
import {
	dayLabel,
	fmtMinutes,
	isWeekend,
	slotLabel,
	studyDays,
	studySlots,
	totalsByCategory,
	type StudyCategory,
	type StudyEntry,
	type TimeStudy,
} from '@/lib/timeStudy/shared';
import { pullCalendarIntoStudy, saveTimeStudyCells, submitTimeStudy } from './actions';
import { FALLBACK_COLOR } from '@/lib/colors';

interface Props {
	study: TimeStudy;
	categories: StudyCategory[];
	initialEntries: StudyEntry[];
	submittedAt: string | null;
	hasCalendar: boolean;
}

type CellMap = Map<string, { category: string; source: 'manual' | 'calendar' }>;

const key = (day: string, slot: number) => `${day}:${slot}`;

export default function TimeStudyGrid({ study, categories, initialEntries, submittedAt, hasCalendar }: Props) {
	const router = useRouter();
	const days = useMemo(() => studyDays(study.starts_on), [study.starts_on]);
	const slots = useMemo(() => studySlots(study), [study]);
	const active = categories.filter((c) => c.is_active);
	const colorOf = useMemo(() => new Map(active.map((c) => [c.slug, c.color ?? FALLBACK_COLOR])), [active]);
	const labelOf = useMemo(() => new Map(active.map((c) => [c.slug, c.label])), [active]);

	const [cells, setCells] = useState<CellMap>(() => {
		const m: CellMap = new Map();
		for (const e of initialEntries) m.set(key(e.day, e.slot), { category: e.category, source: e.source });
		return m;
	});
	const [brush, setBrush] = useState<string | null>(active[0]?.slug ?? null);
	const [erasing, setErasing] = useState(false);
	const [painting, setPainting] = useState(false);
	const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; at?: string; message?: string }>({ kind: 'idle' });
	const [, startTransition] = useTransition();
	const queue = useRef(new Map<string, { day: string; slot: number; category: string | null }>());
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const locked = !!submittedAt || study.status !== 'open';

	const flush = useCallback(() => {
		if (queue.current.size === 0) return;
		const batch = [...queue.current.values()];
		queue.current.clear();
		setStatus({ kind: 'saving' });
		startTransition(async () => {
			const res = await saveTimeStudyCells(study.id, batch);
			if (res.ok) setStatus({ kind: 'saved', at: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) });
			else setStatus({ kind: 'error', message: res.error });
		});
	}, [study.id]);

	const schedule = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(flush, 800);
	}, [flush]);

	// Flush on unmount / tab hide so a closed laptop does not lose the last strokes.
	useEffect(() => {
		const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
		document.addEventListener('visibilitychange', onHide);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			flush();
		};
	}, [flush]);

	function paint(day: string, slot: number) {
		if (locked) return;
		const k = key(day, slot);
		const category = erasing ? null : brush;
		if (category === null && !cells.has(k)) return;
		if (category !== null && cells.get(k)?.category === category && cells.get(k)?.source === 'manual') return;
		setCells((m) => {
			const n = new Map(m);
			if (category === null) n.delete(k);
			else n.set(k, { category, source: 'manual' });
			return n;
		});
		queue.current.set(k, { day, slot, category });
		schedule();
	}

	const totals = totalsByCategory([...cells.values()]);
	const totalMinutes = [...totals.values()].reduce((a, b) => a + b, 0);
	const calendarCount = [...cells.values()].filter((c) => c.source === 'calendar').length;

	const [pullMsg, setPullMsg] = useState<string | null>(null);
	function pull() {
		startTransition(async () => {
			const res = await pullCalendarIntoStudy(study.id, brush ?? 'other');
			if (!res.ok) { setPullMsg(res.error); return; }
			setPullMsg(`Pulled ${res.added ?? 0} slot${res.added === 1 ? '' : 's'} from your calendar.`);
			router.refresh();
		});
	}

	const [submitMsg, setSubmitMsg] = useState<string | null>(null);
	function submit() {
		if (!confirm('Submit your time study? Entries lock after submitting; a leader can reopen it.')) return;
		flush();
		startTransition(async () => {
			const res = await submitTimeStudy(study.id);
			if (!res.ok) { setSubmitMsg(res.error); return; }
			router.refresh();
		});
	}

	return (
		<div className="space-y-3" onMouseUp={() => setPainting(false)} onMouseLeave={() => setPainting(false)}>
			{submittedAt && (
				<Callout tone="success">
					Submitted {new Date(submittedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Entries are locked; a leader can reopen it.
				</Callout>
			)}
			{!submittedAt && study.status !== 'open' && <Callout tone="info">This study is {study.status}; entry is closed.</Callout>}
			{status.kind === 'error' && <Callout tone="error">Could not save: {status.message}</Callout>}
			{pullMsg && <Callout tone="info">{pullMsg}</Callout>}
			{submitMsg && <Callout tone="error">{submitMsg}</Callout>}

			{/* Brush + totals */}
			<Card className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mr-1">Paint with</span>
					{active.map((c) => (
						<button
							key={c.slug}
							type="button"
							disabled={locked}
							onClick={() => { setBrush(c.slug); setErasing(false); }}
							className={clsx(
								'text-xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 disabled:opacity-50',
								brush === c.slug && !erasing
									? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100'
									: 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
							)}
						>
							<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color ?? FALLBACK_COLOR }} />
							{c.label}
							{totals.get(c.slug) ? <span className="tabular-nums opacity-60">{fmtMinutes(totals.get(c.slug) ?? 0)}</span> : null}
						</button>
					))}
					<button
						type="button"
						disabled={locked}
						onClick={() => setErasing((v) => !v)}
						className={clsx(
							'text-xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 disabled:opacity-50',
							erasing ? 'border-red-500 text-red-700 dark:text-red-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400',
						)}
					>
						<Eraser className="w-3 h-3" /> Clear
					</button>
					<span className="ml-auto text-2xs text-slate-600 dark:text-slate-400 tabular-nums">
						{fmtMinutes(totalMinutes)} accounted{calendarCount > 0 ? ` · ${calendarCount} from calendar` : ''}
						{' · '}
						{status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? `Saved ${status.at}` : status.kind === 'error' ? 'Not saved' : 'Auto-saves as you go'}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{hasCalendar ? (
						<Button variant="outline" size="sm" type="button" disabled={locked} onClick={pull} className="gap-1.5">
							<CalendarDays className="w-3.5 h-3.5" /> Pull my calendar events
						</Button>
					) : (
						<span className="text-2xs text-slate-600 dark:text-slate-400">Connect Google Calendar on My Calendar to pull events in as they happen.</span>
					)}
					{!locked && (
						<Button size="sm" type="button" onClick={submit} className="gap-1.5 ml-auto">
							<Send className="w-3.5 h-3.5" /> Submit for review
						</Button>
					)}
				</div>
			</Card>

			{/* Grid: rows = slots, columns = days. Click/drag paints. */}
			<Card padding="none" className="overflow-x-auto">
				<table className="text-2xs select-none border-collapse" style={{ minWidth: `${120 + days.length * 56}px` }}>
					<thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/80 z-10">
						<tr>
							<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-2 py-1.5 w-20">Time</th>
							{days.map((d) => (
								<th key={d} className={clsx('font-medium px-1 py-1.5 text-center whitespace-nowrap', isWeekend(d) ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500')}>
									{dayLabel(d)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{slots.map((slot) => (
							<tr key={slot} className={clsx(slot % 6 === 0 && 'border-t border-slate-200 dark:border-slate-700')}>
								<td className="px-2 py-0 text-slate-400 tabular-nums whitespace-nowrap h-4 leading-none">
									{slot % 6 === 0 ? slotLabel(slot) : ''}
								</td>
								{days.map((d) => {
									const c = cells.get(key(d, slot));
									return (
										<td
											key={d}
											title={c ? `${labelOf.get(c.category) ?? c.category}${c.source === 'calendar' ? ' (calendar)' : ''}` : `${dayLabel(d)} ${slotLabel(slot)}`}
											onMouseDown={(e) => { if (e.button !== 0) return; setPainting(true); paint(d, slot); }}
											onMouseEnter={() => { if (painting) paint(d, slot); }}
											onContextMenu={(e) => { e.preventDefault(); if (locked) return; setCells((m) => { const n = new Map(m); n.delete(key(d, slot)); return n; }); queue.current.set(key(d, slot), { day: d, slot, category: null }); schedule(); }}
											className={clsx(
												'h-4 w-14 border-r border-slate-200 dark:border-slate-700 relative',
												!locked && 'cursor-crosshair',
												isWeekend(d) && !c && 'bg-slate-50/60 dark:bg-slate-900/30',
											)}
											style={c ? { backgroundColor: colorOf.get(c.category) ?? FALLBACK_COLOR, opacity: c.source === 'calendar' ? 0.65 : 0.9 } : undefined}
										>
											{c?.source === 'calendar' && <span className="absolute right-0.5 top-0.5 w-1 h-1 rounded-full bg-white/90" />}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</Card>
			<p className="text-2xs text-slate-600 dark:text-slate-400 inline-flex items-center gap-1">
				<Check className="w-3 h-3" /> Click or drag to paint the selected category; right-click a cell to clear it. Calendar-pulled cells carry a white dot and are replaced when you paint over them.
			</p>
		</div>
	);
}
