'use server';

// Server actions for /team/metrics — the monthly Goal/Achieved entry that
// replaces the "2026 Individual Input" tab of the Individual Performance
// Metrics sheet (M1 of the metrics roadmap, migration 0025).
//
// Authorization: a person saves their OWN manual rows; people-managers /
// exec / admin save anyone's. RLS enforces the same at the DB layer
// (metrics_write_own_manual / metrics_write_managers).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/audit';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { diffToOverrides, specialtyFingerprint } from '@/lib/people/metricRows';

const PERIOD_RE = /^\d{4}-\d{2}-01$/;

function fail(subjectId: string, period: string, message: string): never {
	// Entry lives on the profile page since 19/08 (Alex: no second screen).
	redirect(
		`/team/${subjectId}?tab=metrics&month=${period.slice(0, 7)}&metricsError=${encodeURIComponent(message)}`,
	);
}

/**
 * Upsert the month's manual rows for one person. FormData carries pairs of
 * `value:<metric_key>` / `goal:<metric_key>` inputs; empty strings mean
 * "no entry" (existing row keeps its other field, a fully-empty pair deletes
 * nothing — clearing values is an explicit product decision for later).
 */
export async function saveMonthlyMetrics(
	subjectId: string,
	period: string,
	formData: FormData,
): Promise<void> {
	if (!z.string().uuid().safeParse(subjectId).success) redirect('/team');
	if (!PERIOD_RE.test(period)) redirect('/team');

	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) fail(subjectId, period, 'You are signed out — sign in again and retry.');
	const isSelf = ctx.viewerId === subjectId;
	if (!isSelf && !canManagePeople(ctx)) {
		fail(subjectId, period, 'Only the person themselves or a people-manager can enter metrics.');
	}

	// Collect entries per metric key.
	const entries = new Map<string, { value: number | null; goal: number | null }>();
	for (const [field, raw] of formData.entries()) {
		const m = /^(value|goal):(.+)$/.exec(field);
		if (!m || typeof raw !== 'string') continue;
		const [, kind, key] = m;
		const trimmed = raw.trim();
		const num = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
		if (num !== null && !Number.isFinite(num)) {
			fail(subjectId, period, `"${key.replace(/_/g, ' ')}": enter a number.`);
		}
		const cur = entries.get(key) ?? { value: null, goal: null };
		if (kind === 'value') cur.value = num;
		else cur.goal = num;
		entries.set(key, cur);
	}

	const toWrite = [...entries.entries()].filter(([, e]) => e.value !== null || e.goal !== null);
	if (toWrite.length === 0) {
		redirect(`/team/${subjectId}?tab=metrics&month=${period.slice(0, 7)}&metricsSaved=0`);
	}

	const supabase = await createClient();

	// Existing manual rows for this person+month → update vs insert.
	const { data: existing } = await supabase
		.from('metrics')
		.select('id, metric_key, value, goal')
		.eq('subject_type', 'user')
		.eq('subject_id', subjectId)
		.eq('period', period)
		.eq('source', 'manual');
	const byKey = new Map((existing ?? []).map((r) => [r.metric_key as string, r]));

	let saved = 0;
	for (const [key, e] of toWrite) {
		const row = byKey.get(key);
		if (row) {
			const patch: Record<string, unknown> = { entered_by: ctx.viewerId };
			if (e.value !== null) patch.value = e.value;
			if (e.goal !== null) patch.goal = e.goal;
			const { error } = await supabase.from('metrics').update(patch).eq('id', row.id);
			if (error) fail(subjectId, period, `Could not save "${key}": ${error.message}`);
		} else {
			const { error } = await supabase.from('metrics').insert({
				subject_type: 'user',
				subject_id: subjectId,
				metric_key: key,
				period,
				value: e.value,
				goal: e.goal,
				source: 'manual',
				entered_by: ctx.viewerId,
			});
			if (error) fail(subjectId, period, `Could not save "${key}": ${error.message}`);
		}
		saved += 1;
	}

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `metrics/${subjectId}/${period}`,
		action: 'metrics.monthly.save',
		diff: { period, metrics: toWrite.map(([k]) => k), count: saved },
	});

	revalidatePath(`/team/${subjectId}`);
	redirect(`/team/${subjectId}?tab=metrics&month=${period.slice(0, 7)}&metricsSaved=${saved}`);
}

/**
 * Replace one person's metric SET (migration 0050).
 *
 * FormData carries a `metric:<key>` checkbox for every metric the manager
 * wants the person to answer for. What gets stored is the DIFFERENCE from the
 * specialty's set, never the set itself — so the profile keeps following
 * /admin/metrics everywhere nobody overruled it. See metricRows.diffToOverrides.
 *
 * People-managers / exec / admin only. Unlike saveMonthlyMetrics there is no
 * self-service path: a person may enter their own numbers but not decide which
 * numbers they owe. RLS enforces the same (profile_metric_overrides_write).
 */
