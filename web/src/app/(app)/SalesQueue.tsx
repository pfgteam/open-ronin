'use client';

// Self → My work → Sales (spec §4): the rep's deal queue on the board look —
// colored group rails, counts, collapsible groups — with one-click contact
// links and Log / ⋯ popovers. Rows come from rev_my_day via salesData.ts;
// grouping and labels are lib/home/sales.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { CalendarDays, ChevronDown, ChevronRight, FileText, Mail, MessageSquare, MoreHorizontal, Phone, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import AddProspectButton from './prospects/AddProspectButton';
import Card from '@/components/ui/Card';
import FilterChip from '@/components/ui/FilterChip';
import Popover from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { controlFocus } from '@/components/ui/focus';
import { SALES_GROUPS, SNOOZE_PRESETS, groupSalesRows, presetAt, salesDueLabel, type SalesGroupKey, type SalesRow, type SnoozePreset } from '@/lib/home/sales';
import type { SalesData } from '@/lib/home/salesData';
import { formatCents } from '@/lib/revenue/shared';
import { moveDeal, snoozeDeal } from '@/app/(app)/prospects/actions';
import { GROUP_RAIL, HeatText, SalesTargets } from './SalesBits';
import { LogPanel, MovePanel, RowMenu, SnoozePanel, restoreNext, type RowPatch } from './SalesRowActions';

const STORAGE_KEY = 'or-mywork:sales-collapsed';
type Mode = 'log' | 'menu' | 'snooze' | 'move';

const iconBtn = clsx('inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-hover', controlFocus);

const GROUP_HINT: Partial<Record<SalesGroupKey, string>> = {
	calls: 'from your Google Calendar',
	none: "set one so they don't go stale",
};

