'use server';

// Scan AI (decision 2026-11-03/04): any rep can scan a person or a brand;
// the scan only reads and returns a diff, applyScan writes the fields the rep
// ticked. RLS (can_view_revenue) guards both reads and the update. LinkedIn
// spend is capped per rep in lib/revenue/scan.ts.

import { revalidatePath } from 'next/cache';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { scanBrand, scanPerson, type ScanOutcome } from '@/lib/revenue/scan';
import { allowedValues, type ScanTarget } from '@/lib/revenue/scanFields';

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function scanRecord(input: { target: ScanTarget; id: string }): Promise<Result<{ scan: ScanOutcome }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if ((input.target !== 'person' && input.target !== 'brand') || !UUID.test(input.id)) return { ok: false, error: 'Invalid record.' };
	const supabase = await createClient();
	try {
		const scan = input.target === 'person' ? await scanPerson(supabase, input.id, profile.id) : await scanBrand(supabase, input.id);
		if (!scan) return { ok: false, error: 'Record not found, or you cannot see it.' };
		return { ok: true, scan };
	} catch (e) {
		console.error('[prospects/scan] failed', e);
		return { ok: false, error: 'The scan failed. Try again in a minute.' };
	}
}

export async function applyScan(input: { target: ScanTarget; id: string; values: Record<string, string>; sources: string[] }): Promise<Result<{ applied: number }>> {
	const profile = await getAuthProfile();
	if (!profile) return { ok: false, error: 'Sign in first.' };
	if ((input.target !== 'person' && input.target !== 'brand') || !UUID.test(input.id)) return { ok: false, error: 'Invalid record.' };
	const values = allowedValues(input.target, input.values ?? {});
	const keys = Object.keys(values);
	if (!keys.length) return { ok: false, error: 'Tick at least one field.' };
	const supabase = await createClient();
	const table = input.target === 'person' ? 'rev_people' : 'rev_brands';
	const { data: row } = await supabase.from(table).select(input.target === 'person' ? 'enrichment' : 'enrichment, socials, domain').eq('id', input.id).maybeSingle();
	if (!row) return { ok: false, error: 'Record not found, or you cannot edit it.' };
	const current = row as unknown as { enrichment: Record<string, unknown> | null; socials?: Record<string, string> | null; domain?: string | null };

	const patch: Record<string, unknown> = {};
	const socials: Record<string, string> = { ...(current.socials ?? {}) };
	for (const [k, v] of Object.entries(values)) {
		if (k.startsWith('socials.')) socials[k.slice(8)] = v;
		else patch[k] = v;
	}
	if (input.target === 'brand') {
		if (keys.some((k) => k.startsWith('socials.'))) patch.socials = socials;
		if (patch.website && !current.domain) {
			try {
				patch.domain = new URL(String(patch.website)).hostname.replace(/^www\./, '');
			} catch {
				/* not a URL: leave the domain alone */
			}
		}
	}
	patch.enrichment = { ...(current.enrichment ?? {}), scan_ai: { at: new Date().toISOString(), by: profile.id, applied: values, sources: (input.sources ?? []).slice(0, 4) } };

	const { error, count } = await supabase.from(table).update(patch, { count: 'exact' }).eq('id', input.id);
	if (error) return { ok: false, error: /duplicate key/i.test(error.message) ? 'Another record already uses one of these values (email or LinkedIn).' : error.message };
	if (!count) return { ok: false, error: 'Nothing saved: you cannot edit this record.' };
	await recordAudit({ actor_id: profile.id, entity_kind: 'supabase', entity_ref: `${table}/${input.id}`, action: 'revenue.scan.apply', diff: values });
	revalidatePath('/prospects', 'layout');
	return { ok: true, applied: keys.length };
}
