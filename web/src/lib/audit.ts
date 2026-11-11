// Audit log helper — server-side only.
// Wrap every write that affects user-visible data with this so we have a trail.
// Audit failures NEVER bubble up: best-effort fire-and-forget with console error.

import { createServiceRoleClient } from '@/lib/supabase/server';

interface AuditEvent {
	actor_id?: string | null;
	entity_kind: 'airtable' | 'supabase' | 'auth' | 'mcp' | 'nt_tables' | 'nt_columns' | 'nt_rows' | 'nt_cells';
	entity_ref: string;
	action: string;
	diff?: unknown;
	ip?: string | null;
	status?: 'success' | 'error';
}

export async function recordAudit(event: AuditEvent): Promise<void> {
	try {
		const supabase = createServiceRoleClient();
		await supabase.from('audit_log').insert({
			actor_id: event.actor_id ?? null,
			entity_kind: event.entity_kind,
			entity_ref: event.entity_ref,
			action: event.action,
			diff: event.diff ?? null,
			ip: event.ip ?? null,
			status: event.status ?? 'success',
		});
	} catch (err) {
		// Audit failure must never break the request.
		console.error('[audit] failed to record event:', err, event);
	}
}
