'use server';

// Server action: upsert client_meta for a client. client_meta is keyed by the
// primary contract's Airtable id (0002); the redirect target is the
// clients_v2.id route (decision 13 rekey).
// Admin/exec gated. Captures the narrative + flag + link bundle fields
// from the /clients/[id]/edit form.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { explainAndLog } from '@/lib/errors';

interface FormState {
	error: string | null;
	success: boolean;
}

interface ClientMetaKey {
	/** clients_v2.id — the route key. */
	clientId: string;
	/** contracts.airtable_contract_id — the client_meta key. */
	contractId: string;
}

export async function saveClientMeta(
	key: ClientMetaKey,
	_prev: FormState,
	formData: FormData,
): Promise<FormState> {
	const { clientId, contractId } = key;
	if (!contractId) return { error: 'This client has no Airtable contract to attach client_meta to.', success: false };
	const supabase = await createClient();

	// Auth + role gate
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { error: 'Not authenticated', success: false };

	const { data: me } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	if (!me || !['exec', 'admin', 'manager'].includes(me.role)) {
		return { error: 'Forbidden — admin, exec, or manager only', success: false };
	}

	// Helpers
	const str = (k: string) => {
		const v = formData.get(k);
		return typeof v === 'string' && v.trim() ? v.trim() : null;
	};
	const bool = (k: string) => formData.get(k) === 'on';
	const num = (k: string) => {
		const v = formData.get(k);
		if (typeof v !== 'string' || !v) return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	};

	// Build the links jsonb from individual url inputs
	const links: Record<string, string> = {};
	for (const key of [
		'drive',
		'strategy',
		'twelve_week',
		'friday_recap',
		'monthly_report',
		'call_agenda',
		'product_tracker',
		'media_tracker',
		'assignments',
		'strategy_survey',
		'termination_letter',
		'pause_report',
		'media_assets',
	]) {
		const v = str(`links.${key}`);
		if (v) links[key] = v;
	}

	const payload = {
		airtable_contract_id: contractId,
		contract_legal_name: str('contract_legal_name'),
		website_url: str('website_url'),
		brand_anniversary: str('brand_anniversary'),
		client_calendar_url: str('client_calendar_url'),
		context_md: str('context_md'),
		story_md: str('story_md'),
		history_md: str('history_md'),
		pr_goals_md: str('pr_goals_md'),
		contracted_deliverables_md: str('contracted_deliverables_md'),
		feedback_md: str('feedback_md'),
		has_influencer: bool('has_influencer'),
		has_social: bool('has_social'),
		has_awards: bool('has_awards'),
		has_podcasts: bool('has_podcasts'),
		notice_period_days: num('notice_period_days') ?? 60,
		first_live_link_url: str('first_live_link_url'),
		first_national_url: str('first_national_url'),
		links,
	};

	const { error } = await supabase
		.from('client_meta')
		.upsert(payload, { onConflict: 'airtable_contract_id' });

	if (error) {
		return { error: explainAndLog(error, 'edit.actions'), success: false };
	}

	// Audit log
	await supabase.from('audit_log').insert({
		actor_id: user.id,
		entity_kind: 'supabase',
		entity_ref: `client_meta/${contractId}`,
		action: 'update',
		diff: payload,
	});

	revalidatePath(`/clients/${clientId}`);
	revalidatePath(`/clients/${clientId}/edit`);
	redirect(`/clients/${clientId}`);
}

// Org tag lives on clients_v2 itself (0103_org_tag_on_clients), not on
// client_meta — separate table, separate action. Write policy is
// clients_v2_org_update (admin only); this gate mirrors it so the error the
// user sees is ours, not a raw RLS message.
export async function saveClientOrg(clientId: string, formData: FormData): Promise<FormState> {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { error: 'Not authenticated', success: false };

	const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (!me || !['exec', 'admin'].includes(me.role)) {
		return { error: 'Forbidden — admin or exec only', success: false };
	}

	const raw = formData.get('org_tag_id');
	const orgTagId = typeof raw === 'string' && raw ? raw : null;

	const { error } = await supabase.from('clients_v2').update({ org_tag_id: orgTagId }).eq('id', clientId);
	if (error) {
		return { error: explainAndLog(error, 'edit.actions.org'), success: false };
	}

	await supabase.from('audit_log').insert({
		actor_id: user.id,
		entity_kind: 'supabase',
		entity_ref: `clients_v2/${clientId}`,
		action: 'update',
		diff: { org_tag_id: orgTagId },
	});

	revalidatePath(`/clients/${clientId}`);
	revalidatePath(`/clients/${clientId}/edit`);
	redirect(`/clients/${clientId}/edit`);
}
