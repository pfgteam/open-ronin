'use client';

// The month grid (people × days) + balances table. Cells: approved PTO (P),
// pending (p), sick (S), unpaid / absent (U), late (L), WFH (W), holiday (H),
// weekend shaded. Click a cell (manager / people manager) to record an event
// or remove one; the balance column opens the opening / adjustment editor.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type { AttendanceEventRow, AttendancePolicyRow, TimeOffRow } from '@/lib/hiring/server';
import { ATTENDANCE_EVENT_KINDS, ATTENDANCE_EVENT_LABELS, fmtDays, type AttendanceSummaryRow } from '@/lib/hiring/onboarding';
import { deleteAttendanceEvent, recordAttendanceEvent, setAttendanceBalance, setCalendarTimeOffCounts, setTimeOffCounts } from '../onboarding/actions';

type Cell = { code: string; title: string; cls: string; eventId?: string; timeOffId?: string };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AttendanceGrid({ year, month, rows, timeOff, events, policies, deptLabels, viewerId, canManage, deptFilter }: { year: number; month: number; rows: AttendanceSummaryRow[]; timeOff: TimeOffRow[]; events: AttendanceEventRow[]; policies: AttendancePolicyRow[]; deptLabels: Record<string, string>; viewerId: string; canManage: boolean; deptFilter: string }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<string | null>(null);
	const [edit, setEdit] = useState<{ profile_id: string; date: string } | null>(null);
	const [balEdit, setBalEdit] = useState<string | null>(null);
	const [kind, setKind] = useState('sick');
	const [hours, setHours] = useState('');
	const [note, setNote] = useState('');
	const [view, setView] = useState<'grid' | 'balances'>('grid');
	const days = new Date(year, month, 0).getDate();
	const dates = Array.from({ length: days }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
	const holidays = useMemo(() => {
		const m = new Map<string, string>();
		for (const p of policies) if (p.is_default) for (const h of p.holidays ?? []) m.set(h.date, h.label ?? 'Holiday');
		return m;
	}, [policies]);
	const visible = rows.filter((r) => !deptFilter || r.department_tag_id === deptFilter);
	const depts = Array.from(new Set(rows.map((r) => r.department_tag_id).filter((x): x is string => !!x))).sort((a, b) => (deptLabels[a] ?? '').localeCompare(deptLabels[b] ?? ''));

	const cells = useMemo(() => {
		const map = new Map<string, Cell>();
		for (const t of timeOff) {
			const end = t.source === 'calendar_event' && t.ends_on > t.starts_on ? addDays(t.ends_on, -1) : t.ends_on;
			for (const d of dates) {
				if (d < t.starts_on || d > end) continue;
				const key = `${t.user_id}|${d}`;
				if (!t.counts_as_pto) {
					map.set(key, { code: '·', title: `excluded from PTO: ${t.notes ?? t.kind}`, cls: 'text-slate-400', timeOffId: t.id });
					continue;
				}
				if (t.status === 'approved') map.set(key, { code: t.kind === 'sick' ? 'S' : 'P', title: `${t.kind} (approved)${t.notes ? ` · ${t.notes}` : ''}`, cls: t.kind === 'sick' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-primary-100 dark:bg-primary-900/40 text-primary-900 dark:text-primary-300', timeOffId: t.id });
				else if (t.status === 'pending') map.set(key, { code: 'p', title: `${t.kind} (pending)`, cls: 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400', timeOffId: t.id });
			}
		}
		for (const e of events) {
			const key = `${e.profile_id}|${e.on_date}`;
			const code = e.kind === 'sick' ? 'S' : e.kind === 'unpaid' || e.kind === 'absent' ? 'U' : e.kind === 'late' ? 'L' : e.kind === 'wfh' ? 'W' : e.kind === 'half_day' ? '½' : e.kind === 'holiday_worked' ? 'H+' : 'o';
			const cls = e.kind === 'sick' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : e.kind === 'unpaid' || e.kind === 'absent' ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300' : e.kind === 'late' ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300';
			map.set(key, { code, title: `${ATTENDANCE_EVENT_LABELS[e.kind as keyof typeof ATTENDANCE_EVENT_LABELS] ?? e.kind}${e.hours ? ` · ${e.hours}h` : ''}${e.note ? ` · ${e.note}` : ''}`, cls, eventId: e.id });
		}
		return map;
	}, [timeOff, events, dates]);

	const canEditRow = (r: AttendanceSummaryRow) => canManage || r.manager_id === viewerId;
	const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
		start(async () => {
			setMsg(null);
			const r = await fn();
			if (!r.ok) setMsg(r.error ?? 'Failed.');
			else {
				setEdit(null);
				setBalEdit(null);
				router.refresh();
			}
		});
	const nav = (y: number, m: number) => `/team/attendance?year=${y}&month=${m}${deptFilter ? `&dept=${deptFilter}` : ''}`;

	return (
		<Card padding="none">
			<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
				<Link href={nav(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)} className="text-xs text-primary-600 hover:underline">‹</Link>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{MONTHS[month - 1]} {year}</h2>
				<Link href={nav(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)} className="text-xs text-primary-600 hover:underline">›</Link>
				<Select size="sm" value={deptFilter} onChange={(e) => router.push(`/team/attendance?year=${year}&month=${month}${e.target.value ? `&dept=${e.target.value}` : ''}`)} className="w-44">
					<option value="">All departments</option>
					{depts.map((d) => <option key={d} value={d}>{deptLabels[d] ?? d}</option>)}
				</Select>
				<div className="ml-auto flex gap-1">
					<button type="button" onClick={() => setView('grid')} className={`px-2 py-1 text-xs rounded-md ${view === 'grid' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>Month</button>
					<button type="button" onClick={() => setView('balances')} className={`px-2 py-1 text-xs rounded-md ${view === 'balances' ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>Balances {year}</button>
				</div>
			</div>
			{msg && <div className="px-3 pt-2"><Callout tone="error">{msg}</Callout></div>}
			<div className="px-3 py-1.5 text-2xs text-slate-500 flex flex-wrap gap-3">
				<span><b>P</b> PTO approved</span><span><b>p</b> pending</span><span><b>S</b> sick</span><span><b>U</b> unpaid / absent</span><span><b>L</b> late</span><span><b>W</b> WFH</span><span><b>½</b> half day</span><span>shaded = weekend / holiday</span>
			</div>

			{view === 'grid' && (
				<div className="overflow-x-auto">
					<table className="text-xs border-collapse">
						<thead>
							<tr className="text-2xs text-slate-500">
								<th className="sticky left-0 bg-white dark:bg-slate-800 text-left px-3 py-1 font-medium min-w-[160px]">Person</th>
								{dates.map((d) => {
									const dow = new Date(`${d}T00:00:00`).getDay();
									const hol = holidays.get(d);
									return <th key={d} title={hol} className={`px-0.5 py-1 font-medium w-7 ${dow === 0 || dow === 6 || hol ? 'text-slate-400' : ''}`}>{Number(d.slice(8))}</th>;
								})}
								<th className="px-2 py-1 font-medium text-right">Bal.</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
							{visible.map((r) => (
								<tr key={r.profile_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
									<td className="sticky left-0 bg-white dark:bg-slate-800 px-3 py-0.5 whitespace-nowrap">
										<Link href={`/team/${r.profile_id}?tab=timeoff`} className="text-slate-900 dark:text-slate-100 hover:underline">{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email}</Link>
										{!r.is_active && <span className="text-2xs text-slate-400"> (former)</span>}
									</td>
									{dates.map((d) => {
										const dow = new Date(`${d}T00:00:00`).getDay();
										const hol = holidays.get(d);
										const c = cells.get(`${r.profile_id}|${d}`);
										const editable = canEditRow(r);
										const isEdit = edit?.profile_id === r.profile_id && edit.date === d;
										return (
											<td key={d} className={`relative text-center p-0 h-6 w-7 ${dow === 0 || dow === 6 || hol ? 'bg-slate-50 dark:bg-slate-800/60' : ''}`}>
												<button type="button" disabled={!editable} title={c?.title ?? hol ?? d} onClick={() => editable && setEdit(isEdit ? null : { profile_id: r.profile_id, date: d })} className={`w-full h-full text-2xs font-medium rounded-sm ${c?.cls ?? ''} ${editable ? 'hover:ring-1 hover:ring-primary-400' : 'cursor-default'}`}>
													{c?.code ?? (hol ? 'H' : '')}
												</button>
												{isEdit && (
													<div className="absolute z-20 top-7 left-0 w-64 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-panel p-2 text-left space-y-2">
														<div className="text-2xs text-slate-500">{[r.first_name, r.last_name].filter(Boolean).join(' ')} · {d}{c ? ` · ${c.title}` : ''}</div>
														{c?.timeOffId ? (
															<div className="space-y-1">
																<p className="text-2xs text-slate-600 dark:text-slate-400">Approved / pending time off comes from the Innovation Desk. {c.code === '·' ? 'This row is excluded from the PTO count.' : 'Exclude it from the PTO count (mis-promoted calendar OOO) without deleting it:'}</p>
																<Button size="sm" variant="outline" loading={pending} onClick={() => act(() => setTimeOffCounts({ id: c.timeOffId!, profile_id: r.profile_id, counts_as_pto: c.code === '·' }))}>{c.code === '·' ? 'Count as PTO again' : 'Exclude from PTO'}</Button>
															</div>
														) : (
															<>
																<Select size="sm" value={kind} onChange={(e) => setKind(e.target.value)}>
																	{ATTENDANCE_EVENT_KINDS.map((k) => <option key={k} value={k}>{ATTENDANCE_EVENT_LABELS[k]}</option>)}
																</Select>
																<div className="grid grid-cols-2 gap-1">
																	<Input placeholder="hours (opt.)" type="number" step="0.5" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} />
																	<Input placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />
																</div>
																<div className="flex gap-1">
																	<Button size="sm" loading={pending} onClick={() => act(() => recordAttendanceEvent({ profile_id: r.profile_id, on_date: d, kind, hours: hours ? Number(hours) : null, note }))}>Record</Button>
																	{c?.eventId && <Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => deleteAttendanceEvent({ id: c.eventId!, profile_id: r.profile_id }))}>Remove</Button>}
																	<Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Close</Button>
																</div>
															</>
														)}
													</div>
												)}
											</td>
										);
									})}
									<td className="px-2 py-0.5 text-right tabular-nums">{r.can_see_balance ? <span className={r.balance_days < 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-700 dark:text-slate-300'}>{fmtDays(r.balance_days)}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
								</tr>
							))}
							{visible.length === 0 && <tr><td colSpan={days + 2} className="px-3 py-6 text-center text-slate-500">Nobody in this department.</td></tr>}
						</tbody>
					</table>
				</div>
			)}

			{view === 'balances' && (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left px-3 py-2 font-medium">Person</th>
								<th className="text-left px-3 py-2 font-medium">Policy</th>
								<th className="text-left px-3 py-2 font-medium">Started</th>
								<th className="text-right px-3 py-2 font-medium">Opening</th>
								<th className="text-right px-3 py-2 font-medium">Accrued</th>
								<th className="text-right px-3 py-2 font-medium">Adj.</th>
								<th className="text-right px-3 py-2 font-medium">Used</th>
								<th className="text-right px-3 py-2 font-medium">Pending</th>
								<th className="text-right px-3 py-2 font-medium">Sick</th>
								<th className="text-right px-3 py-2 font-medium">Unpaid</th>
								<th className="text-right px-3 py-2 font-medium">Late</th>
								<th className="text-right px-3 py-2 font-medium">Balance</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
							{visible.map((r) => {
								const vis = r.can_see_balance;
								const isEdit = balEdit === r.profile_id;
								return (
									<tr key={r.profile_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
										<td className="px-3 py-1.5">
											<Link href={`/team/${r.profile_id}?tab=timeoff`} className="text-slate-900 dark:text-slate-100 hover:underline">{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email}</Link>
											{canManage && !isEdit && <button type="button" onClick={() => setBalEdit(r.profile_id)} className="ml-2 text-2xs text-primary-600 hover:underline">edit</button>}
											{isEdit && <BalanceEditor row={r} year={year} policies={policies} pending={pending} calendarRows={timeOff.filter((t) => t.user_id === r.profile_id && t.source === 'calendar_event').length} calendarExcluded={timeOff.filter((t) => t.user_id === r.profile_id && t.source === 'calendar_event' && !t.counts_as_pto).length} onSave={(p) => act(() => setAttendanceBalance({ profile_id: r.profile_id, year, ...p }))} onCalendar={(counts) => act(() => setCalendarTimeOffCounts({ profile_id: r.profile_id, year, counts_as_pto: counts }))} onCancel={() => setBalEdit(null)} />}
										</td>
										<td className="px-3 py-1.5 text-2xs text-slate-600 dark:text-slate-400">{r.policy_key ?? '—'}{r.eligible_from && r.eligible_from > `${year}-01-01` ? <Badge color="warning" className="ml-1">usable {r.eligible_from}</Badge> : null}</td>
										<td className="px-3 py-1.5 text-slate-600 dark:text-slate-400">{r.date_started ?? '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{vis ? fmtDays(r.opening_days) : '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{vis ? fmtDays(r.accrued_days) : '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{vis ? fmtDays(r.adjustment_days) : '—'}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{fmtDays(r.used_pto_days)}</td>
										<td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtDays(r.pending_pto_days)}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{fmtDays(r.sick_days)}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{fmtDays(r.unpaid_days)}</td>
										<td className="px-3 py-1.5 text-right tabular-nums">{r.late_count}</td>
										<td className={`px-3 py-1.5 text-right tabular-nums font-medium ${vis && r.balance_days < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{vis ? fmtDays(r.balance_days) : '—'}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</Card>
	);
}

function addDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

function BalanceEditor({ row, policies, pending, calendarRows, calendarExcluded, onSave, onCalendar, onCancel }: { row: AttendanceSummaryRow; year: number; policies: AttendancePolicyRow[]; pending: boolean; calendarRows: number; calendarExcluded: number; onSave: (p: { policy_id: string | null; opening_days: number; adjustment_days: number; adjustment_note: string | null }) => void; onCalendar: (counts: boolean) => void; onCancel: () => void }) {
	const [policy, setPolicy] = useState(row.policy_id ?? '');
	const [opening, setOpening] = useState(String(row.opening_days));
	const [adj, setAdj] = useState(String(row.adjustment_days));
	const [note, setNote] = useState('');
	return (
		<div className="mt-1 space-y-1">
		<div className="grid gap-1 sm:grid-cols-5 items-end text-xs">
			<Select size="sm" value={policy} onChange={(e) => setPolicy(e.target.value)}>
				<option value="">policy: auto</option>
				{policies.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
			</Select>
			<Input type="number" step="0.5" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="opening days" />
			<Input type="number" step="0.5" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="adjustment ±" />
			<Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="why" />
			<div className="flex gap-1">
				<Button size="sm" loading={pending} onClick={() => onSave({ policy_id: policy || null, opening_days: Number(opening) || 0, adjustment_days: Number(adj) || 0, adjustment_note: note || null })}>Save</Button>
				<Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
			</div>
		</div>
		{calendarRows > 0 && (
			<div className="flex flex-wrap items-center gap-2 text-2xs text-slate-600 dark:text-slate-400">
				<span>{calendarRows} calendar-promoted OOO rows this year ({calendarExcluded} excluded). A recurring &quot;Out of office&quot; block in Google Calendar lands here as leave;</span>
				{calendarExcluded < calendarRows && <button type="button" disabled={pending} onClick={() => onCalendar(false)} className="text-primary-600 hover:underline">exclude all from PTO</button>}
				{calendarExcluded > 0 && <button type="button" disabled={pending} onClick={() => onCalendar(true)} className="text-primary-600 hover:underline">count all again</button>}
			</div>
		)}
		</div>
	);
}
