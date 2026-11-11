// /the-work/calendar/trips — Trips (0111, Tier B #13, Sheridan). First-class
// travel: one row per trip per traveler, shown here as a list (upcoming
// first) and on /the-work/calendar as all-day Travel chips. Fed by
// POST /api/ingest/trips or entered by hand below. Server component; the
// forms post to server actions; RLS decides who may edit (traveler/admin).

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Field, FormError, inputClass, selectClass } from '../../../team/_form';
import {
	TRIP_STATUSES,
	TRIP_STATUS_COLORS,
	TRIP_STATUS_LABELS,
	formatUsd,
	type TripRow,
	type TripStatus,
} from '@/lib/trips/shared';
import { deleteTrip, saveTrip } from './actions';

export const metadata = { title: 'Trips' };
export const dynamic = 'force-dynamic';

interface ProfileLite { id: string; first_name: string | null; last_name: string | null; email: string }
interface ClientLite { id: string; display_name: string }

function name(p: ProfileLite | undefined): string {
	if (!p) return '—';
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

function fmtRange(a: string, b: string): string {
	const f = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	return a === b ? f(a) : `${f(a)} → ${f(b)}`;
}

export default async function TripsPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; focus?: string; edit?: string }>;
}) {
	const { error, focus, edit } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const isAdmin = ['admin', 'exec'].includes(profile.role);

	const supabase = await createClient();
	const today = new Date().toISOString().slice(0, 10);
	const [tripsRes, { data: profiles }, { data: clients }] = await Promise.all([
		supabase
			.from('trips')
			.select('id, traveler_id, purpose, client_id, depart_on, return_on, destination, status, cost_usd, notes_md, source, created_at')
			.order('depart_on', { ascending: true })
			.limit(500),
		supabase.from('profiles').select('id, first_name, last_name, email').eq('is_active', true).order('first_name'),
		supabase.from('clients_v2').select('id, display_name').eq('status', 'active').order('display_name').limit(600),
	]);

	const notApplied = !!tripsRes.error && (tripsRes.error.code === '42P01' || /trips/.test(tripsRes.error.message));
	const trips = (tripsRes.data ?? []) as TripRow[];
	const byProfile = new Map((profiles ?? []).map((p) => [p.id, p as ProfileLite]));
	const clientList = (clients ?? []) as ClientLite[];
	const byClient = new Map(clientList.map((c) => [c.id, c.display_name]));

	const upcoming = trips.filter((t) => t.return_on >= today && t.status !== 'cancelled');
	const past = trips.filter((t) => t.return_on < today || t.status === 'cancelled').reverse();
	const editing = edit ? trips.find((t) => t.id === edit) ?? null : null;
	const canEdit = (t: TripRow) => isAdmin || t.traveler_id === profile.id;

	return (
		<div className="space-y-4">
			<PageHeader
				title="Trips"
				description="Travel for the team: purpose, destination, dates, client and cost. Trips show on the calendar as all-day Travel blocks."
				actions={
					<Link href="/the-work/calendar" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
						← Calendar
					</Link>
				}
			/>
			<FormError message={error} />
			{notApplied && (
				<Callout tone="warning">Trips are not enabled yet: migration 0111_tier_b_bundle.sql has not been applied.</Callout>
			)}

			<Card>
				<h2 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-3">{editing ? 'Edit trip' : 'Add a trip'}</h2>
				<form action={saveTrip} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{editing && <input type="hidden" name="id" value={editing.id} />}
					<Field label="Traveler">
						<select name="traveler_id" className={selectClass} defaultValue={editing?.traveler_id ?? profile.id} disabled={!isAdmin && !!editing}>
							{(isAdmin ? (profiles ?? []) : [byProfile.get(profile.id) ?? { id: profile.id, first_name: null, last_name: null, email: profile.email }]).map((p) => (
								<option key={p.id} value={p.id}>{name(p as ProfileLite)}</option>
							))}
						</select>
					</Field>
					<Field label="Status">
						<select name="status" className={selectClass} defaultValue={editing?.status ?? 'planned'}>
							{TRIP_STATUSES.map((s) => (
								<option key={s} value={s}>{TRIP_STATUS_LABELS[s]}</option>
							))}
						</select>
					</Field>
					<Field label="Purpose">
						<input name="purpose" className={inputClass} required maxLength={300} defaultValue={editing?.purpose ?? ''} placeholder="Client onsite, conference, shoot…" />
					</Field>
					<Field label="Destination">
						<input name="destination" className={inputClass} required maxLength={200} defaultValue={editing?.destination ?? ''} placeholder="Alex, TX" />
					</Field>
					<Field label="Depart">
						<input type="date" name="depart_on" className={inputClass} required defaultValue={editing?.depart_on ?? ''} />
					</Field>
					<Field label="Return">
						<input type="date" name="return_on" className={inputClass} required defaultValue={editing?.return_on ?? ''} />
					</Field>
					<Field label="Client" hint="Optional. Ties the trip to a client for cost roll-ups.">
						<select name="client_id" className={selectClass} defaultValue={editing?.client_id ?? ''}>
							<option value="">—</option>
							{clientList.map((c) => (
								<option key={c.id} value={c.id}>{c.display_name}</option>
							))}
						</select>
					</Field>
					<Field label="Cost (USD)">
						<input type="number" name="cost_usd" className={inputClass} min={0} step={1} defaultValue={editing?.cost_usd ?? ''} />
					</Field>
					<Field label="Notes" wide>
						<textarea name="notes_md" rows={3} className={inputClass} maxLength={5000} defaultValue={editing?.notes_md ?? ''} />
					</Field>
					<div className="sm:col-span-2 flex items-center gap-2">
						<button type="submit" className="rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2" disabled={notApplied}>
							{editing ? 'Save trip' : 'Add trip'}
						</button>
						{editing && (
							<Link href="/the-work/calendar/trips" className="text-xs text-slate-500 hover:underline">Cancel</Link>
						)}
					</div>
				</form>
			</Card>

			<TripList title="Upcoming and current" rows={upcoming} focus={focus} byProfile={byProfile} byClient={byClient} canEdit={canEdit} empty="No upcoming trips." />
			{past.length > 0 && (
				<TripList title="Past and cancelled" rows={past.slice(0, 100)} focus={focus} byProfile={byProfile} byClient={byClient} canEdit={canEdit} empty="" />
			)}
		</div>
	);
}

