'use client';

// Shared pieces of Self (client): the row / signal types both views use,
// computeTeamSignals + TeamTab + SessionActionsTab (rendered on Self →
// Overview), the QuickActionsPicker modal and TabButton. The My work queue
// itself lives in MyWorkView.tsx on the board engine (2026-10-05).

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import {
	Calendar as CalIcon, Plus, ArrowRight, Users,
	ClipboardCheck, BarChart3, StickyNote, Bot, Video, UserPlus,
} from 'lucide-react';
import type { WorkRow as BoardWorkRow } from '@/lib/work/boards/types';
import { parseDueLocal, startOfDay } from '@/lib/home/dueLabel';
import { groupSessionActions, type SessionAction } from '@/lib/home/sessionActions';
import { decideSuggestedTask } from '@/app/(app)/team/sessions/[id]/suggestionActions';
import {
	availableQuickActions, DEFAULT_QUICK_ACTION_KEYS,
} from '@/lib/home/quickActions';
import { saveQuickActions } from '@/app/(app)/quickActionsActions';
import ModalCard from '@/components/ui/ModalCard';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types (server → client props)
// ---------------------------------------------------------------------------

/** A work item as the boards load it (public.projects subset). */
export type WorkRow = BoardWorkRow;

export interface LegacyTaskRow {
	id: string; project_id: string; title: string; status: string; priority: string | null;
	due_at: string | null; starts_at: string | null; completed_at: string | null;
}

export interface AgendaEvent {
	id: string; title: string; starts_at: string; ends_at: string | null;
	all_day: boolean; category_key: string | null; source: string;
	location: string | null; url: string | null; attendee_external: string[];
}

export interface CalConnection {
	id: string; google_account_email: string | null; last_synced_at: string | null;
	sync_status: string | null; sync_error: string | null;
}

export interface FeedUpdate {
	id: string; itemId: string; itemName: string; health: string;
	body: string | null; createdAt: string; authorName: string | null;
}

export interface ReportProfile { id: string; name: string; department: string | null }
export interface ReportWorkItem { owner_id: string; ends_at: string | null; status: string }
export interface LeadItem {
	id: string; name: string; kind: string; status: string;
	owner_id: string | null; ownerName: string | null; updated_at: string;
	lastUpdateAt: string | null; lastHealth: string | null;
}

interface Profile { id: string; first_name: string | null; last_name: string | null; email: string }


function daysAgo(iso: string): number {
	return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const HEALTH_META: Record<string, { label: string; cls: string }> = {
	on_track: { label: 'On track', cls: 'text-green-600 dark:text-green-400' },
	at_risk: { label: 'At risk', cls: 'text-amber-600 dark:text-amber-400' },
	off_track: { label: 'Off track', cls: 'text-red-600 dark:text-red-400' },
};

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={`inline-flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 -mb-px transition-colors ${
				active
					? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
					: 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
			}`}
		>
			{children}
		</button>
	);
}

const QUICK_ACTION_ICON: Record<string, typeof Plus> = {
	new_task: Plus,
	weekly_checkin: ClipboardCheck,
	my_metrics: BarChart3,
	open_calendar: CalIcon,
	new_client_note: StickyNote,
	run_scraper: Bot,
	add_prospect: UserPlus,
};

