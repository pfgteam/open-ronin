'use client';

// Universal form for create + edit of any work_item kind. Used by:
//   - /the-work/planning (create new priority/project/etc)
//   - /the-work/[id] (edit existing)
//   - WorkItemDrawer (panel-style edit from list/board/gantt/calendar)
//
// Fields render conditionally per kind (e.g., target_value only for
// kind='target', lead_measure for priority/goal). Submits via the shared
// upsertWorkItem server action.

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { upsertWorkItem, archiveWorkItem, unarchiveWorkItem, type UpsertWorkItemInput } from './actions';
import { PARENT_KIND_FOR } from './hierarchy';
import ClientSelect from '@/components/work/ClientSelect';
import { useToast } from '@/components/ui/Toast';
import {
	GRAIN_LABELS, TIMEFRAME_GRAINS, isValidTimeframe, monthOptions, quarterNameFromValue, quarterOptions,
	weekOptions, yearOptions, type TimeframeGrain,
} from '@/lib/work/timeframe';

export interface WorkItemFormInitial {
	id?: string;
	name?: string;
	kind?: string;
	parent_id?: string | null;
	status?: string | null;
	priority?: 'urgent' | 'high' | 'medium' | 'low' | null;
	owner_id?: string | null;
	team_lead_id?: string | null;
	project_lead_id?: string | null;
	department_tag_id?: string | null;
	sub_team_tag_id?: string | null;
	quarter_id?: string | null;
	timeframe_grain?: TimeframeGrain | null;
	timeframe_value?: string | null;
	starts_at?: string | null;
	ends_at?: string | null;
	description_md?: string | null;
	notes_md?: string | null;
	lead_measure_md?: string | null;
	lag_measure_md?: string | null;
	target_value?: number | null;
	target_progress?: number | null;
	target_unit?: string | null;
	process_action_md?: string | null;
	wiki_page_id?: string | null;
	bug_severity?: string | null;
	bug_environment?: string | null;
	bug_regression?: boolean | null;
	client_id?: string | null;
	tag_ids?: string[];
	additional_owner_ids?: string[];
}

interface Profile { id: string; first_name: string | null; last_name: string | null; email: string }
interface Tag { id: string; slug: string; label: string; color: string | null; category: string | null; parent_tag_id: string | null }
interface Quarter { id: string; name: string; year?: number | null; quarter?: number | null; starts_on?: string | null }
interface Status { slug: string; label: string; color: string | null }
interface ParentOption { id: string; name: string; kind: string }

interface Props {
	mode: 'create' | 'edit';
	initial?: WorkItemFormInitial;
	profiles: Profile[];
	tags: Tag[];
	quarters: Quarter[];
	statusesByKind: Record<string, Status[]>;        // pre-loaded status options per kind
	parentOptions?: ParentOption[];                   // candidate parents (goal/priority/project/twelve_week_plan/campaign/strategy)
	defaultKind?: string;                             // for create mode if initial.kind absent
	onSaved?: (id: string) => void;
	onCancel?: () => void;
	compact?: boolean;                                // tighter layout for drawer
	/** Auto-focus the Status or Owner control on mount — set by the 'S'/'A'
	 *  keyboard shortcuts (see useRowShortcuts) so the shortcut lands the
	 *  cursor straight on the field it named instead of just opening the form. */
	autoFocusField?: 'status' | 'owner';
}

const PARENT_KIND_LABELS: Record<string, string> = {
	goal: 'Goals',
	priority: 'Priorities',
	project: 'Projects',
	twelve_week_plan: '12 Week Plans',
	campaign: 'Campaigns',
	strategy: 'Strategies',
};
const PARENT_CANDIDATE_KIND_ORDER = ['goal', 'priority', 'project', 'twelve_week_plan', 'campaign', 'strategy'];

