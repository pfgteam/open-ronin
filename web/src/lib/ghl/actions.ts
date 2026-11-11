'use server';

// Server actions invoked from the GHL admin page.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { syncContacts, syncLocations, syncOpportunities } from './sync';

async function requireAdmin() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error('Not authenticated');
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
	if (!profile || !['exec', 'admin'].includes(profile.role ?? '')) {
		throw new Error('Forbidden - exec/admin only');
	}
	return { supabase, user };
}

export async function syncLocationsAction(connectionId: string) {
	try {
		await requireAdmin();
		const result = await syncLocations(connectionId);
		revalidatePath('/admin/integrations/ghl');
		return { ok: true, result };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function syncContactsAction(connectionId: string, locationId: string) {
	try {
		await requireAdmin();
		const result = await syncContacts(connectionId, locationId);
		revalidatePath('/admin/integrations/ghl');
		return { ok: true, result };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function syncOpportunitiesAction(connectionId: string, locationId: string) {
	try {
		await requireAdmin();
		const result = await syncOpportunities(connectionId, locationId);
		revalidatePath('/admin/integrations/ghl');
		return { ok: true, result };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function setConnectionLabelAction(connectionId: string, label: string | null) {
	try {
		const { supabase } = await requireAdmin();
		await supabase.from('ghl_connections').update({ label }).eq('id', connectionId);
		revalidatePath('/admin/integrations/ghl');
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function disconnectGhlAction(connectionId: string) {
	try {
		const { supabase } = await requireAdmin();
		await supabase.from('ghl_connections').update({ disconnected_at: new Date().toISOString() }).eq('id', connectionId);
		revalidatePath('/admin/integrations/ghl');
		revalidatePath('/admin/integrations');
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
