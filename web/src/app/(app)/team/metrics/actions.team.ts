'use server';

// Team-level metric entry for Team -> Metrics (2026-09-14). Writes
// `metrics` rows with subject_type = 'team' and subject_ref = a department
// tag slug, for definitions tagged with the `team` surface (0082). Same
// upsert shape as saveMonthlyMetrics; RLS metrics_write_managers is the real
// guard (people-managers / exec / admin), so no self-service path here.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

const PERIOD_RE = /^\d{4}-\d{2}-01$/;
const SLUG_RE = /^[a-z0-9_-]{1,64}$/;

function back(period: string, dept: string | null, extra: string): never {
	const usp = new URLSearchParams({ month: period.slice(0, 7) });
	if (dept) usp.set('dept', dept);
	redirect(`/team/metrics?${usp.toString()}&${extra}`);
}

export async function saveTeamMetrics(deptSlug: string, period: string, formData: FormData): Promise<void> {
	if (!SLUG_RE.test(deptSlug)) redirect('/team/metrics');
	if (!PERIOD_RE.test(period)) redirect('/team/metrics');

	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) back(period, deptSlug, `error=${encodeURIComponent('You are signed out — sign in again and retry.')}`);
	if (!canManagePeople(ctx)) back(period, deptSlug, `error=${encodeURIComponent('Only people-managers, exec or admin enter team-level numbers.')}`);

	const entries = new Map<string, { value: number | null; goal: number | null }>();
	for (const [field, raw] of formData.entries()) {
		const m = /^(value|goal):(.+)$/.exec(field);
		if (!m || typeof raw !== 'string') continue;
		const [, kind, key] = m;
		const trimmed = raw.trim();
		const num = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
		if (num !== null && !Number.isFinite(num)) back(period, deptSlug, `error=${encodeURIComponent(`"${key}": enter a number.`)}`);
		const cur = entries.get(key) ?? { value: null, goal: null };
		if (kind === 'value') cur.value = num;
		else cur.goal = num;
		entries.set(key, cur);
	}
	const toWrite = [...entries.entries()].filter(([, e]) => e.value !== null || e.goal !== null);
	if (toWrite.length === 0) back(period, deptSlug, 'saved=0');

	const supabase = await createClient();
	const { data: existing } = await supabase
		.from('metrics')
		.select('id, metric_key')
		.eq('subject_type', 'team')
		.eq('subject_ref', deptSlug)
		.eq('period', period)
		.eq('source', 'manual');
	const byKey = new Map((existing ?? []).map((r) => [r.metric_key as string, r.id as string]));

	let saved = 0;
	for (const [key, e] of toWrite) {
		const id = byKey.get(key);
		const patch: Record<string, unknown> = { entered_by: ctx.viewerId };
		if (e.value !== null) patch.value = e.value;
		if (e.goal !== null) patch.goal = e.goal;
		const { error } = id
			? await supabase.from('metrics').update(patch).eq('id', id)
			: await supabase.from('metrics').insert({
					subject_type: 'team',
					subject_ref: deptSlug,
					metric_key: key,
					period,
					value: e.value,
					goal: e.goal,
					source: 'manual',
					entered_by: ctx.viewerId,
				});
		if (error) back(period, deptSlug, `error=${encodeURIComponent(`Could not save "${key}": ${error.message}`)}`);
		saved += 1;
	}

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `metrics/team/${deptSlug}/${period}`,
		action: 'metrics.team.save',
		diff: { period, dept: deptSlug, metrics: toWrite.map(([k]) => k), count: saved },
	});
	revalidatePath('/team/metrics');
	back(period, deptSlug, `saved=${saved}`);
}

