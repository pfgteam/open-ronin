'use server';

// Server actions for /the-work/calendar/trips (0111, Tier B #13). RLS is the
// guard (traveler or admin writes); these validate shape, pass through, and
// surface the DB's verdict via ?error=.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { TRIP_STATUSES } from '@/lib/ingest/contract';

const TRIPS_PATH = '/the-work/calendar/trips';
const CALENDAR_PATH = '/the-work/calendar';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
	redirect(`${TRIPS_PATH}?error=${encodeURIComponent(message)}`);
}

function done(): never {
	revalidatePath(TRIPS_PATH);
	revalidatePath(CALENDAR_PATH);
	redirect(TRIPS_PATH);
}

const TripInput = z
	.object({
		id: z.string().uuid().optional(),
		traveler_id: z.string().uuid().optional(),
		purpose: z.string().trim().min(1).max(300),
		destination: z.string().trim().min(1).max(200),
		depart_on: z.string().regex(DATE_RE),
		return_on: z.string().regex(DATE_RE),
		client_id: z.string().uuid().optional().or(z.literal('')),
		status: z.enum(TRIP_STATUSES).default('planned'),
		cost_usd: z.coerce.number().min(0).max(1_000_000).optional(),
		notes_md: z.string().trim().max(5000).optional(),
	})
	.refine((v) => v.return_on >= v.depart_on, { message: 'Return must be on or after departure.' });

export async function saveTrip(formData: FormData): Promise<void> {
	const parsed = TripInput.safeParse({
		id: formData.get('id') || undefined,
		traveler_id: formData.get('traveler_id') || undefined,
		purpose: formData.get('purpose'),
		destination: formData.get('destination'),
		depart_on: formData.get('depart_on'),
		return_on: formData.get('return_on'),
		client_id: formData.get('client_id') || '',
		status: formData.get('status') || 'planned',
		cost_usd: formData.get('cost_usd') || undefined,
		notes_md: formData.get('notes_md') || undefined,
	});
	if (!parsed.success) fail(String(parsed.error.issues[0]?.message ?? 'Invalid input.'));
	const v = parsed.data;

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail('Not signed in.');

	const row = {
		traveler_id: v.traveler_id ?? auth.user.id,
		purpose: v.purpose,
		destination: v.destination,
		depart_on: v.depart_on,
		return_on: v.return_on,
		client_id: v.client_id || null,
		status: v.status,
		cost_usd: v.cost_usd ?? null,
		notes_md: v.notes_md ?? null,
	};

	if (v.id) {
		const { data, error } = await supabase.from('trips').update(row).eq('id', v.id).select('id');
		if (error) fail(error.message);
		if (!data || data.length === 0) fail('Nothing saved: you can only edit your own trips (admins edit any).');
		await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `trips/${v.id}`, action: 'trip.update', diff: row });
	} else {
		const { data, error } = await supabase
			.from('trips')
			.insert({ ...row, source: 'manual', created_by: auth.user.id })
			.select('id')
			.single();
		if (error) fail(error.code === '42P01' ? 'Trips need migration 0111 applied first.' : error.message);
		await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `trips/${data.id}`, action: 'trip.create', diff: row });
	}
	done();
}

export async function deleteTrip(formData: FormData): Promise<void> {
	const id = formData.get('id');
	if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('Invalid trip.');
	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) fail('Not signed in.');
	const { data, error } = await supabase.from('trips').delete().eq('id', id).select('id');
	if (error) fail(error.message);
	if (!data || data.length === 0) fail('Nothing deleted: you can only delete your own trips.');
	await recordAudit({ actor_id: auth.user.id, entity_kind: 'supabase', entity_ref: `trips/${id}`, action: 'trip.delete' });
	done();
}
