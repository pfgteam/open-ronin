// /social/podcast — Podcast episodes, minimal (0111, Tier B #14, Elsa).
// Guest, state, release_signed, status. The point of this page is the hard
// gate: an episode with a guest in a two-party-consent state cannot enter
// Recorded (or Editing / Published) until release_signed is true. The gate is
// a CHECK + trigger in the database; the UI pre-warns and shows the DB's
// refusal verbatim. The 9-stage production board is Tier C #18, not here.

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Field, FormError, checkboxClass, inputClass, selectClass } from '../../team/_form';
import {
	EPISODE_STATUSES,
	EPISODE_STATUS_COLORS,
	EPISODE_STATUS_LABELS,
	GATED_STATUSES,
	US_STATES,
	isTwoPartyState,
	releaseGateBlocks,
	type EpisodeRow,
	type EpisodeStatus,
} from '@/lib/podcast/shared';
import { saveEpisode, setEpisodeStatus, setReleaseSigned } from './actions';

export const metadata = { title: 'Podcast' };
export const dynamic = 'force-dynamic';

const NEXT: Record<string, EpisodeStatus[]> = {
	planned: ['scheduled', 'cancelled'],
	scheduled: ['recorded', 'planned', 'cancelled'],
	recorded: ['editing', 'scheduled'],
	editing: ['published', 'recorded'],
	published: [],
	cancelled: ['planned'],
};

export default async function PodcastPage({ searchParams }: { searchParams: Promise<{ error?: string; edit?: string }> }) {
	const { error, edit } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');

	const supabase = await createClient();
	const res = await supabase
		.from('podcast_episodes')
		.select('id, title, guest_name, guest_email, guest_state, release_signed, release_signed_at, status, scheduled_for, notes_md, created_at')
		.order('scheduled_for', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: false })
		.limit(300);
	const notApplied = !!res.error;
	const episodes = (res.data ?? []) as EpisodeRow[];
	const editing = edit ? episodes.find((e) => e.id === edit) ?? null : null;
	const open = episodes.filter((e) => !['published', 'cancelled'].includes(e.status));
	const closed = episodes.filter((e) => ['published', 'cancelled'].includes(e.status));

	return (
		<div className="space-y-4">
			<PageHeader
				title="Podcast"
				description="Episodes and guests. Recording a guest in a two-party-consent state without a signed release is refused by the database, not just the form."
			/>
			<FormError message={error} />
			{notApplied && <Callout tone="warning">Podcast episodes are not enabled yet: migration 0111_tier_b_bundle.sql has not been applied.</Callout>}

			<Card>
				<h2 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-3">{editing ? 'Edit episode' : 'New episode'}</h2>
				<form action={saveEpisode} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{editing && <input type="hidden" name="id" value={editing.id} />}
					<Field label="Title" wide>
						<input name="title" className={inputClass} required maxLength={300} defaultValue={editing?.title ?? ''} />
					</Field>
					<Field label="Guest name">
						<input name="guest_name" className={inputClass} required maxLength={200} defaultValue={editing?.guest_name ?? ''} />
					</Field>
					<Field label="Guest email">
						<input type="email" name="guest_email" className={inputClass} defaultValue={editing?.guest_email ?? ''} />
					</Field>
					<Field label="Guest state" hint="Where the guest will be when recorded. Unknown counts as two-party consent.">
						<select name="guest_state" className={selectClass} defaultValue={editing?.guest_state ?? ''}>
							<option value="">Unknown</option>
							{US_STATES.map((s) => (
								<option key={s} value={s}>{s}{isTwoPartyState(s) ? ' · two-party' : ''}</option>
							))}
						</select>
					</Field>
					<Field label="Status">
						<select name="status" className={selectClass} defaultValue={editing?.status ?? 'planned'}>
							{EPISODE_STATUSES.map((s) => (
								<option key={s} value={s}>{EPISODE_STATUS_LABELS[s]}</option>
							))}
						</select>
					</Field>
					<Field label="Scheduled for">
						<input type="date" name="scheduled_for" className={inputClass} defaultValue={editing?.scheduled_for ?? ''} />
					</Field>
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 self-end pb-2">
						<input type="checkbox" name="release_signed" className={checkboxClass} defaultChecked={editing?.release_signed ?? false} />
						Release signed
					</label>
					<Field label="Notes" wide>
						<textarea name="notes_md" rows={3} className={inputClass} maxLength={5000} defaultValue={editing?.notes_md ?? ''} />
					</Field>
					<div className="sm:col-span-2 flex items-center gap-2">
						<button type="submit" className="rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2" disabled={notApplied}>
							{editing ? 'Save episode' : 'Add episode'}
						</button>
						{editing && <Link href="/social/podcast" className="text-xs text-slate-500 hover:underline">Cancel</Link>}
					</div>
				</form>
			</Card>

			<EpisodeList title="In production" rows={open} empty="No episodes in production." />
			{closed.length > 0 && <EpisodeList title="Published and cancelled" rows={closed} empty="" />}
		</div>
	);
}