const KIND_GROUPS: { label: string; kinds: { slug: string; label: string }[] }[] = [
	{ label: 'Strategic', kinds: [
		{ slug: 'goal',      label: 'Goal' },
		{ slug: 'priority',  label: 'Priority' },
		{ slug: 'project',   label: 'Project' },
		{ slug: 'task',      label: 'Task' },
		{ slug: 'recurring', label: 'Recurring' },
		{ slug: 'process',   label: 'Process' },
	]},
	{ label: 'Client work', kinds: [
		{ slug: 'strategy',         label: 'Strategy (annual+)' },
		{ slug: 'twelve_week_plan', label: '12 Week Plan' },
		{ slug: 'campaign',         label: 'Campaign' },
		{ slug: 'assignment',       label: 'Assignment' },
		{ slug: 'client_goal',      label: 'Client goal' },
		{ slug: 'target',           label: 'Target' },
	]},
	{ label: 'Event', kinds: [
		{ slug: 'event',          label: 'Event' },
		{ slug: 'product_launch', label: 'Product launch' },
	]},
	{ label: 'Quality', kinds: [
		{ slug: 'bug', label: 'Bug' },
	]},
];

export default function WorkItemForm({
	mode, initial, profiles, tags, quarters, statusesByKind, parentOptions = [], defaultKind = 'priority',
	onSaved, onCancel, compact = false, autoFocusField,
}: Props) {
	const router = useRouter();
	const { toast, undoWindow } = useToast();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const statusRef = useRef<HTMLSelectElement>(null);
	const ownerRef = useRef<HTMLSelectElement>(null);

	useEffect(() => {
		if (autoFocusField === 'status') statusRef.current?.focus();
		else if (autoFocusField === 'owner') ownerRef.current?.focus();
		// Only on mount — this is a one-shot "land here" focus, not a
		// continuous sync, so it shouldn't re-fire as the form's own state changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const [name, setName] = useState(initial?.name ?? '');
	const [kind, setKind] = useState<string>(initial?.kind ?? defaultKind);
	const [parentId, setParentId] = useState<string>(initial?.parent_id ?? '');
	const [status, setStatus] = useState<string>(initial?.status ?? '');
	const [priority, setPriority] = useState<string>(initial?.priority ?? '');
	const [ownerId, setOwnerId] = useState<string>(initial?.owner_id ?? '');
	const [additionalOwnerIds, setAdditionalOwnerIds] = useState<string[]>(initial?.additional_owner_ids ?? []);
	const [projectLeadId, setProjectLeadId] = useState<string>(initial?.project_lead_id ?? '');
	const [departmentTagId, setDepartmentTagId] = useState<string>(initial?.department_tag_id ?? '');
	const [subTeamTagId, setSubTeamTagId] = useState<string>(initial?.sub_team_tag_id ?? '');
	const [quarterId, setQuarterId] = useState<string>(initial?.quarter_id ?? '');
	const [timeframeGrain, setTimeframeGrain] = useState<TimeframeGrain | ''>(initial?.timeframe_grain ?? '');
	const [timeframeValue, setTimeframeValue] = useState<string>(initial?.timeframe_value ?? '');
	const [startsAt, setStartsAt] = useState<string>((initial?.starts_at ?? '').slice(0, 10));
	const [endsAt, setEndsAt] = useState<string>((initial?.ends_at ?? '').slice(0, 10));
	const [description, setDescription] = useState(initial?.description_md ?? '');
	const [notes, setNotes] = useState(initial?.notes_md ?? '');
	const [leadMeasure, setLeadMeasure] = useState(initial?.lead_measure_md ?? '');
	const [lagMeasure, setLagMeasure] = useState(initial?.lag_measure_md ?? '');
	const [targetValue, setTargetValue] = useState<string>(initial?.target_value?.toString() ?? '');
	const [targetProgress, setTargetProgress] = useState<string>(initial?.target_progress?.toString() ?? '');
	const [targetUnit, setTargetUnit] = useState(initial?.target_unit ?? '');
	const [processAction, setProcessAction] = useState(initial?.process_action_md ?? '');
	const [bugSeverity, setBugSeverity] = useState<string>(initial?.bug_severity ?? 'medium');
	const [bugEnvironment, setBugEnvironment] = useState<string>(initial?.bug_environment ?? '');
	const [bugRegression, setBugRegression] = useState<boolean>(initial?.bug_regression ?? false);
	const [tagIds, setTagIds] = useState<string[]>(initial?.tag_ids ?? []);
	const [clientId, setClientId] = useState(initial?.client_id ?? '');

	// When kind changes in create mode, default status to the first option for
	// that kind — including when the previous kind left a status that doesn't
	// exist in the new kind's config (saving that made items vanish from the
	// board, since unknown statuses render in no column).
	useEffect(() => {
		if (initial?.id) return; // editing: never silently rewrite the stored status
		const list = statusesByKind[kind];
		if (!list || list.length === 0) return;
		// The kind's initial status (0162 put Backlog first in every set; new work
		// should not land in Backlog unless someone picks it).
		if (!status || !list.some((s) => s.slug === status)) setStatus((list.find((s) => (s as { is_initial?: boolean }).is_initial) ?? list[0]).slug);
	}, [kind, statusesByKind, status, initial?.id]);

	// Per-kind field visibility — drives which sections render. Goal+client_goal
	// keep lead/lag; priority drops them per 2026-06-26 spec ("No lead/lag —
	// uses projects to accomplish the rock"). Project/campaign get project_lead
	// + dept + sub_dept. Process gets dept + sub_dept + the create/update notes.
	// Task + assignment get the multi-owner picker.
	const showLeadLag       = kind === 'goal' || kind === 'client_goal';
	const showTarget        = kind === 'target';
	const showTimeframe     = kind === 'goal';
	const showQuarter       = kind === 'goal' || kind === 'priority' || kind === 'project' || kind === 'campaign' || kind === 'twelve_week_plan';
	const showProjectLead   = kind === 'project' || kind === 'campaign';
	const showDeptSubDept   = kind === 'project' || kind === 'campaign' || kind === 'process';
	const showProcessAction = kind === 'process';
	const showBugFields     = kind === 'bug';
	// project/campaign included since 2026-07-14: Linear-style project Members.
	const showMultiOwner    = kind === 'task' || kind === 'assignment' || kind === 'project' || kind === 'campaign';
	const projectLeadRequired = kind === 'project';
	const statusOptions = statusesByKind[kind] ?? [];
	// Client picker — only for client-side kinds, and only when the caller
	// supplied a client list (client-work page). Other pages leave links as-is.
	const CLIENT_KINDS = ['strategy', 'twelve_week_plan', 'campaign', 'assignment', 'client_goal', 'client_work', 'target'];
	const showClient = CLIENT_KINDS.includes(kind);

	// Department + sub-team lookups derived from the tags catalog.
	const departments = tags.filter((t) => t.category === 'department');
	const subTeams = tags.filter((t) => t.category === 'sub_team' && t.parent_tag_id === departmentTagId);

	const profilesSorted = [...profiles].sort((a, b) => {
		const an = ([a.first_name, a.last_name].filter(Boolean).join(' ') || a.email).toLowerCase();
		const bn = ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.email).toLowerCase();
		return an.localeCompare(bn);
	});

	function toggleTag(id: string) {
		setTagIds(tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id]);
	}

	function handleSave(openAfter = false) {
		const trimmed = name.trim();
		if (!trimmed) { setError('Name is required.'); return; }
		if (projectLeadRequired && !projectLeadId) {
			setError('Project Lead is required.'); return;
		}
		if (showTimeframe && !isValidTimeframe(timeframeGrain, timeframeValue)) {
			setError(timeframeGrain ? 'Pick which ' + timeframeGrain + ' this goal is for.' : 'Pick a timeframe.'); return;
		}
		setError(null);
		// A goal filed by quarter or week also lands in that quarter (quarter_id)
		// so the Priorities tabs and planning views keep scoping it correctly.
		const mirroredQuarterId = showTimeframe
			? (quarters.find((q) => q.name === quarterNameFromValue(timeframeGrain, timeframeValue))?.id ?? null)
			: null;
		const input: UpsertWorkItemInput = {
			id: initial?.id,
			name: trimmed,
			kind,
			// A parent picked for another kind (user switched the kind after
			// choosing it) would fail enforce_work_item_parent() — drop it. A
			// parent not in the candidate list (edit mode) is kept as-is.
			parent_id: kind !== 'goal' && parentId && parentOptions.find((p) => p.id === parentId)?.kind !== undefined && parentOptions.find((p) => p.id === parentId)?.kind !== PARENT_KIND_FOR[kind]
				? null
				: kind !== 'goal' ? (parentId || null) : null,
			status: status || null,
			priority: (priority || null) as UpsertWorkItemInput['priority'],
			owner_id: ownerId || null,
			// Kind-hidden sections send undefined (= leave untouched in
			// upsertWorkItem) instead of null — a save from a kind that hides
			// a section must never wipe values another surface wrote.
			project_lead_id: showProjectLead ? (projectLeadId || null) : undefined,
			department_tag_id: showDeptSubDept ? (departmentTagId || null) : undefined,
			sub_team_tag_id: showDeptSubDept ? (subTeamTagId || null) : undefined,
			quarter_id: showQuarter ? ((showTimeframe && mirroredQuarterId ? mirroredQuarterId : quarterId) || null) : undefined,
			// Only written when the user set (or the row already had) a grain, so a
			// goal save before migration 0080 is applied never touches the columns.
			timeframe_grain: showTimeframe && (timeframeGrain || initial?.timeframe_grain) ? (timeframeGrain || null) : undefined,
			timeframe_value: showTimeframe && (timeframeGrain || initial?.timeframe_grain) ? (timeframeValue || null) : undefined,
			starts_at: startsAt || null,
			ends_at: endsAt || null,
			description_md: description || null,
			notes_md: notes || null,
			lead_measure_md: showLeadLag ? (leadMeasure || null) : undefined,
			lag_measure_md: showLeadLag ? (lagMeasure || null) : undefined,
			target_value: showTarget ? (targetValue !== '' ? Number(targetValue) : null) : undefined,
			target_progress: showTarget ? (targetProgress !== '' ? Number(targetProgress) : null) : undefined,
			target_unit: showTarget ? (targetUnit || null) : undefined,
			process_action_md: showProcessAction ? (processAction || null) : undefined,
			bug_severity: showBugFields ? ((bugSeverity || 'medium') as UpsertWorkItemInput['bug_severity']) : undefined,
			bug_environment: showBugFields ? ((bugEnvironment || null) as UpsertWorkItemInput['bug_environment']) : undefined,
			bug_regression: showBugFields ? bugRegression : undefined,
			tag_ids: tagIds,
			additional_owner_ids: showMultiOwner ? additionalOwnerIds : undefined,
			client_id: showClient ? (clientId || null) : undefined,
		};
		startTransition(async () => {
			const res = await upsertWorkItem(input);
			if (!res.ok) { setError(res.error); return; }
			// Planning (rework 5.4): "Create and open" lands on the new item.
			if (openAfter && res.id) router.push(`/the-work/${res.id}`);
			else if (onSaved) onSaved(res.id!);
			else router.refresh();
		});
	}

	// Archive-with-undo (10s window, then an "Archived" confirmation) replaces
	// the old confirm() dialog so the drawer/detail page matches the list views.
	function handleArchive() {
		if (!initial?.id) return;
		const id = initial.id;
		const label = initial.name ?? 'item';
		startTransition(async () => {
			const res = await archiveWorkItem(id);
			if (!res.ok) {
				toast({ message: `Could not archive: ${res.error}`, variant: 'error' });
				return;
			}
			undoWindow({
				message: `Archiving “${label}”`,
				committedMessage: `Archived “${label}”`,
				undo: async () => {
					const r = await unarchiveWorkItem(id);
					if (!r.ok) toast({ message: `Could not restore: ${r.error}`, variant: 'error' });
					router.refresh();
				},
			});
			if (onCancel) onCancel();
			else router.push('/the-work');
		});
	}

	const colSpan = compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2';

	return (
		<div className="space-y-3">
			{/* Kind picker (only in create mode; edit mode locks the kind to avoid status orphans) */}
			{mode === 'create' && (
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Kind</label>
					<select
						value={kind}
						onChange={(e) => setKind(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						{KIND_GROUPS.map((g) => (
							<optgroup key={g.label} label={g.label}>
								{g.kinds.map((k) => <option key={k.slug} value={k.slug}>{k.label}</option>)}
							</optgroup>
						))}
					</select>
				</div>
			)}

			<div>
				<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Name *</label>
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={kind === 'priority' ? 'e.g., 8-week webinar series' : kind === 'project' ? 'Project name' : 'Name'}
					autoFocus={mode === 'create'}
				/>
			</div>

			{/* Parent — links this item into the tree (e.g. a Task under a
			    Project, a Project under a Priority, an Assignment under a
			    Campaign). Options are limited to container-ish kinds so this
			    stays a short list even with thousands of tasks in the system.
			    Hidden for kind=goal — nothing sits above Goal in the tree. */}
			{kind !== 'goal' && (
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
						Parent <span className="text-slate-400 normal-case">(optional)</span>
					</label>
					<select
						value={parentId}
						onChange={(e) => setParentId(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						<option value="">— None (top-level)</option>
						{/* Strict hierarchy: only the one kind this kind may hang under. */}
						{PARENT_CANDIDATE_KIND_ORDER.filter((k) => k === PARENT_KIND_FOR[kind] && parentOptions.some((p) => p.kind === k && p.id !== initial?.id)).map((k) => (
							<optgroup key={k} label={PARENT_KIND_LABELS[k] ?? k}>
								{parentOptions.filter((p) => p.kind === k && p.id !== initial?.id).map((p) => (
									<option key={p.id} value={p.id}>{p.name}</option>
								))}
							</optgroup>
						))}
					</select>
				</div>
			)}

			{/* Client link — client-side kinds only, when the caller passed options */}
			{showClient && (
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Client</label>
					<ClientSelect label="" size="md" value={clientId ?? ''} onChange={(v) => setClientId(v)} />
				</div>
			)}

			<div className={`grid ${colSpan} gap-3`}>
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Status</label>
					<select
						ref={statusRef}
						value={status}
						onChange={(e) => setStatus(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						{statusOptions.length === 0 && <option value="">(no config)</option>}
						{statusOptions.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
					</select>
				</div>
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Priority</label>
					<select
						value={priority}
						onChange={(e) => setPriority(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						<option value="">—</option>
						<option value="urgent">Urgent</option>
						<option value="high">High</option>
						<option value="medium">Medium</option>
						<option value="low">Low</option>
					</select>
				</div>
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Owner</label>
					<select
						ref={ownerRef}
						value={ownerId}
						onChange={(e) => setOwnerId(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						<option value="">— Me (default)</option>
						{profilesSorted.map((p) => (
							<option key={p.id} value={p.id}>{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email}</option>
						))}
					</select>
				</div>
				{showQuarter && !showTimeframe && (
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Quarter</label>
						<select
							value={quarterId}
							onChange={(e) => setQuarterId(e.target.value)}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="">—</option>
							{quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
						</select>
					</div>
				)}
				{/* Goal timeframe — two dependent fields (0080). Field A picks the
				    grain, Field B's list depends on it. Week = 1-13 of a 12WY quarter.
				    Replaces the bare Quarter picker for goals: choosing a quarter or
				    week here mirrors into quarter_id on save. */}
				{showTimeframe && (
					<>
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Timeframe</label>
							<select
								value={timeframeGrain}
								onChange={(e) => { setTimeframeGrain(e.target.value as TimeframeGrain | ''); setTimeframeValue(''); }}
								className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
							>
								<option value="">—</option>
								{TIMEFRAME_GRAINS.map((g) => <option key={g} value={g}>{GRAIN_LABELS[g]}</option>)}
							</select>
						</div>
						<div>
							<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
								{timeframeGrain === 'day' ? 'Date' : timeframeGrain ? `Which ${timeframeGrain}` : 'Which'}
							</label>
							{timeframeGrain === 'day' ? (
								<input
									type="date"
									value={timeframeValue}
									onChange={(e) => setTimeframeValue(e.target.value)}
									className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
								/>
							) : (
								<select
									value={timeframeValue}
									disabled={!timeframeGrain}
									onChange={(e) => setTimeframeValue(e.target.value)}
									className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
								>
									<option value="">{timeframeGrain ? '—' : 'Pick a timeframe first'}</option>
									{timeframeGrain === 'year' && yearOptions(quarters).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
									{timeframeGrain === 'quarter' && quarterOptions(quarters).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
									{timeframeGrain === 'month' && monthOptions(quarters).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
									{timeframeGrain === 'week' && weekOptions(quarters).map((g) => (
										<optgroup key={g.group} label={g.group}>
											{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
										</optgroup>
									))}
								</select>
							)}
						</div>
					</>
				)}
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Start</label>
					<input
						type="date"
						value={startsAt}
						onChange={(e) => setStartsAt(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					/>
				</div>
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Due</label>
					<input
						type="date"
						value={endsAt}
						onChange={(e) => setEndsAt(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					/>
				</div>
			</div>

			{/* Project Lead (required for Project; optional for Campaign) — a
			    distinct role from owner_id (accountable) and team_lead_id
			    (backup). Lead = day-to-day driver. */}
			{showProjectLead && (
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
						Project Lead {projectLeadRequired && <span className="text-red-500">*</span>}
					</label>
					<select
						value={projectLeadId}
						onChange={(e) => setProjectLeadId(e.target.value)}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
					>
						<option value="">{projectLeadRequired ? '— Select…' : '—'}</option>
						{profilesSorted.map((p) => (
							<option key={p.id} value={p.id}>{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email}</option>
						))}
					</select>
				</div>
			)}

			{/* Department + Sub-Department (project, campaign, process). Sub-
			    teams filter based on selected department. */}
			{showDeptSubDept && (
				<div className={`grid ${colSpan} gap-3`}>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Department</label>
						<select
							value={departmentTagId}
							onChange={(e) => { setDepartmentTagId(e.target.value); setSubTeamTagId(''); }}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="">—</option>
							{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
						</select>
					</div>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Sub-Department</label>
						<select
							value={subTeamTagId}
							onChange={(e) => setSubTeamTagId(e.target.value)}
							disabled={!departmentTagId || subTeams.length === 0}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<option value="">{departmentTagId ? '—' : 'pick dept first'}</option>
							{subTeams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
						</select>
					</div>
				</div>
			)}

			{/* Multi-owner picker (task, assignment). Primary owner is the
			    Owner field above; this list adds extras. */}
			{showMultiOwner && (
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
						Additional owners <span className="text-slate-400 normal-case">(beyond primary)</span>
					</label>
					<div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 rounded-md border border-slate-200 dark:border-slate-700">
						{profilesSorted.map((p) => {
							const on = additionalOwnerIds.includes(p.id);
							const isPrimary = p.id === ownerId;
							const label = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
							return (
								<button
									key={p.id}
									type="button"
									disabled={isPrimary}
									onClick={() => setAdditionalOwnerIds(on ? additionalOwnerIds.filter((x) => x !== p.id) : [...additionalOwnerIds, p.id])}
									className={`transition-colors text-2xs px-1.5 py-0.5 rounded-full border ${
										isPrimary ? 'bg-primary-100 dark:bg-primary-950/40 border-primary-300 text-primary-700 dark:text-primary-300 cursor-not-allowed' :
										on ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300' :
										'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
									}`}
									title={isPrimary ? 'Primary owner' : undefined}
								>
									{label}{isPrimary ? ' (primary)' : ''}
								</button>
							);
						})}
					</div>
				</div>
			)}

			{/* Process action notes — "what needs to be updated/created" */}
			{showProcessAction && (
				<div>
					<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
						What needs to be created / updated
					</label>
					<textarea
						value={processAction}
						onChange={(e) => setProcessAction(e.target.value)}
						rows={compact ? 2 : 3}
						className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
						placeholder="e.g., Rewrite the on-call escalation section; add the new GHL integration steps."
					/>
				</div>
			)}

			{showLeadLag && (
				<div className={`grid ${colSpan} gap-3`}>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
							Lead measure <span className="text-slate-400 normal-case">(activity)</span>
						</label>
						<Input value={leadMeasure} onChange={(e) => setLeadMeasure(e.target.value)} placeholder="e.g., Record 4 webinars/wk" />
					</div>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">
							Lag measure <span className="text-slate-400 normal-case">(outcome)</span>
						</label>
						<Input value={lagMeasure} onChange={(e) => setLagMeasure(e.target.value)} placeholder="e.g., 30 LOIs by EOQ" />
					</div>
				</div>
			)}

			{showBugFields && (
				<div className="grid grid-cols-3 gap-3">
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Severity <span className="text-red-500">*</span></label>
						<select
							value={bugSeverity}
							onChange={(e) => setBugSeverity(e.target.value)}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="critical">Critical</option>
							<option value="high">High</option>
							<option value="medium">Medium</option>
							<option value="low">Low</option>
						</select>
					</div>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Environment</label>
						<select
							value={bugEnvironment}
							onChange={(e) => setBugEnvironment(e.target.value)}
							className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
						>
							<option value="">—</option>
							<option value="production">Production</option>
							<option value="preview">Preview</option>
							<option value="staging">Staging</option>
							<option value="local">Local</option>
						</select>
					</div>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Regression</label>
						<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 h-[34px]">
							<input type="checkbox" checked={bugRegression} onChange={(e) => setBugRegression(e.target.checked)} className="rounded-sm border-slate-300 dark:border-slate-600" />
							Used to work
						</label>
					</div>
				</div>
			)}

			{showTarget && (
				<div className="grid grid-cols-3 gap-3">
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Target value</label>
						<Input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder="20" />
					</div>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Progress</label>
						<Input type="number" value={targetProgress} onChange={(e) => setTargetProgress(e.target.value)} placeholder="7" />
					</div>
					<div>
						<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Unit</label>
						<Input value={targetUnit} onChange={(e) => setTargetUnit(e.target.value)} placeholder="hits, MRR, calls…" />
					</div>
				</div>
			)}

			<div>
				<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Tags</label>
				<div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 rounded-md border border-slate-200 dark:border-slate-700">
					{tags.map((t) => {
						const on = tagIds.includes(t.id);
						return (
							<button
								key={t.id}
								type="button"
								onClick={() => toggleTag(t.id)}
								className={`transition-colors text-2xs px-1.5 py-0.5 rounded-full border ${
									on ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
								}`}
								style={!on && t.color ? { borderLeftColor: t.color, borderLeftWidth: 3 } : undefined}
								title={t.category ?? undefined}
							>
								{t.label}
							</button>
						);
					})}
				</div>
			</div>

			<div>
				<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Description</label>
				<textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={compact ? 3 : 4}
					className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
					placeholder="Markdown. What is this and what does done look like?"
				/>
			</div>

			<div>
				<label className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mb-1 block">Notes</label>
				<textarea
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={compact ? 2 : 3}
					className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
					placeholder="Anything else."
				/>
			</div>

			{error && (
				<div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-2 py-1.5">
					{error}
				</div>
			)}

			<div className="flex items-center justify-between gap-2 pt-1">
				{mode === 'edit' && initial?.id && (
					<button
						type="button"
						onClick={handleArchive}
						disabled={pending}
						className="text-xs text-red-500 hover:text-red-700 px-2 py-1 transition-colors"
					>
						Archive
					</button>
				)}
				<div className="ml-auto flex items-center gap-2">
					{onCancel && (
						<Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
					)}
					{mode === 'create' && (
						<Button variant="outline" onClick={() => handleSave(true)} disabled={pending}>Create and open</Button>
					)}
					<Button onClick={() => handleSave()} loading={pending}>
						{pending ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save changes')}
					</Button>
				</div>
			</div>
		</div>
	);
}
