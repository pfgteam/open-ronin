// /admin/time-study — settings + kick-off for Time Study (0083).
//
// The admin trigger: open a two-week study for the whole team (one open at a
// time), move it to review / close it, and manage the slot categories. The
// tool itself (entry grid, leader review, team view) lives under Tools ->
// Time Study; this page only configures and starts it.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Field, FormError, inputClass, selectClass } from '../../team/_form';
import { STATUS_LABELS, type StudyCategory, type TimeStudy } from '@/lib/timeStudy/shared';
import { kickoffTimeStudy, setTimeStudyStatus, toggleTimeStudyCategory, upsertTimeStudyCategory } from './actions';
import { FALLBACK_COLOR } from '@/lib/colors';

export const metadata = { title: 'Time Study settings' };
export const dynamic = 'force-dynamic';

function nextMonday(): string {
	const d = new Date();
	const day = d.getUTCDay();
	const add = ((8 - day) % 7) || 7;
	d.setUTCDate(d.getUTCDate() + add);
	return d.toISOString().slice(0, 10);
}

export default async function TimeStudyAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
	const { error } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');

	const supabase = await createClient();
	const [{ data: studyRows, error: readError }, { data: catRows }] = await Promise.all([
		supabase.from('time_studies').select('id, name, starts_on, ends_on, status, day_start_hour, day_end_hour, opened_at, closed_at').order('starts_on', { ascending: false }),
		supabase.from('time_study_categories').select('slug, label, color, sort, is_active').order('sort'),
	]);
	const studies = (studyRows ?? []) as TimeStudy[];
	const categories = (catRows ?? []) as StudyCategory[];
	const openStudy = studies.find((s) => s.status === 'open') ?? null;

	const counts = new Map<string, { entries: number; submitted: number }>();
	if (studies.length) {
		const [{ data: subs }, { data: ents }] = await Promise.all([
			supabase.from('time_study_submissions').select('study_id'),
			supabase.from('v_time_study_person_totals').select('study_id, user_id'),
		]);
		for (const s of subs ?? []) {
			const c = counts.get(s.study_id as string) ?? { entries: 0, submitted: 0 };
			c.submitted += 1;
			counts.set(s.study_id as string, c);
		}
		const seen = new Set<string>();
		for (const e of ents ?? []) {
			const k = `${e.study_id}:${e.user_id}`;
			if (seen.has(k)) continue;
			seen.add(k);
			const c = counts.get(e.study_id as string) ?? { entries: 0, submitted: 0 };
			c.entries += 1;
			counts.set(e.study_id as string, c);
		}
	}

	return (
		<>
			<PageHeader
				title="Time Study"
				description="Kick off a two-week study for the whole team, move it through review, and manage the categories people paint with. The tool itself is under Tools → Time Study."
				actions={<Link href="/social/time-study" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Open the tool →</Link>}
			/>
			<div className="space-y-4">
				<FormError message={error} />
				{readError && (
					<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">
							Migration <code>0083_time_study.sql</code> is written but not applied; the tables do not exist yet ({readError.message}).
						</p>
					</Card>
				)}

				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Kick off a study</h2>
					<p className="text-2xs text-slate-600 dark:text-slate-400 mb-3">
						Everyone active gets a notification and the grid opens for the 14 days from the start date. Only one study can be open at a time.
					</p>
					<form action={kickoffTimeStudy} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
						<Field label="Name">
							<input name="name" className={inputClass} required minLength={3} maxLength={120} placeholder="Q4 2026 time study" />
						</Field>
						<Field label="Starts on" hint="Two weeks from here">
							<input type="date" name="starts_on" className={inputClass} required defaultValue={nextMonday()} />
						</Field>
						<Field label="Day starts">
							<select name="day_start_hour" className={selectClass} defaultValue="6">
								{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
							</select>
						</Field>
						<Field label="Day ends">
							<select name="day_end_hour" className={selectClass} defaultValue="20">
								{Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{h}:00</option>)}
							</select>
						</Field>
						<div className="flex items-center gap-2">
							<select name="status" className={selectClass} defaultValue={openStudy ? 'draft' : 'open'} aria-label="Initial status">
								<option value="open" disabled={!!openStudy}>Open now</option>
								<option value="draft">Save as draft</option>
							</select>
							<Button type="submit" disabled={!!readError}>Kick off</Button>
						</div>
					</form>
					{openStudy && <p className="text-2xs text-amber-700 dark:text-amber-400 mt-2">“{openStudy.name}” is open; a new one can only be saved as a draft until it moves to review.</p>}
				</Card>

				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Studies</h2>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Name</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Window</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Hours</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Entered / submitted</th>
								<th className="w-64" />
							</tr>
						</thead>
						<tbody>
							{studies.length === 0 && (
								<tr><td colSpan={6} className="px-4 py-4 text-sm text-slate-500">No studies yet.</td></tr>
							)}
							{studies.map((s) => {
								const c = counts.get(s.id) ?? { entries: 0, submitted: 0 };
								const next: { status: string; label: string }[] =
									s.status === 'draft' ? [{ status: 'open', label: 'Open' }]
									: s.status === 'open' ? [{ status: 'review', label: 'Move to review' }, { status: 'closed', label: 'Close' }]
									: s.status === 'review' ? [{ status: 'open', label: 'Reopen' }, { status: 'closed', label: 'Close' }]
									: [{ status: 'review', label: 'Reopen for review' }];
								return (
									<tr key={s.id} className="border-t border-slate-200 dark:border-slate-700">
										<td className="px-4 py-2 text-slate-900 dark:text-slate-100">
											<Link href={`/social/time-study?study=${s.id}&view=review`} className="hover:text-primary-600">{s.name}</Link>
										</td>
										<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{s.starts_on} → {s.ends_on}</td>
										<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{s.day_start_hour}:00–{s.day_end_hour}:00</td>
										<td className="px-3 py-2"><Badge color={s.status === 'open' ? 'success' : s.status === 'review' ? 'primary' : 'default'}>{STATUS_LABELS[s.status]}</Badge></td>
										<td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{c.entries} / {c.submitted}</td>
										<td className="px-3 py-2 text-right">
											<div className="inline-flex items-center gap-1.5">
												{next.map((n) => (
													<form key={n.status} action={setTimeStudyStatus}>
														<input type="hidden" name="id" value={s.id} />
														<input type="hidden" name="status" value={n.status} />
														<button type="submit" className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline">{n.label}</button>
													</form>
												))}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					</div>
				</Card>

				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Categories</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">What a 10-minute slot can be. Deactivating keeps history; it just leaves the brush bar.</p>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Category</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Slug</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Sort</th>
								<th className="w-28" />
							</tr>
						</thead>
						<tbody>
							{categories.map((c) => (
								<tr key={c.slug} className={`border-t border-slate-200 dark:border-slate-700 ${c.is_active ? '' : 'opacity-50'}`}>
									<td className="px-4 py-1.5 text-slate-700 dark:text-slate-300 inline-flex items-center gap-2">
										<span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color ?? FALLBACK_COLOR }} />
										{c.label}
									</td>
									<td className="px-3 py-1.5 text-slate-500 font-mono">{c.slug}</td>
									<td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{c.sort}</td>
									<td className="px-3 py-1.5 text-right">
										<form action={toggleTimeStudyCategory} className="inline">
											<input type="hidden" name="slug" value={c.slug} />
											<button type="submit" className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline">{c.is_active ? 'Deactivate' : 'Reactivate'}</button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					</div>
					<form action={upsertTimeStudyCategory} className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
						<Field label="Slug"><input name="slug" className={inputClass} placeholder="client_work" pattern="[a-z0-9_]{2,40}" required /></Field>
						<Field label="Label"><input name="label" className={inputClass} placeholder="Client work" required /></Field>
						<Field label="Color"><input name="color" type="color" className={`${inputClass} h-9 p-1`} defaultValue="#069494" /></Field>
						<Field label="Sort"><input name="sort" type="number" className={inputClass} defaultValue={100} /></Field>
						<Button type="submit" variant="outline" disabled={!!readError}>Add / update</Button>
					</form>
				</Card>
			</div>
		</>
	);
}
