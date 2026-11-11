// Which metrics does this person answer for, in this month?
//
// Pulled out of MetricsSection so the rule is testable: the component fetches,
// this decides. Three inputs — the catalog, the person's specialty, and the
// per-person deltas from profile_metric_overrides (migration 0050).
//
// The rule:
//   rows = (specialty's set  ∪  explicitly added)  −  explicitly removed
//
// with one exception, which is the only judgment call in here: a `remove` does
// NOT hide a metric that already has a value saved for the open month. You do
// not erase a number somebody already reported — the row stays so it can be
// seen and corrected, and disappears next month once there is nothing to hide.
//
// This also replaces an accident. Before 0050, a metric outside the specialty
// appeared purely BECAUSE a value existed for it, a leftover of the sheet
// import that read as a feature. Same behaviour, now stated as a rule and
// scoped to the case it is actually good for.

export interface MetricDefLike {
	key: string;
	pap_positions: string[];
	sort: number;
}

export type OverrideMode = 'add' | 'remove';

export interface MetricOverride {
	metric_key: string;
	mode: OverrideMode;
}

export interface ResolveInput<D extends MetricDefLike> {
	/** Active catalog definitions, any order. */
	defs: D[];
	/** The person's specialty (profiles.pap_position); null = no specialty set. */
	papPosition: string | null;
	/** Per-person deltas for this profile. */
	overrides: MetricOverride[];
	/** Metric keys that already have a row saved for the open month. */
	keysWithValues: Iterable<string>;
}

export interface ResolvedRow<D extends MetricDefLike> {
	def: D;
	/** True when this row is here because of an `add`, not the specialty. */
	granted: boolean;
	/** True when a `remove` is being overridden by an existing value. */
	keptForValue: boolean;
}

export function resolveMetricRows<D extends MetricDefLike>({
	defs,
	papPosition,
	overrides,
	keysWithValues,
}: ResolveInput<D>): ResolvedRow<D>[] {
	const added = new Set(overrides.filter((o) => o.mode === 'add').map((o) => o.metric_key));
	const removed = new Set(overrides.filter((o) => o.mode === 'remove').map((o) => o.metric_key));
	const hasValue = new Set(keysWithValues);

	const rows: ResolvedRow<D>[] = [];
	for (const def of defs) {
		const fromSpecialty = papPosition != null && def.pap_positions.includes(papPosition);
		const granted = added.has(def.key);
		if (!fromSpecialty && !granted) continue;

		// A `remove` wins unless there is already a number to answer for.
		const keptForValue = removed.has(def.key) && hasValue.has(def.key);
		if (removed.has(def.key) && !keptForValue) continue;

		rows.push({ def, granted: granted && !fromSpecialty, keptForValue });
	}

	// Catalog order, so a granted metric lands where it belongs rather than
	// being tacked on at the end.
	return rows.sort((a, b) => a.def.sort - b.def.sort || a.def.key.localeCompare(b.def.key));
}

/**
 * The deltas needed to turn the specialty's set into `wanted` — what the
 * picker saves. Only differences are returned, so a profile keeps following
 * the catalog everywhere the manager did not overrule it.
 */
export function diffToOverrides<D extends MetricDefLike>(
	defs: D[],
	papPosition: string | null,
	wanted: Iterable<string>,
): MetricOverride[] {
	const want = new Set(wanted);
	const out: MetricOverride[] = [];
	for (const def of defs) {
		const fromSpecialty = papPosition != null && def.pap_positions.includes(papPosition);
		if (want.has(def.key) && !fromSpecialty) out.push({ metric_key: def.key, mode: 'add' });
		if (!want.has(def.key) && fromSpecialty) out.push({ metric_key: def.key, mode: 'remove' });
	}
	return out;
}

/**
 * A fingerprint of the metrics a specialty currently grants.
 *
 * The picker submits absolute intent, so a form rendered before someone edits
 * /admin/metrics would, on save, withhold everything added in between — the
 * catalog change would be silently undone for that one person. The form carries
 * this string and the action recomputes it; a mismatch means the page is stale
 * and the save is refused instead of applied to the wrong baseline.
 */
export function specialtyFingerprint(
	defs: { key: string; pap_positions: string[] }[],
	papPosition: string | null,
): string {
	return defs
		.filter((d) => papPosition != null && d.pap_positions.includes(papPosition))
		.map((d) => d.key)
		.sort()
		.join(',');
}