export function QuickActionsPicker({ selected, canUseRestricted }: { selected: string[] | null; canUseRestricted: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const options = useMemo(() => availableQuickActions(canUseRestricted), [canUseRestricted]);

	// Seeded from the RAW saved row, falling back to the defaults for a null one
	// — the picker must never open blank for a first-time user and then "save"
	// that blank as a deliberate choice.
	//
	// Deliberately NOT seeded from resolveQuickActions: that has already dropped
	// anything this viewer cannot see, so a demoted admin would open the picker,
	// hit Save, and lose their saved run_scraper forever — destroying the very
	// key saveQuickActions goes out of its way to preserve. Keys that aren't
	// rendered below simply ride through the save untouched, and come back if
	// the person is re-elevated.
	const [keys, setKeys] = useState<string[]>(() => selected ?? DEFAULT_QUICK_ACTION_KEYS);
	const [saving, setSaving] = useState(false);

	// Order is meaningful (it is the card's render order), so this is an array,
	// not a Set: unticking and re-ticking moves an action to the end rather than
	// silently restoring it to catalog position.
	const toggle = (key: string) =>
		setKeys((ks) => (ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key]));

	// Count what the viewer can actually SEE ticked — a carried-through hidden
	// key must not inflate the number next to the checkboxes.
	const visibleCount = options.filter((o) => keys.includes(o.key)).length;

	async function onSave() {
		setSaving(true);
		const res = await saveQuickActions(keys);
		setSaving(false);
		if (!res.ok) {
			toast({ message: `Could not save: ${res.error}`, variant: 'error' });
			return;
		}
		toast({ message: 'Quick actions saved' });
		router.replace('/', { scroll: false });
		router.refresh();
	}

	return (
		<ModalCard
			title="Quick actions"
			subtitle="Pick what sits on your home card. Yours only — nobody else sees this."
			closeHref="/"
			maxWidth="max-w-md"
		>
			<div className="space-y-1.5">
				{options.map((action) => {
					const Icon = QUICK_ACTION_ICON[action.key] ?? Plus;
					const checked = keys.includes(action.key);
					return (
						<label
							key={action.key}
							className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
								checked
									? 'border-primary-300 dark:border-primary-700 bg-primary-50/60 dark:bg-primary-950/25'
									: 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'
							}`}
						>
							<input
								type="checkbox"
								checked={checked}
								onChange={() => toggle(action.key)}
								className="w-4 h-4 rounded-md border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
							/>
							<Icon className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
							<span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{action.label}</span>
							{action.restricted && (
								<span className="text-2xs uppercase tracking-wide rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1 py-0.5">
									granted
								</span>
							)}
						</label>
					);
				})}
			</div>
			<div className="flex items-center justify-between gap-3 mt-4">
				<span className="text-2xs text-slate-600 dark:text-slate-400">
					{visibleCount === 0 ? 'None — the card will show just this gear.' : `${visibleCount} selected`}
				</span>
				<div className="flex items-center gap-2">
					<Button variant="secondary" onClick={() => router.replace('/', { scroll: false })}>
						Cancel
					</Button>
					<Button onClick={onSave} disabled={saving}>
						{saving ? 'Saving…' : 'Save'}
					</Button>
				</div>
			</div>
		</ModalCard>
	);
}

/**
 * Lead-only exception maths shared by Self → Overview (and formerly the My
 * team tab): overdue per direct report, projects missing a health update,
 * delegated items idle 5+ days. Pure: `today` is the viewer's local midnight.
 */
export function computeTeamSignals(input: {
	isLead: boolean;
	reports: ReportProfile[];
	reportItems: ReportWorkItem[];
	leadItems: LeadItem[];
	terminal: Set<string>;
	viewerId: string;
	today: Date;
}) {
	const { isLead, reports, reportItems, leadItems, terminal, viewerId, today } = input;
	const byOwner = new Map<string, { count: number; oldestDays: number }>();
	if (isLead) {
		for (const it of reportItems) {
			if (!it.ends_at || terminal.has(it.status)) continue;
			const d = startOfDay(parseDueLocal(it.ends_at));
			if (d.getTime() >= today.getTime()) continue;
			const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
			const cur = byOwner.get(it.owner_id) ?? { count: 0, oldestDays: 0 };
			cur.count += 1;
			cur.oldestDays = Math.max(cur.oldestDays, days);
			byOwner.set(it.owner_id, cur);
		}
	}
	const teamOverdue = isLead
		? reports.map((r) => ({ ...r, ...(byOwner.get(r.id) ?? { count: 0, oldestDays: 0 }) })).sort((a, b) => b.count - a.count)
		: [];
	const staleLead = leadItems
		.filter((l) => !terminal.has(l.status))
		.map((l) => ({ ...l, staleDays: l.lastUpdateAt ? daysAgo(l.lastUpdateAt) : null }))
		.filter((l) => l.staleDays === null || l.staleDays > 7)
		.sort((a, b) => (b.staleDays ?? 999) - (a.staleDays ?? 999));
	const delegatedStalled = leadItems
		.filter((l) => !terminal.has(l.status) && l.owner_id && l.owner_id !== viewerId)
		.map((l) => ({ ...l, idleDays: daysAgo(l.updated_at) }))
		.filter((l) => l.idleDays >= 5)
		.sort((a, b) => b.idleDays - a.idleDays);
	return { teamOverdue, staleLead, delegatedStalled, teamOverdueTotal: teamOverdue.reduce((s, r) => s + r.count, 0) };
}

export function TeamTab({ teamOverdue, staleLead, delegatedStalled, router }: {
	teamOverdue: (ReportProfile & { count: number; oldestDays: number })[];
	staleLead: (LeadItem & { staleDays: number | null })[];
	delegatedStalled: (LeadItem & { idleDays: number })[];
	router: ReturnType<typeof useRouter>;
}) {
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
				<Card padding="none">
					<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">My team · overdue</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">{teamOverdue.length} direct report{teamOverdue.length === 1 ? '' : 's'}</span>
					</div>
					{teamOverdue.length === 0 ? (
						<div className="px-4 py-4 text-sm text-slate-500">No direct reports found.</div>
					) : teamOverdue.map((r) => (
						<button key={r.id} onClick={() => router.push(`/team/${r.id}`)} className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors text-left">
							<span className="w-7 h-7 rounded-full bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 grid place-items-center text-2xs font-bold shrink-0">
								{r.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
							</span>
							<span className="flex-1 min-w-0">
								<span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{r.name}</span>
								<span className="block text-2xs text-slate-600 dark:text-slate-400 truncate">
									{r.department ?? '—'}{r.count > 0 ? ` · oldest ${r.oldestDays}d ago` : ' · on time'}
								</span>
							</span>
							<span className={`text-xs font-bold ${r.count > 3 ? 'text-red-600 dark:text-red-400' : r.count > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
								{r.count > 0 ? `${r.count} overdue` : '0'}
							</span>
						</button>
					))}
				</Card>

				<Card padding="none">
					<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Projects missing a health update</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">7-day threshold</span>
					</div>
					{staleLead.length === 0 ? (
						<div className="px-4 py-4 text-sm text-slate-500">Everything you lead has a recent update. 👌</div>
					) : staleLead.map((l) => (
						<button key={l.id} onClick={() => router.push(`/the-work/${l.id}`)} className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors text-left">
							<span className="flex-1 min-w-0">
								<span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{l.name}</span>
								<span className="block text-2xs text-slate-600 dark:text-slate-400 truncate">
									{l.ownerName ? `Owner: ${l.ownerName}` : 'No owner'}{l.lastHealth ? ` · last: ${(HEALTH_META[l.lastHealth] ?? { label: l.lastHealth }).label}` : ''}
								</span>
							</span>
							<span className={`text-xs font-bold ${l.staleDays === null || l.staleDays > 14 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
								{l.staleDays === null ? 'never' : `${l.staleDays}d`}
							</span>
						</button>
					))}
				</Card>

				<Card padding="none">
					<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Delegated &amp; stalled</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">no change in 5+ days</span>
					</div>
					{delegatedStalled.length === 0 ? (
						<div className="px-4 py-4 text-sm text-slate-500">Nothing you delegated has stalled.</div>
					) : delegatedStalled.map((l) => (
						<button key={l.id} onClick={() => router.push(`/the-work/${l.id}`)} className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors text-left">
							<span className="flex-1 min-w-0">
								<span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{l.name}</span>
								<span className="block text-2xs text-slate-600 dark:text-slate-400 truncate">{l.ownerName ?? 'Unassigned'} · no status change</span>
							</span>
							<span className="text-xs font-bold text-amber-600 dark:text-amber-400">{l.idleDays}d</span>
						</button>
					))}
				</Card>

				<Card padding="none">
					<div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Execution rollup</h2>
					</div>
					<div className="px-4 py-5 text-center">
						<p className="text-xs text-slate-500 max-w-xs mx-auto mb-3">
							Per-person completion %, quarter adherence, and execution scores live in the management dashboards, not here.
						</p>
						<a href="/dashboard" className="text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors">Open Dashboards →</a>
					</div>
				</Card>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// From Sessions — pending AI-suggested tasks (call_suggested_tasks, 0056)
// addressed to the viewer or their direct reports. Deciding (accept into The
// Work / dismiss) happens on the session page, where the transcript and the
// owner picker live; this tab is the inbox that points there.
// ---------------------------------------------------------------------------

const SESSION_REASON_LABEL: Record<SessionAction['reason'], string> = {
	you: 'Suggested for you',
	attended: 'From a call you attended',
	report: 'Suggested for your report',
	report_attended: "From your report's call",
};

/**
 * From Sessions (Alex + Sam, 2026-09-22): decide here, not on the call
 * page. Suggestions are grouped under one header per call (client · type ·
 * date, once), and each row carries an owner picker, a due date and
 * Accept / Dismiss inline, through the SAME server action the call page uses
 * (decideSuggestedTask). Accept creates the task and refreshes the page, so
 * it lands in My queue at once.
 *
 * The owner picker offers exactly who the action will accept: the call's
 * internal attendees plus the viewer. The AI's suggested_owner_email is only
 * a default — matched to one of those people when possible, else the viewer.
 */
export function SessionActionsTab({ actions, profiles, viewerId }: {
	actions: SessionAction[];
	profiles: Profile[];
	viewerId: string;
}) {
	const router = useRouter();
	const { toast } = useToast();
	const [, startTransition] = useTransition();
	// Optimistic: a decided row leaves the list at once; the refresh confirms.
	const [decided, setDecided] = useState<Record<string, true>>({});
	const [busy, setBusy] = useState<Record<string, true>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	// Owner / due overrides typed into a row. Absent = the row's default.
	const [owners, setOwners] = useState<Record<string, string>>({});
	const [dues, setDues] = useState<Record<string, string>>({});

	const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
	const nameOf = (p: Profile) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

	const visible = actions.filter((a) => !decided[a.id]);
	const groups = groupSessionActions(visible);

	function ownerOptions(attendeeIds: string[]): Profile[] {
		const ids = new Set([viewerId, ...attendeeIds]);
		return profiles.filter((p) => ids.has(p.id));
	}
	function defaultOwner(a: SessionAction, options: Profile[]): string {
		const email = (a.suggestedOwnerEmail ?? '').toLowerCase();
		const match = email ? options.find((p) => p.email.toLowerCase() === email) : undefined;
		return match?.id ?? viewerId;
	}

	function decide(a: SessionAction, decision: 'accept' | 'dismiss', ownerId: string, endsAt: string) {
		setBusy((b) => ({ ...b, [a.id]: true }));
		setErrors((e) => { const n = { ...e }; delete n[a.id]; return n; });
		startTransition(async () => {
			const res = await decideSuggestedTask(
				decision === 'accept'
					? { suggestionId: a.id, decision, ownerId, endsAt: endsAt || null }
					: { suggestionId: a.id, decision },
			);
			setBusy((b) => { const n = { ...b }; delete n[a.id]; return n; });
			if (!res.ok) {
				setErrors((e) => ({ ...e, [a.id]: res.error }));
				return;
			}
			setDecided((d) => ({ ...d, [a.id]: true }));
			if (decision === 'accept') {
				const owner = profileById.get(ownerId);
				toast({
					message: ownerId === viewerId
						? `Task created — it's in your queue`
						: `Task created for ${owner ? nameOf(owner) : 'its owner'}`,
				});
			} else {
				toast({ message: 'Suggestion dismissed' });
			}
			router.refresh();
		});
	}

	if (visible.length === 0) {
		const allDecided = actions.length > 0;
		return (
			<Card>
				<div className="text-center py-12">
					<Video className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
						{allDecided ? 'All decided' : 'No pending actions from Sessions'}
					</h3>
					<p className="text-sm text-slate-500 max-w-sm mx-auto">
						{allDecided
							? 'Every suggestion from your calls has been accepted or dismissed. Accepted ones are in your queue.'
							: 'When a recorded call is analysed, the tasks it suggests for you or your team land here until someone accepts or dismisses them.'}
					</p>
					<Link href="/team/sessions" className="inline-flex items-center gap-1 mt-4 text-sm text-primary-600 hover:underline">
						Open Sessions <ArrowRight className="w-3.5 h-3.5" />
					</Link>
				</div>
			</Card>
		);
	}

	return (
		<Card padding="none">
			<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
				<Video className="w-3.5 h-3.5 text-slate-400" />
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pending actions from Sessions</h2>
				<span className="text-2xs text-slate-600 dark:text-slate-400">
					{visible.length} awaiting a decision · {groups.length} {groups.length === 1 ? 'call' : 'calls'}
				</span>
			</div>

			{groups.map((g) => {
				const options = ownerOptions(g.attendeeIds);
				const clientLabel = g.clientName ?? 'Internal call';
				const initials = clientLabel.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
				return (
					<section key={g.callId} aria-label={clientLabel}>
						{/* One header per call: the context that used to repeat on every row. */}
						<div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
							<span className="w-6 h-6 shrink-0 rounded-md bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-400 text-2xs font-bold inline-flex items-center justify-center">
								{initials || '·'}
							</span>
							<span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{clientLabel}</span>
							<span className="text-2xs text-slate-600 dark:text-slate-400 truncate">
								{[g.callType?.replace(/_/g, ' '), g.occurredAt ? formatDate(g.occurredAt) : null, `${g.actions.length} ${g.actions.length === 1 ? 'suggestion' : 'suggestions'}`]
									.filter(Boolean)
									.join(' · ')}
							</span>
							<Link
								href={`/team/sessions/${g.callId}`}
								className="ml-auto shrink-0 inline-flex items-center gap-1 text-2xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
							>
								Open call <ArrowRight className="w-3 h-3" />
							</Link>
						</div>

						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{g.actions.map((a) => {
								const ownerId = owners[a.id] ?? defaultOwner(a, options);
								const due = dues[a.id] ?? '';
								const isBusy = !!busy[a.id];
								const canPickOwner = options.length > 1;
								return (
									<li key={a.id} className="pl-10 pr-3 py-2.5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 items-center">
										<div className="min-w-0 space-y-1">
											<p className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.title}</p>
											<div className="flex flex-wrap items-center gap-1.5">
												{/* Owner: a real <select>, limited to who the action accepts. */}
												<label className="inline-flex items-center gap-1 text-2xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 pl-1.5 pr-1 py-0.5">
													<Users className="w-3 h-3 text-slate-400" aria-hidden />
													<span className="sr-only">Owner</span>
													{canPickOwner ? (
														<select
															value={ownerId}
															onChange={(e) => setOwners((o) => ({ ...o, [a.id]: e.target.value }))}
															disabled={isBusy}
															className="bg-transparent text-2xs text-slate-700 dark:text-slate-300 focus:outline-none pr-0.5"
														>
															{options.map((p) => (
																<option key={p.id} value={p.id}>{p.id === viewerId ? 'You' : nameOf(p)}</option>
															))}
														</select>
													) : (
														<span className="pr-1">You</span>
													)}
												</label>
												{/* Due: amber while empty — the queue treats an undated task as unscheduled. */}
												<label className={`inline-flex items-center gap-1 text-2xs rounded-md pl-1.5 pr-1 py-0.5 border ${
													due
														? 'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
														: 'text-amber-700 dark:text-amber-400 border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30'
												}`}>
													<CalIcon className="w-3 h-3 opacity-70" aria-hidden />
													<span className="sr-only">Due date</span>
													<input
														type="date"
														value={due}
														onChange={(e) => setDues((d) => ({ ...d, [a.id]: e.target.value }))}
														disabled={isBusy}
														aria-label="Due date"
														className="bg-transparent text-2xs focus:outline-none w-32"
													/>
												</label>
												<span className="text-2xs text-slate-600 dark:text-slate-400">{SESSION_REASON_LABEL[a.reason]}</span>
											</div>
											{a.detail && (
												<p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{a.detail}</p>
											)}
											{errors[a.id] && (
												<p role="alert" className="text-xs text-red-600 dark:text-red-400">{errors[a.id]}</p>
											)}
										</div>
										<div className="flex items-center gap-1.5 justify-end">
											<button
												type="button"
												disabled={isBusy}
												onClick={() => decide(a, 'dismiss', ownerId, due)}
												className="text-xs font-medium px-2.5 py-1.5 rounded-md text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 disabled:opacity-50 transition-colors"
											>
												Dismiss
											</button>
											<button
												type="button"
												disabled={isBusy}
												onClick={() => decide(a, 'accept', ownerId, due)}
												className="text-xs font-semibold px-2.5 py-1.5 rounded-md text-white bg-primary-600 hover:bg-primary-700 border border-primary-600 hover:border-primary-700 disabled:opacity-50 transition-colors"
											>
												{isBusy ? 'Saving…' : 'Accept'}
											</button>
										</div>
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
		</Card>
	);
}
