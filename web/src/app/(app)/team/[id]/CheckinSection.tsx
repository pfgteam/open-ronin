// Weekly Check-in — embedded in the PROFILE page, same call Alex made for
// metrics ("no need for a second screen"). The Home sidebar links straight
// here (/team/{me}?tab=checkins).
//
// Qualitative only for now (Sam, 19/08): five faces per category + the
// week's high and low. The The Work completion % (PEOPLE_PLAN §9.5) plugs in
// later — the point of this step is the ritual, not the numbers.
//
// Visibility mirrors can_view_checkin (0035): the person, their direct
// manager, people-managers, exec/admin. Writing is ALWAYS the person
// themselves — a manager sees it read-only.
//
// Timing (0065, Alex 12/09/2026): a week OPENS on its Friday at 9:15 AM
// Central and stays EDITABLE — submitted or not — until two more Fridays have
// opened. Before Friday 9:15 the current week is shown as "opens …", never as
// a blank form; after the window it is history. SQL owns the clock
// (checkin_window); this file only renders what it says.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Clock, HeartPulse, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { inputClass, selectClass } from '../_form';
import { saveCheckin } from './checkin-actions';
import {
	closesOn,
	currentWeekNotOpenYet,
	formatFridayAtOpening,
	formatWeekRange,
	formatWeekEnding,
	openWeeks,
} from '@/lib/people/checkinWeeks';
import { loadCheckinWindow } from '@/lib/people/checkinWindow';
import CheckinThread, { type ThreadComment, type ThreadReview } from '../checkins/CheckinThread';
import { loadFormSupportingData } from '@/app/(app)/the-work/_lib';
import CheckinStepper, { FocusPicker, SuggestChips } from './CheckinStepper';

interface CategoryRow {
	id: string;
	key: string;
	label: string;
	prompt: string;
	is_required: boolean;
	score_labels: string[];
	sort: number;
}

interface CheckinRow {
	id: string;
	week_end: string;
	status: string;
	weekly_high: string | null;
	weekly_low: string | null;
	extra_comments: string | null;
	submitted_at: string | null;
	updated_at: string | null;
}

interface ResponseRow {
	checkin_id: string;
	category_key: string;
	category_label: string;
	score: number;
	score_label: string;
	comment: string | null;
}

// One glyph per score, least healthy (1) to healthiest (5). The label under
// each face is the category's own wording, so the glyph is decoration and the
// text carries the meaning — screen readers get the label, not the emoji.
const FACES = ['😞', '🙁', '😐', '🙂', '😄'];

const shortDate = (iso: string) =>
	new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });

