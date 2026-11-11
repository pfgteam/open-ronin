'use server';

// Lead Scraper → Prospects (0156): the connector kill switch and the backlog
// sender. manage_revenue only; the SQL functions re-check.

import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { recordAudit } from '@/lib/audit';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

async function manager(): Promise<{ id: string } | null> {
	const profile = await getAuthProfile();
	if (!profile || !(await hasCapability('manage_revenue'))) return null;
	return { id: profile.id };
}

export async function setScraperConnector(input: { enabled: boolean }): Promise<Result> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	const supabase = await createClient();
	const { error } = await supabase.from('rev_intake_sources').update({ enabled: input.enabled }).eq('key', 'apify_scraper');
	if (error) return { ok: false, error: error.message };
	await recordAudit({ actor_id: me.id, entity_kind: 'supabase', entity_ref: 'rev_intake_sources/apify_scraper', action: input.enabled ? 'scraper.connector.on' : 'scraper.connector.off' });
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true };
}

export async function sendScraperBacklog(): Promise<Result<{ sent: number; failed: number; remaining: number }>> {
	const me = await manager();
	if (!me) return { ok: false, error: 'You need the manage_revenue capability.' };
	const supabase = await createClient();
	const { data, error } = await supabase.rpc('rev_intake_scraped_backlog', { p_limit: 200 });
	if (error) return { ok: false, error: error.message };
	const r = data as { sent: number; failed: number; remaining: number; disabled?: boolean };
	if (r.disabled) return { ok: false, error: 'The Lead Scraper connector is off. Turn it on first.' };
	revalidatePath('/admin/prospects', 'layout');
	return { ok: true, sent: r.sent, failed: r.failed, remaining: r.remaining };
}