export async function saveMetricSet(
	subjectId: string,
	period: string,
	formData: FormData,
): Promise<void> {
	if (!z.string().uuid().safeParse(subjectId).success) redirect('/team');
	if (!PERIOD_RE.test(period)) redirect('/team');

	const ctx = await loadSensitiveAccessContext();
	if (!ctx.viewerId) fail(subjectId, period, 'You are signed out — sign in again and retry.');
	if (!canManagePeople(ctx)) {
		fail(subjectId, period, 'Only a people-manager can change which metrics apply to someone.');
	}

	const wanted = formData
		.getAll('metric')
		.filter((v): v is string => typeof v === 'string' && v.length > 0);

	// The picker submits ABSOLUTE intent ("these are the metrics"), which makes
	// a stale form destructive: opened before someone edits the catalog, saved
	// after, it silently withholds every metric that was added in between. That
	// happened on 25/08 and withheld seven. So the form carries a fingerprint of
	// the specialty set it was rendered against, and a save is refused if the
	// catalog moved underneath it.
	const baseline = formData.get('baseline');
	if (typeof baseline !== 'string') {
		fail(subjectId, period, 'This form is out of date — reopen "Which metrics" and try again.');
	}

	const supabase = await createClient();
	const [{ data: profile }, { data: defRows }] = await Promise.all([
		supabase.from('profiles').select('pap_position').eq('id', subjectId).maybeSingle(),
		supabase.from('metric_definitions').select('key, pap_positions, sort').eq('is_active', true),
	]);
	if (!defRows) fail(subjectId, period, 'Could not load the metric catalog — try again.');

	// Refuse keys that are not in the active catalog rather than writing a
	// delta that will never resolve to anything.
	const known = new Set(defRows.map((d) => d.key as string));
	const unknown = wanted.filter((k) => !known.has(k));
	if (unknown.length > 0) fail(subjectId, period, `Unknown metric: ${unknown[0]}.`);

	const currentBaseline = specialtyFingerprint(
		defRows as { key: string; pap_positions: string[] }[],
		(profile?.pap_position as string | null) ?? null,
	);
	if (baseline !== currentBaseline) {
		fail(
			subjectId,
			period,
			'The metric catalog changed while this form was open, so nothing was saved. Reopen "Which metrics" to see the current set.',
		);
	}

	const deltas = diffToOverrides(
		defRows as { key: string; pap_positions: string[]; sort: number }[],
		(profile?.pap_position as string | null) ?? null,
		wanted,
	);

	// Replace wholesale: the picker always submits the complete intent, so a
	// stale delta from a previous edit must not survive. Delete-then-insert
	// keeps that honest without needing to diff against what is stored.
	const { error: delError } = await supabase
		.from('profile_metric_overrides')
		.delete()
		.eq('profile_id', subjectId);
	// The real error (which for a Postgres/RLS failure names the table and
	// policy) is logged server-side only; the user gets a fixed human string.
	if (delError) {
		console.error('[saveMetricSet] clearing profile_metric_overrides failed:', delError.message);
		fail(subjectId, period, 'Could not update the metric set. Nothing was changed — try again.');
	}

	if (deltas.length > 0) {
		const { error } = await supabase.from('profile_metric_overrides').insert(
			deltas.map((d) => ({
				profile_id: subjectId,
				metric_key: d.metric_key,
				mode: d.mode,
				created_by: ctx.viewerId,
			})),
		);
		// Same rule as the delete above: log the real error, show a fixed string.
		// Wording differs because the delete already landed — the set is now the
		// default one, not what the user submitted.
		if (error) {
			console.error('[saveMetricSet] writing profile_metric_overrides failed:', error.message);
			fail(subjectId, period, 'Could not save the metric set. It was reset to the default — reopen "Which metrics" and try again.');
		}
	}

	await recordAudit({
		actor_id: ctx.viewerId,
		entity_kind: 'supabase',
		entity_ref: `profile_metric_overrides/${subjectId}`,
		action: 'metrics.set.save',
		diff: {
			added: deltas.filter((d) => d.mode === 'add').map((d) => d.metric_key),
			removed: deltas.filter((d) => d.mode === 'remove').map((d) => d.metric_key),
		},
	});

	revalidatePath(`/team/${subjectId}`);
	redirect(`/team/${subjectId}?tab=metrics&month=${period.slice(0, 7)}&metricsSetSaved=1`);
}