function TripList({
	title, rows, focus, byProfile, byClient, canEdit, empty,
}: {
	title: string;
	rows: TripRow[];
	focus?: string;
	byProfile: Map<string, ProfileLite>;
	byClient: Map<string, string>;
	canEdit: (t: TripRow) => boolean;
	empty: string;
}) {
	return (
		<Card>
			<h2 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">{title}</h2>
			{rows.length === 0 ? (
				<p className="text-xs text-slate-500 dark:text-slate-400">{empty}</p>
			) : (
				<ul className="divide-y divide-slate-100 dark:divide-slate-800">
					{rows.map((t) => {
						const cost = formatUsd(t.cost_usd);
						const client = t.client_id ? byClient.get(t.client_id) : null;
						return (
							<li key={t.id} id={t.id} className={`py-2 flex items-start justify-between gap-3 ${focus === t.id ? 'bg-primary-50/60 dark:bg-primary-950/30 -mx-2 px-2 rounded-md' : ''}`}>
								<div className="min-w-0">
									<p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
										{t.destination}
										<Badge color={TRIP_STATUS_COLORS[t.status as TripStatus] ?? 'default'}>{TRIP_STATUS_LABELS[t.status as TripStatus] ?? t.status}</Badge>
										{t.source === 'ingest' && <Badge>fed</Badge>}
									</p>
									<p className="text-xs text-slate-500 dark:text-slate-400">
										{fmtRange(t.depart_on, t.return_on)} · {name(byProfile.get(t.traveler_id))} · {t.purpose}
										{client && <> · {client}</>}
										{cost && <> · {cost}</>}
									</p>
									{t.notes_md && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-wrap">{t.notes_md}</p>}
								</div>
								{canEdit(t) && (
									<div className="flex items-center gap-2 shrink-0">
										<Link href={`/the-work/calendar/trips?edit=${t.id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Edit</Link>
										<form action={deleteTrip}>
											<input type="hidden" name="id" value={t.id} />
											<button type="submit" className="text-xs text-slate-500 hover:text-red-600">Delete</button>
										</form>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</Card>
	);
}
