// Metric surfaces + calculation/source fields (migration 0082). Shared by
// Admin -> Metrics (editing), Dashboards -> KPIs and Team -> Metrics (reading).
// No server imports.

export const METRIC_SURFACES = ['kpis', 'team'] as const;
export type MetricSurface = (typeof METRIC_SURFACES)[number];

export const SURFACE_LABELS: Record<MetricSurface, string> = {
	kpis: 'Dashboards → KPIs',
	team: 'Team → Metrics',
};

export const SURFACE_HINTS: Record<MetricSurface, string> = {
	kpis: 'The CEO-sheet style KPIs page (company-wide, by department).',
	team: 'Tracked per person or team on Team → Metrics, beyond the PAP set.',
};

/** Columns 0082 adds; absent until it is applied, so every read treats them as optional. */
export interface MetricSurfaceFields {
	surfaces?: string[] | null;
	sheet_definition?: string | null;
	sheet_source_of_truth?: string | null;
	calc_notes?: string | null;
}

export function surfacesOf(d: MetricSurfaceFields): MetricSurface[] {
	return (d.surfaces ?? []).filter((s): s is MetricSurface => (METRIC_SURFACES as readonly string[]).includes(s));
}

/** PostgREST's "column does not exist" — the signal that 0082 is not applied. */
export function isMissingColumnError(e: { code?: string; message?: string } | null | undefined): boolean {
	if (!e) return false;
	return e.code === '42703' || /column .* does not exist/i.test(e.message ?? '');
}