export default async function CheckinSection({
	subjectId,
	weekParam,
	isSelf,
	saved,
	error,
}: {
	subjectId: string;
	weekParam?: string;
	isSelf: boolean;
	saved?: string;
	error?: string;
}) {
	const supabase = await createClient();

	const [window, { data: catRows }] = await Promise.all([
		loadCheckinWindow(supabase),
		supabase
			.from('checkin_categories')
			.select('id, key, label, prompt, is_required, score_labels, sort')
			.eq('is_active', true)
			.order('sort'),
	]);

	const categories = (catRows ?? []) as CategoryRow[];

	// Migration not applied yet, or no categories configured: say so plainly
	// instead of rendering an empty shell.
	if (!window || categories.length === 0) {
		return (
			<Card id="checkin">
				<div className="flex items-center gap-2 mb-2">
					<HeartPulse className="w-3.5 h-3.5 text-slate-400" />
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Weekly Check-in</h2>
				</div>
				<p className="text-sm text-slate-500">
					Not set up yet. Either <code>0035_weekly_checkins.sql</code> hasn&apos;t been applied in the
					Supabase SQL Editor, or no category is active in{' '}
					<code>checkin_categories</code>.
				</p>
			</Card>
		);
	}

	const { currentWeekEnd, latestOpenWeekEnd } = window;
	const weeks = openWeeks(latestOpenWeekEnd);
	const currentPending = currentWeekNotOpenYet(window);
	// The current week is selectable (so the link from Home lands somewhere
	// honest) but, before Friday 9:15, it renders as "opens …" and not a form.
	const week = weekParam && (weeks.includes(weekParam) || weekParam === currentWeekEnd) ? weekParam : weeks[0];
	const weekIsOpen = weeks.includes(week);

	// History window: the open weeks plus the nine before them, enough for the
	// person to see their own recent rhythm without an unbounded query.
	const historyFrom = weeks[weeks.length - 1];
	const { data: checkinRows } = await supabase
		.from('weekly_checkins')
		.select('id, week_end, status, weekly_high, weekly_low, extra_comments, submitted_at, updated_at')
		.eq('user_id', subjectId)
		.order('week_end', { ascending: false })
		.limit(12);

	const checkins = (checkinRows ?? []) as CheckinRow[];
	const current = checkins.find((c) => c.week_end === week) ?? null;
	const past = checkins.filter((c) => c.week_end < historyFrom && c.status === 'submitted');

	const { data: respRows } = await supabase
		.from('checkin_responses')
		.select('checkin_id, category_key, category_label, score, score_label, comment')
		.in('checkin_id', checkins.length > 0 ? checkins.map((c) => c.id) : ['00000000-0000-0000-0000-000000000000']);
	const responses = (respRows ?? []) as ResponseRow[];
	const currentResponses = new Map(
		responses.filter((r) => current && r.checkin_id === current.id).map((r) => [r.category_key, r]),
	);

	const submitted = current?.status === 'submitted';
	// Editable while the week is open — submitted or not (0065).
	const canWrite = isSelf && weekIsOpen;
	// "Edited" = touched well after the first submission. The submit itself
	// bumps updated_at a few ms after the app-stamped submitted_at (two
	// clocks), so a minute of slack keeps a plain submit from reading as an edit.
	const edited =
		submitted &&
		!!current?.updated_at &&
		!!current.submitted_at &&
		new Date(current.updated_at).getTime() - new Date(current.submitted_at).getTime() > 60_000;

	// ----- Work Revamp (phase 9): the week in The Work + next-week focus -----
	// Week = Saturday..Friday ending `week`. Completion = items owned by the
	// person with a due date in the week that are done (the "completion %"
	// this file's header said would plug in later).
	const weekStartDate = new Date(`${week}T12:00:00Z`);
	weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6);
	const weekStart = weekStartDate.toISOString().slice(0, 10);
	const todayIso = new Date().toISOString().slice(0, 10);
	const { statusesByKind } = await loadFormSupportingData();
	const isTerminal = (kind: string, slug: string) => (statusesByKind[kind] ?? []).some((s) => s.slug === slug && s.is_terminal);
	const isDoneSlug = (kind: string, slug: string) => isTerminal(kind, slug) && !/discard|archived/.test(slug);
	const [{ data: weekItems }, { data: openItems }, { count: updatesCount }, helpRes, focusRes] = await Promise.all([
		supabase.from('projects').select('id, name, kind, status, ends_at').eq('owner_id', subjectId).eq('archived', false)
			.gte('ends_at', weekStart).lte('ends_at', week).range(0, 499),
		supabase.from('projects').select('id, name, kind, status, ends_at').eq('owner_id', subjectId).eq('archived', false)
			.order('ends_at', { ascending: true, nullsFirst: false }).order('id').range(0, 199),
		supabase.from('work_item_updates').select('id', { count: 'exact', head: true }).eq('author_id', subjectId)
			.gte('created_at', `${weekStart}T00:00:00Z`).lte('created_at', `${week}T23:59:59Z`),
		current ? supabase.from('weekly_checkins').select('help_request').eq('id', current.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
		current ? supabase.from('checkin_focus').select('work_item_id, position').eq('checkin_id', current.id).order('position') : Promise.resolve({ data: [], error: null }),
	]);
	type Lite = { id: string; name: string; kind: string; status: string; ends_at: string | null };
	const planned = ((weekItems ?? []) as Lite[]).filter((r) => !/discard|archived/.test(r.status));
	const doneThisWeek = planned.filter((r) => isDoneSlug(r.kind, r.status));
	const completion = planned.length ? Math.round((doneThisWeek.length / planned.length) * 100) : null;
	const openList = ((openItems ?? []) as Lite[]).filter((r) => !isTerminal(r.kind, r.status));
	const slipped = openList.filter((r) => r.ends_at && r.ends_at < todayIso).slice(0, 5);
	const focusCandidates = openList.slice(0, 8);
	// 0140 not applied: both reads error → no help field value, no focus.
	const focusReady = !focusRes.error;
	const helpReady = !helpRes.error;
	const helpRequest = (helpRes.data as { help_request?: string | null } | null)?.help_request ?? '';
	const focusIds = ((focusRes.data ?? []) as { work_item_id: string }[]).map((f) => f.work_item_id);
	const focusNames = focusIds.map((id) => openList.find((r) => r.id === id)?.name ?? (weekItems ?? []).find((r) => r.id === id)?.name).filter(Boolean) as string[];
	const KIND_LABEL: Record<string, string> = { goal: 'Goal', priority: 'Priority', project: 'Project', task: 'Task', assignment: 'Assignment', campaign: 'Campaign' };

	// Thread + review marks (0038) exist only for a submitted week.
	const { data: auth } = await supabase.auth.getUser();
	const viewerId = auth?.user?.id ?? null;
	let threadComments: ThreadComment[] = [];
	let threadReviews: ThreadReview[] = [];
	if (submitted && current) {
		const [{ data: revRows }, { data: cmtRows }] = await Promise.all([
			supabase
				.from('checkin_reviews')
				.select('reviewer_id, reviewed_at, reviewer:profiles!checkin_reviews_reviewer_id_fkey(first_name, last_name, email)')
				.eq('checkin_id', current.id),
			supabase
				.from('checkin_comments')
				.select('id, author_id, body, created_at, edited_at, author:profiles!checkin_comments_author_id_fkey(first_name, last_name, email)')
				.eq('checkin_id', current.id)
				.order('created_at'),
		]);
		const personName = (p: { first_name: string | null; last_name: string | null; email: string } | null) =>
			p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email : 'someone';
		threadReviews = (revRows ?? []).map((r) => ({
			reviewer_id: r.reviewer_id as string,
			reviewer_name: personName(r.reviewer as unknown as { first_name: string | null; last_name: string | null; email: string } | null),
			reviewed_at: r.reviewed_at as string,
		}));
		threadComments = (cmtRows ?? []).map((c) => ({
			id: c.id as string,
			author_id: c.author_id as string,
			author_name: personName(c.author as unknown as { first_name: string | null; last_name: string | null; email: string } | null),
			body: c.body as string,
			created_at: c.created_at as string,
			edited_at: c.edited_at as string | null,
		}));
	}

	const saveDraft = async (formData: FormData): Promise<void> => {
		'use server';
		await saveCheckin(subjectId, week, false, formData);
	};
	const submitAction = async (formData: FormData): Promise<void> => {
		'use server';
		await saveCheckin(subjectId, week, true, formData);
	};

	const averageOf = (checkinId: string): string | null => {
		const rows = responses.filter((r) => r.checkin_id === checkinId);
		if (rows.length === 0) return null;
		return (rows.reduce((sum, r) => sum + r.score, 0) / rows.length).toFixed(1);
	};

	const savedMessage =
		saved === 'submitted'
			? `Submitted for ${formatWeekRange(week)}. Your manager can read it now.`
			: saved === 'edited'
				? `Changes saved for ${formatWeekRange(week)}. Your manager sees the updated version.`
				: 'Draft saved — nobody sees it until you submit.';

	const statusLine = !weekIsOpen
		? `Opens ${formatFridayAtOpening(currentWeekEnd)} — once the week has actually happened.`
		: submitted
			? isSelf
				? `Submitted. You can still edit it until ${formatFridayAtOpening(closesOn(week))}.`
				: 'Submitted.'
			: isSelf
				? `A draft is private. Submitting shares it with your manager. Open for edits until ${formatFridayAtOpening(closesOn(week))}.`
				: 'Read-only — only the person themselves fills this in.';

	// ----- the five steps (paged for the author, stacked when read-only) ----
	const panelCls = 'rounded-md border border-slate-200 dark:border-slate-700 p-3';
	const weekPanel = (
		<section className={panelCls} aria-label="The week in The Work">
			<h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">{isSelf ? 'Your week' : 'The week'} in The Work <span className="font-normal text-slate-500">· calculated</span></h3>
			<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
				{([
					['Completion', completion === null ? '—' : `${completion}%`, completion !== null && completion < 60],
					['Done', `${doneThisWeek.length} of ${planned.length}`, false],
					['Slipped', String(slipped.length), slipped.length > 0],
					['Updates posted', String(updatesCount ?? 0), false],
				] as [string, string, boolean][]).map(([label, value, bad]) => (
					<div key={label} className="rounded-md bg-slate-50 dark:bg-slate-900 px-3 py-2">
						<div className="text-2xs text-slate-500">{label}</div>
						<div className={`text-lg font-bold tabular-nums ${bad ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
					</div>
				))}
			</div>
			<p className="mt-2 text-2xs text-slate-500">Completion = items due this week that are done. Your manager sees the same number.</p>
			{doneThisWeek.length > 0 && (
				<ul className="mt-2 space-y-0.5 text-sm">
					{doneThisWeek.slice(0, 5).map((r) => <li key={r.id} className="truncate text-slate-700 dark:text-slate-300">Done: <a href={`/the-work/${r.id}`} className="hover:underline">{r.name}</a></li>)}
				</ul>
			)}
			{slipped.length > 0 && (
				<>
					<div className="mt-2 text-2xs font-medium uppercase tracking-wide text-slate-500">Slipped · give them a new date on the item</div>
					<ul className="mt-1 space-y-0.5 text-sm">
						{slipped.map((r) => <li key={r.id} className="truncate"><a href={`/the-work/${r.id}`} className="text-red-700 hover:underline dark:text-red-400">{r.name}</a> <span className="text-2xs text-slate-500">due {r.ends_at}</span></li>)}
					</ul>
				</>
			)}
		</section>
	);
	const pulsePanel = (
		<div className="space-y-3">
			{categories.map((cat) => {
				const answer = currentResponses.get(cat.key);
				return (
					<fieldset key={cat.key} className={panelCls} disabled={!canWrite}>
						<legend className="px-1 text-xs font-medium text-slate-700 dark:text-slate-300">
							{cat.label}
							{cat.is_required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
						</legend>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mb-2">{cat.prompt}</p>
						<div className="grid grid-cols-5 gap-1.5">
							{cat.score_labels.map((scoreLabel, i) => {
								const value = i + 1;
								// Selected style from the input's own :checked (has-[:checked]),
								// so a click shows immediately without client state.
								const checked = answer?.score === value;
								return (
									<label key={value} className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-center transition-colors border-slate-200 dark:border-slate-700 has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50 dark:has-[:checked]:bg-primary-950/40 ${canWrite ? 'cursor-pointer hover:border-primary-300' : ''}`}>
										<input type="radio" name={`score:${cat.key}`} value={value} defaultChecked={checked} required={cat.is_required && canWrite} className="sr-only peer" />
										<span className="text-xl leading-none peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 rounded-md" aria-hidden="true">{FACES[i]}</span>
										<span className="text-2xs text-slate-600 dark:text-slate-300 leading-tight">{scoreLabel}</span>
									</label>
								);
							})}
						</div>
						<input name={`comment:${cat.key}`} defaultValue={answer?.comment ?? ''} placeholder="Anything to add? (optional)" className={`${inputClass} mt-2`} />
					</fieldset>
				);
			})}
		</div>
	);
	const highlightsPanel = (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<label className="block">
				<span className="text-xs font-medium text-slate-700 dark:text-slate-300">Your high this week <span className="text-red-500" aria-hidden="true">*</span></span>
				<textarea name="weekly_high" rows={3} defaultValue={current?.weekly_high ?? ''} disabled={!canWrite} className={`${inputClass} mt-1`} placeholder="What went well?" />
				{canWrite && <SuggestChips target="weekly_high" items={doneThisWeek.map((r) => r.name)} />}
			</label>
			<label className="block">
				<span className="text-xs font-medium text-slate-700 dark:text-slate-300">Your low this week <span className="text-red-500" aria-hidden="true">*</span></span>
				<textarea name="weekly_low" rows={3} defaultValue={current?.weekly_low ?? ''} disabled={!canWrite} className={`${inputClass} mt-1`} placeholder="What was hard?" />
				{canWrite && <SuggestChips target="weekly_low" items={slipped.map((r) => r.name)} />}
			</label>
		</div>
	);
	const focusPanel = (
		<section aria-label="Next week focus">
			<h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">Next week focus <span className="font-normal text-slate-500">· pick up to 3</span></h3>
			<p className="mb-2 text-2xs text-slate-500">They show up for your manager in the 1:1.</p>
			{!focusReady ? (
				<p className="text-xs text-slate-500">Available once migration 0140 is applied.</p>
			) : canWrite ? (
				<>
					<input type="hidden" name="focus_present" value="1" />
					<FocusPicker items={focusCandidates.map((r) => ({ id: r.id, name: r.name, board: KIND_LABEL[r.kind] ?? r.kind }))} initial={focusIds} />
				</>
			) : focusNames.length ? (
				<ul className="space-y-0.5 text-sm">{focusNames.map((n) => <li key={n}>Focus: {n}</li>)}</ul>
			) : <p className="text-xs text-slate-500">No focus picked.</p>}
		</section>
	);
	const morePanel = (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{helpReady && (
				<label className="block">
					<span className="text-xs font-medium text-slate-700 dark:text-slate-300">Do you need help from someone?</span>
					<textarea name="help_request" rows={2} defaultValue={helpRequest} disabled={!canWrite} maxLength={1000} className={`${inputClass} mt-1`} placeholder="Who, and what you need" />
				</label>
			)}
			<label className={`block ${helpReady ? '' : 'sm:col-span-2'}`}>
				<span className="text-xs font-medium text-slate-700 dark:text-slate-300">Anything else for your leader?</span>
				<textarea name="extra_comments" rows={2} defaultValue={current?.extra_comments ?? ''} disabled={!canWrite} className={`${inputClass} mt-1`} placeholder="Optional" />
			</label>
		</div>
	);

	return (
		<Card padding="none" id="checkin">
			<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
				<HeartPulse className="w-3.5 h-3.5 text-slate-400" />
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Weekly Check-in</h2>
				{!weekIsOpen ? (
					<Badge color="default">opens Friday</Badge>
				) : submitted ? (
					<Badge color="primary">{edited ? 'submitted · edited' : 'submitted'}</Badge>
				) : current ? (
					<Badge color="warning">draft</Badge>
				) : (
					<Badge color="default">not started</Badge>
				)}
				{/* Week picker — a GET back to this profile. The hidden `tab` is
				    load-bearing: without it the form drops ?tab=checkins and submits
				    you to the Overview tab. */}
				<form method="get" action={`/team/${subjectId}`} className="ml-auto flex items-center gap-2">
					<input type="hidden" name="tab" value="checkins" />
					<select name="week" defaultValue={week} aria-label="Check-in week" className={`${selectClass} !w-64 text-xs`}>
						{currentPending && (
							<option value={currentWeekEnd}>
								{formatWeekRange(currentWeekEnd)} · this week (opens Fri 9:15 AM)
							</option>
						)}
						{weeks.map((w) => (
							<option key={w} value={w}>
								{formatWeekRange(w)}
								{w === currentWeekEnd ? ' · this week' : w === latestOpenWeekEnd ? ' · last week' : ''}
							</option>
						))}
					</select>
					<Button type="submit" variant="outline">Open</Button>
				</form>
			</div>

			{error && (
				<div className="mx-3 mt-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
					{error}
				</div>
			)}
			{saved && !error && (
				<div className="mx-3 mt-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-sm text-green-700 dark:text-green-300">
					{savedMessage}
				</div>
			)}

			{!weekIsOpen ? (
				// Not a blank form inviting a premature submission: the week has not
				// ended yet. Point at the week that IS open instead.
				<div className="p-3 space-y-2">
					<p className="text-2xs text-slate-600 dark:text-slate-400">
						{formatWeekRange(week)} · Saturday to Friday. {statusLine}
					</p>
					<p className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
						<Clock className="w-4 h-4 text-slate-400 shrink-0" />
						<span>
							Check-ins cover the week that just happened, so this one opens{' '}
							<strong>{formatFridayAtOpening(currentWeekEnd)}</strong>.
							{isSelf && (
								<>
									{' '}
									Meanwhile you can{' '}
									<a
										href={`/team/${subjectId}?tab=checkins&week=${encodeURIComponent(latestOpenWeekEnd)}`}
										className="text-primary-600 hover:underline"
									>
										fill in or edit {formatWeekEnding(latestOpenWeekEnd)}
									</a>
									.
								</>
							)}
						</span>
					</p>
				</div>
			) : (
			<form action={submitAction} className="p-3 space-y-4">
				<p className="text-2xs text-slate-600 dark:text-slate-400">
					{formatWeekRange(week)} · Saturday to Friday. {statusLine}
				</p>
				{canWrite ? (
					<CheckinStepper
						steps={[
							{ key: 'week', label: 'Your week' },
							{ key: 'pulse', label: 'Pulse' },
							{ key: 'highlights', label: 'Highlights' },
							{ key: 'focus', label: 'Next week focus', optional: true },
							{ key: 'more', label: 'Anything else', optional: true },
						]}
						footer={{
							submit: <Button type="submit">{submitted ? 'Save changes' : `Submit ${formatWeekEnding(week)}`}</Button>,
							// formNoValidate: a draft saves whatever is filled — the radios
							// are `required` only for the submit path.
							draft: submitted ? undefined : <Button type="submit" variant="outline" formAction={saveDraft} formNoValidate>Save draft</Button>,
						}}
					>
						{weekPanel}
						{pulsePanel}
						{highlightsPanel}
						{focusPanel}
						{morePanel}
					</CheckinStepper>
				) : (
					<>
						{weekPanel}
						{pulsePanel}
						{highlightsPanel}
						{focusPanel}
						{morePanel}
						<p className="text-2xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
							<Lock className="w-3 h-3" />
							{submitted
								? `Submitted ${current?.submitted_at ? shortDate(current.submitted_at) : ''}${edited && current?.updated_at ? `, edited ${shortDate(current.updated_at)}` : ''}.`
								: 'Read-only.'}
						</p>
					</>
				)}
				{canWrite && submitted && (
					<p className="text-2xs text-slate-600 dark:text-slate-400">
						Submitted {current?.submitted_at ? shortDate(current.submitted_at) : ''}
						{edited && current?.updated_at ? `, edited ${shortDate(current.updated_at)}` : ''}. Edits keep it submitted; high and low stay required.
					</p>
				)}
			</form>
			)}

			{/* Thread + review marks (0038) — only once the week is submitted:
			    a draft is private, so there is nothing to discuss yet. */}
			{submitted && current && viewerId && (
				<div className="border-t border-slate-200 dark:border-slate-700 px-3 py-3">
					<h3 className="text-2xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
						Conversation
					</h3>
					<CheckinThread
						checkinId={current.id}
						viewerId={viewerId}
						subjectId={subjectId}
						comments={threadComments}
						reviews={threadReviews}
						returnPath={`/team/${subjectId}`}
					/>
				</div>
			)}

			{past.length > 0 && (
				<div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2">
					<h3 className="text-2xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
						Earlier weeks
					</h3>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{past.map((c) => {
							const avg = averageOf(c.id);
							return (
								<li key={c.id} className="py-1.5 flex items-center gap-2 text-xs">
									<span className="text-slate-600 dark:text-slate-300 w-44 shrink-0">
										{formatWeekRange(c.week_end)}
									</span>
									{avg && <Badge color="default">avg {avg}/5</Badge>}
									<span className="text-slate-500 truncate">{c.weekly_high}</span>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</Card>
	);
}
