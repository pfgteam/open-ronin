'use server';

// Server actions for /admin/work-engine. Every action routes by
// source_table: native rows go through the work_runs RPCs (0099), mirrored
// rows go through the SAME write their own page makes, so the domain's own
// trigger (guard_staff_request_transition, the scraper budget guard, the
// automation guards) stays the one place the rule lives. No approval logic
// is duplicated here; if a domain has no safe generic action the row only
// offers "Open".
//
// Session client on purpose for the legacy writes: RLS and the triggers
// decide, and an update that RLS filters out affects zero rows, which we
// surface instead of reporting success (the Lead Scraper cancel pattern).

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { abortRun } from '@/lib/scrapers/apify';

const PATH = '/admin/work-engine';

const Input = z.object({
	id: z.string().uuid(),
	action: z.enum(['approve', 'reject', 'cancel', 'retry']),
	note: z.string().trim().max(2000).optional(),
	return_to: z.string().optional(),
});

function back(returnTo: string | undefined, error?: string): never {
	const base = returnTo && returnTo.startsWith(PATH) ? returnTo : PATH;
	revalidatePath(PATH);
	if (!error) redirect(base);
	const sep = base.includes('?') ? '&' : '?';
	redirect(`${base}${sep}error=${encodeURIComponent(error)}`);
}

export async function actOnWorkRun(formData: FormData): Promise<void> {
	const parsed = Input.safeParse({
		id: formData.get('id'),
		action: formData.get('action'),
		note: formData.get('note') || undefined,
		return_to: formData.get('return_to') || undefined,
	});
	if (!parsed.success) back(undefined, 'Invalid request.');
	const { id, action, note, return_to } = parsed.data;

	const supabase = await createClient();
	const { data: auth } = await supabase.auth.getUser();
	if (!auth?.user) back(return_to, 'Not signed in.');

	const { data: run, error: readError } = await supabase
		.from('work_runs')
		.select('id, domain, status, source_table, source_id')
		.eq('id', id)
		.maybeSingle();
	if (readError || !run) back(return_to, readError?.message ?? 'Run not found.');

	let error: string | null = null;
	const src = run.source_table as string | null;
	const srcId = run.source_id as string | null;

	if (src === null) {
		const rpc =
			action === 'approve' || action === 'reject'
				? supabase.rpc('work_run_decide', { p_id: id, p_decision: action === 'approve' ? 'approved' : 'rejected', p_note: note ?? null })
				: action === 'cancel'
					? supabase.rpc('work_run_cancel', { p_id: id })
					: supabase.rpc('work_run_retry', { p_id: id });
		error = (await rpc).error?.message ?? null;
	} else if (src === 'staff_requests' && srcId && (action === 'approve' || action === 'reject')) {
		// Same write as decideStaffRequest on the Innovation Desk; the
		// transition trigger enforces reviewer membership and stamps decided_*.
		const res = await supabase
			.from('staff_requests')
			.update({ status: action === 'approve' ? 'approved' : 'denied', decision_note_md: note ?? null })
			.eq('id', srcId)
			.select('id');
		error = res.error?.message ?? (res.data?.length ? null : 'Nothing changed — only a member of the reviewer group decides this request.');
	} else if (src === 'scrape_jobs' && srcId && action === 'cancel') {
		const res = await supabase
			.from('scrape_jobs')
			.update({ status: 'cancelled', finished_at: new Date().toISOString() })
			.eq('id', srcId)
			.in('status', ['queued', 'running'])
			.select('apify_run_id');
		error = res.error?.message ?? (res.data?.length ? null : 'Nothing cancelled — the job already finished, or only admins/execs can cancel jobs.');
		const runId = res.data?.[0]?.apify_run_id as string | null | undefined;
		if (!error && runId) await abortRun(runId);
	} else if (src === 'content_jobs' && srcId && action === 'cancel') {
		// 0065 has no session update policy; the providers page uses the
		// service role after requireAdmin(). Here RLS already proved the viewer
		// can see the run, and the manage gate is enforced by can_manage_work_engine
		// on the page, so the same admin-only service write is acceptable.
		const { createServiceRoleClient } = await import('@/lib/supabase/server');
		const { data: me } = await supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
		if (!me || !['admin', 'exec'].includes(me.role)) error = 'Only admin and exec cancel content jobs.';
		else {
			const res = await createServiceRoleClient()
				.from('content_jobs')
				.update({ status: 'cancelled', finished_at: new Date().toISOString() })
				.eq('id', srcId)
				.in('status', ['queued', 'submitted', 'running']);
			error = res.error?.message ?? null;
		}
	} else if (src === 'automation_runs' && srcId) {
		const rpc =
			action === 'approve' || action === 'reject'
				? supabase.rpc('automation_run_decide', { p_id: srcId, p_decision: action === 'approve' ? 'approved' : 'rejected', p_note: note ?? null })
				: action === 'cancel'
					? supabase.rpc('automation_run_cancel', { p_id: srcId })
					: supabase.rpc('automation_run_retry', { p_id: srcId });
		error = (await rpc).error?.message ?? null;
	} else {
		error = `This ${run.domain} run is managed on its own page.`;
	}

	if (error) back(return_to, error);

	await recordAudit({
		actor_id: auth.user.id,
		entity_kind: 'supabase',
		entity_ref: src ? `${src}/${srcId}` : `work_runs/${id}`,
		action: `work_engine.${action}`,
		diff: { via: 'work_engine', run_id: id },
	});
	back(return_to);
}