export default function SalesQueue({ sales }: { sales: SalesData }) {
	const { toast } = useToast();
	const [rows, setRows] = useState<SalesRow[]>(sales.rows);
	const [now, setNow] = useState(() => new Date());
	const [collapsed, setCollapsed] = useState<Set<SalesGroupKey>>(() => new Set(SALES_GROUPS.filter((g) => g.collapsed).map((g) => g.key)));
	const [only, setOnly] = useState<SalesGroupKey | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [active, setActive] = useState<{ id: string; mode: Mode } | null>(null);
	const anchorRef = useRef<HTMLElement | null>(null);

	useEffect(() => setRows(sales.rows), [sales.rows]);
	useEffect(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) setCollapsed(new Set(JSON.parse(raw) as SalesGroupKey[]));
		} catch { /* private mode */ }
	}, []);

	const groups = useMemo(() => groupSalesRows(rows, now, sales.callDeals), [rows, now, sales.callDeals]);
	const hasNew = groups.some((g) => g.key === 'new');
	// Tick every second while a speed-to-lead timer is visible, else every minute.
	useEffect(() => {
		const t = setInterval(() => setNow(new Date()), hasNew ? 1000 : 60_000);
		return () => clearInterval(t);
	}, [hasNew]);

	const count = (k: SalesGroupKey) => groups.find((g) => g.key === k)?.rows.length ?? 0;
	const shown = only ? groups.filter((g) => g.key === only) : groups;
	const activeRow = active ? rows.find((r) => r.deal_id === active.id) ?? null : null;

	const patch = useCallback((id: string, p: RowPatch) => setRows((rs) => rs.map((r) => (r.deal_id === id ? { ...r, ...p } : r))), []);
	const remove = useCallback((id: string) => setRows((rs) => rs.filter((r) => r.deal_id !== id)), []);
	const restore = useCallback((row: SalesRow) => setRows((rs) => (rs.some((r) => r.deal_id === row.deal_id) ? rs : [...rs, row])), []);

	const open = (id: string, mode: Mode, el: HTMLElement | null) => {
		if (el) anchorRef.current = el;
		setActive({ id, mode });
	};
	const close = () => setActive(null);

	const toggleGroup = (k: SalesGroupKey) => setCollapsed((s) => {
		const n = new Set(s);
		if (n.has(k)) n.delete(k);
		else n.add(k);
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
		return n;
	});

	const selectedRows = rows.filter((r) => selected.has(r.deal_id));
	const samePipe = selectedRows.length > 0 && selectedRows.every((r) => r.pipeline_id === selectedRows[0].pipeline_id);
	const bulkStages = samePipe ? sales.stages.filter((s) => s.pipeline_id === selectedRows[0].pipeline_id && !s.handoff_pipeline_id).sort((a, b) => a.position - b.position) : [];

	const bulkSnooze = async (preset: SnoozePreset) => {
		const when = presetAt(preset, new Date()).toISOString();
		let okCount = 0;
		for (const r of selectedRows) {
			const fd = new FormData();
			fd.set('deal_id', r.deal_id);
			fd.set('next_action', r.next_action ?? 'Follow up');
			fd.set('next_action_at', when);
			const res = await snoozeDeal(fd);
			if (res.ok) {
				okCount++;
				patch(r.deal_id, { next_action: r.next_action ?? 'Follow up', next_action_at: when });
			}
		}
		setSelected(new Set());
		toast({ message: `${okCount} ${okCount === 1 ? 'deal' : 'deals'} snoozed`, variant: okCount === selectedRows.length ? 'success' : 'error' });
	};

	const bulkMove = async (stageId: string) => {
		const s = sales.stages.find((x) => x.id === stageId);
		let okCount = 0;
		for (const r of selectedRows) {
			const res = await moveDeal({ deal_id: r.deal_id, stage_id: stageId });
			if (!res.ok) continue;
			okCount++;
			if (s && s.outcome !== 'open') remove(r.deal_id);
			else patch(r.deal_id, { stage_id: stageId, stage_name: s?.name ?? r.stage_name });
		}
		setSelected(new Set());
		toast({ message: `${okCount} moved to ${s?.name ?? 'stage'}`, variant: okCount === selectedRows.length ? 'success' : 'error' });
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5">
				<SalesTargets tiles={sales.targets} variant="strip" />
				<span className="ml-auto flex items-center gap-2">
					{count('new') > 0 && (
						<FilterChip tone="danger" active={only === 'new'} aria-pressed={only === 'new'} onClick={() => setOnly(only === 'new' ? null : 'new')}>
							<b>{count('new')}</b> new {count('new') === 1 ? 'lead' : 'leads'}
						</FilterChip>
					)}
					{count('overdue') > 0 && (
						<FilterChip tone="warning" active={only === 'overdue'} aria-pressed={only === 'overdue'} onClick={() => setOnly(only === 'overdue' ? null : 'overdue')}>
							<b>{count('overdue')}</b> overdue
						</FilterChip>
					)}
					<span className="hidden text-2xs text-slate-500 sm:inline">deals you own, hottest first</span>
				</span>
			</div>

			{rows.length === 0 ? (
				<Card className="text-center">
					<p className="text-sm text-slate-600 dark:text-slate-400">Your queue is clear. Deals you own show up here, newest and hottest first.</p>
					<AddProspectButton className={clsx('mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-semibold hover:bg-hover', controlFocus)}>
						<Plus className="w-4 h-4" aria-hidden="true" />Add prospect
					</AddProspectButton>
				</Card>
			) : (
				<Card padding="none" className="overflow-x-auto">
					<table className="w-full min-w-[960px] text-sm">
						<thead>
							<tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs font-medium text-slate-500">
								<th className="w-8 px-3 py-2"><span className="sr-only">Select</span></th>
								<th className="px-2 py-2">Deal</th>
								<th className="px-2 py-2">Stage</th>
								<th className="px-2 py-2">Next action</th>
								<th className="px-2 py-2 text-right">Due</th>
								<th className="px-2 py-2">Heat</th>
								<th className="px-2 py-2 text-right">Value</th>
								<th className="px-3 py-2"><span className="sr-only">Actions</span></th>
							</tr>
						</thead>
						{shown.map((g) => {
							const isCollapsed = collapsed.has(g.key) && only !== g.key;
							const hint = g.key === 'new' ? `answer within ${sales.goalMinutes} min` : GROUP_HINT[g.key];
							return (
								<tbody key={g.key}>
									<tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30">
										<td colSpan={8} className="px-3 py-2">
											<button type="button" onClick={() => toggleGroup(g.key)} aria-expanded={!isCollapsed} className={clsx('flex w-full items-center gap-2 text-left text-sm font-semibold', controlFocus)}>
												{isCollapsed ? <ChevronRight className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
												<span className={clsx('h-4 w-1 rounded-sm', GROUP_RAIL[g.key])} aria-hidden="true" />
												{g.label}
												<span className="text-xs font-medium text-slate-500">{g.rows.length}</span>
												{hint && <span className="ml-auto text-xs font-normal text-slate-500">{hint}</span>}
											</button>
										</td>
									</tr>
									{!isCollapsed && g.rows.map((r) => {
										const due = salesDueLabel(r, g.key, now, sales.callDeals[r.deal_id], sales.goalMinutes);
										const who = r.person_name ?? r.title;
										return (
											<tr key={r.deal_id} className={clsx('border-b border-slate-200 dark:border-slate-700 transition-colors hover:bg-hover', selected.has(r.deal_id) && 'bg-selected')}>
												<td className="px-3 py-2">
													<input
														type="checkbox"
														aria-label={`Select ${r.title}`}
														checked={selected.has(r.deal_id)}
														onChange={(e) => setSelected((s) => {
															const n = new Set(s);
															if (e.target.checked) n.add(r.deal_id);
															else n.delete(r.deal_id);
															return n;
														})}
													/>
												</td>
												<td className="max-w-72 px-2 py-2">
													<Link href={`/prospects/deals/${r.deal_id}`} className="block truncate font-semibold text-slate-900 hover:underline dark:text-slate-100">{r.title}</Link>
													<span className="block truncate text-xs text-slate-500">{[r.person_name, r.brand_name].filter(Boolean).join(' · ') || '—'}</span>
												</td>
												<td className="px-2 py-2 whitespace-nowrap">
													<span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary-500" aria-hidden="true" />{r.stage_name}</span>
												</td>
												<td className="max-w-56 truncate px-2 py-2 text-slate-600 dark:text-slate-400">{r.next_action ?? (g.key === 'new' ? 'First touch' : '—')}</td>
												<td className={clsx('px-2 py-2 text-right tabular-nums whitespace-nowrap', due.late ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-400')}>{g.key === 'new' ? `⏱ ${due.text}` : due.text}</td>
												<td className="px-2 py-2"><HeatText row={r} /></td>
												<td className="px-2 py-2 text-right tabular-nums">{r.value_cents ? formatCents(r.value_cents) : '—'}</td>
												<td className="px-3 py-2">
													<span className="flex items-center justify-end gap-1">
														{g.key === 'calls' ? (
															<>
																<Link href={`/prospects/deals/${r.deal_id}?tab=calls`} className={iconBtn} aria-label={`Call brief for ${r.title}`}><FileText className="w-3.5 h-3.5" aria-hidden="true" /></Link>
																<Link href="/the-work/calendar" className={iconBtn} aria-label="Open in calendar"><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /></Link>
															</>
														) : (
															<>
																{r.phone && <a href={`tel:${r.phone}`} className={iconBtn} aria-label={`Call ${who}`}><Phone className="w-3.5 h-3.5" aria-hidden="true" /></a>}
																{r.phone && <a href={`sms:${r.phone}`} className={iconBtn} aria-label={`Text ${who}`}><MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /></a>}
																{r.email && <a href={`mailto:${r.email}`} className={iconBtn} aria-label={`Email ${who}`}><Mail className="w-3.5 h-3.5" aria-hidden="true" /></a>}
															</>
														)}
														<Button size="sm" onClick={(e) => open(r.deal_id, 'log', e.currentTarget)}>Log</Button>
														<button type="button" className={iconBtn} aria-label={`More for ${r.title}`} onClick={(e) => open(r.deal_id, 'menu', e.currentTarget)}>
															<MoreHorizontal className="w-4 h-4" aria-hidden="true" />
														</button>
													</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							);
						})}
					</table>
					{sales.truncated && (
						<p className="px-4 py-2 text-xs text-slate-500">
							Showing your top {rows.length} by priority. <Link href="/prospects/deals?owner=me" className="underline">See all in Prospects</Link>
						</p>
					)}
				</Card>
			)}

			{selected.size > 0 && (
				<div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 shadow-panel">
					<span className="text-sm font-semibold">{selected.size} selected</span>
					<span className="text-xs text-slate-500">Snooze:</span>
					{SNOOZE_PRESETS.map((p) => (
						<Button key={p.key} size="sm" variant="secondary" onClick={() => void bulkSnooze(p.key)}>{p.label}</Button>
					))}
					{bulkStages.length > 0 && (
						<select
							aria-label="Move selected to stage"
							defaultValue=""
							onChange={(e) => { if (e.target.value) void bulkMove(e.target.value); }}
							className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
						>
							<option value="">Move to…</option>
							{bulkStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
						</select>
					)}
					<Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
				</div>
			)}

			{activeRow && active && (
				<Popover open onClose={close} anchorRef={anchorRef} placement="bottom-end" width={active.mode === 'menu' ? 'w-48' : 'w-80'}>
					{active.mode === 'menu' && <RowMenu row={activeRow} onPick={(m) => setActive({ id: activeRow.deal_id, mode: m })} />}
					{active.mode === 'log' && (
						<LogPanel
							row={activeRow}
							sales={sales}
							onCancel={close}
							onDone={(p) => {
								patch(activeRow.deal_id, p);
								close();
								const when = p.next_action_at ? new Date(p.next_action_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
								toast({ message: `Logged · ${activeRow.title}${when ? ` — next: ${when}` : ''}`, variant: 'success' });
							}}
						/>
					)}
					{active.mode === 'snooze' && (
						<SnoozePanel
							row={activeRow}
							onCancel={close}
							onDone={(p, prev) => {
								const id = activeRow.deal_id;
								patch(id, p);
								close();
								toast({
									message: `Snoozed ${activeRow.title}`,
									undo: async () => {
										const r = await restoreNext(id, prev);
										if (r.ok) patch(id, prev);
										else toast({ message: r.error, variant: 'error' });
									},
								});
							}}
						/>
					)}
					{active.mode === 'move' && (
						<MovePanel
							row={activeRow}
							sales={sales}
							onCancel={close}
							onMoved={({ stage, handoff, prevStageId, prevStageName }) => {
								const row = activeRow;
								close();
								if (handoff || stage.outcome !== 'open') {
									remove(row.deal_id);
									const lane = sales.pipelines.find((x) => x.id === stage.handoff_pipeline_id)?.name ?? 'the next lane';
									toast({ message: handoff ? `${row.title} handed off to ${lane}` : `${row.title} → ${stage.name}`, variant: 'success' });
									return;
								}
								patch(row.deal_id, { stage_id: stage.id, stage_name: stage.name });
								toast({
									message: `${row.title} → ${stage.name}`,
									undo: prevStageId
										? async () => {
												const r = await moveDeal({ deal_id: row.deal_id, stage_id: prevStageId });
												if (r.ok) patch(row.deal_id, { stage_id: prevStageId, stage_name: prevStageName });
												else {
													toast({ message: r.error, variant: 'error' });
													restore(row);
												}
											}
										: undefined,
								});
							}}
						/>
					)}
				</Popover>
			)}
		</div>
	);
}