function EpisodeList({ title, rows, empty }: { title: string; rows: EpisodeRow[]; empty: string }) {
	return (
		<Card>
			<h2 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">{title}</h2>
			{rows.length === 0 ? (
				<p className="text-xs text-slate-500 dark:text-slate-400">{empty}</p>
			) : (
				<ul className="divide-y divide-slate-100 dark:divide-slate-800">
					{rows.map((e) => {
						const twoParty = isTwoPartyState(e.guest_state);
						const gated = !e.release_signed && twoParty;
						return (
							<li key={e.id} className="py-2 flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
										{e.title}
										<Badge color={EPISODE_STATUS_COLORS[e.status as EpisodeStatus] ?? 'default'}>{EPISODE_STATUS_LABELS[e.status as EpisodeStatus] ?? e.status}</Badge>
										{e.release_signed ? <Badge color="success">Release signed</Badge> : gated ? <Badge color="danger">Release required</Badge> : <Badge>One-party state</Badge>}
									</p>
									<p className="text-xs text-slate-500 dark:text-slate-400">
										{e.guest_name}
										{e.guest_state ? <> · {e.guest_state.toUpperCase()}{twoParty ? ' (two-party consent)' : ''}</> : <> · state unknown (treated as two-party)</>}
										{e.scheduled_for && <> · {new Date(e.scheduled_for + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</>}
										{e.release_signed_at && <> · signed {new Date(e.release_signed_at).toLocaleDateString()}</>}
									</p>
									{e.notes_md && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-wrap">{e.notes_md}</p>}
								</div>
								<div className="flex flex-wrap items-center gap-2 shrink-0 justify-end">
									<form action={setReleaseSigned}>
										<input type="hidden" name="id" value={e.id} />
										<input type="hidden" name="signed" value={e.release_signed ? 'false' : 'true'} />
										<button type="submit" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
											{e.release_signed ? 'Unmark release' : 'Mark release signed'}
										</button>
									</form>
									{(NEXT[e.status] ?? []).map((s) => {
										const blocked = releaseGateBlocks(s, e.release_signed, e.guest_state);
										return (
											<form key={s} action={setEpisodeStatus}>
												<input type="hidden" name="id" value={e.id} />
												<input type="hidden" name="status" value={s} />
												<button
													type="submit"
													className={`text-xs rounded-md border px-2 py-1 ${blocked ? 'border-red-200 dark:border-red-800 text-red-600 dark:text-red-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
													title={blocked ? 'Needs a signed release: the database will refuse this.' : undefined}
												>
													{GATED_STATUSES.has(s) && blocked ? '🔒 ' : ''}{EPISODE_STATUS_LABELS[s]}
												</button>
											</form>
										);
									})}
									<Link href={`/social/podcast?edit=${e.id}`} className="text-xs text-slate-500 hover:underline">Edit</Link>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</Card>
	);
}
