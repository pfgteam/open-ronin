// Pure rules for the deal page (spec 2026-10-20): which tab a URL opens, the
// short brief on Summary, the qualification count, the header facts, which
// stage moves offer Undo, and the quick-add checks.

import { FIT_SIGNAL_FIELDS, formatCents, type DealCard, type StageRow } from './shared';

export type DealTab = 'summary' | 'calls' | 'closing' | 'edit';

/** Intel now lives in Calls and Documents in Closing; old links keep working (§5, §6). */
export function dealTab(raw: string | undefined): DealTab {
	if (raw === 'calls' || raw === 'intel') return 'calls';
	if (raw === 'closing' || raw === 'documents') return 'closing';
	if (raw === 'edit') return 'edit';
	return 'summary';
}

/** The first lines of a brief for the Prep card, without headings or blank lines. */
export function briefExcerpt(md: string, maxLines = 5): string {
	return md
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l.trim() && !/^#{1,6}\s/.test(l.trim()))
		.slice(0, maxLines)
		.join('\n');
}

const answered = (v: unknown) => v !== null && v !== undefined && v !== '';

/** Budget band, timing and every fit question; `false` is an answer. */
export function qualificationProgress(deal: Pick<DealCard, 'budget_band' | 'timing' | 'fit_signals'>): { answered: number; total: number; missing: string[] } {
	const f = (deal.fit_signals ?? {}) as Record<string, unknown>;
	const items: [string, unknown][] = [['Budget band', deal.budget_band], ['Timing', deal.timing], ...FIT_SIGNAL_FIELDS.map((fld) => [fld.label, f[fld.key]] as [string, unknown])];
	const missing = items.filter(([, v]) => !answered(v)).map(([label]) => label);
	return { answered: items.length - missing.length, total: items.length, missing };
}

/** Same pattern as Self → Sales and the board: no Undo across pipelines, for hand-offs, or into won/lost. */
export function stageUndoable(target: Pick<StageRow, 'pipeline_id' | 'handoff_pipeline_id' | 'outcome'>, currentPipelineId: string): boolean {
	return target.pipeline_id === currentPipelineId && !target.handoff_pipeline_id && target.outcome === 'open';
}

export type HeaderFact = { label: string; value: string; href?: string };

/** The header's facts line (§3): only what exists, in a fixed order. */
export function headerFacts(deal: DealCard, who: (id: string | null) => string | null, person: { title: string | null; email: string | null; phone: string | null } | null): HeaderFact[] {
	const out: HeaderFact[] = [];
	if (deal.person_name) out.push({ label: 'Contact', value: [deal.person_name, person?.title].filter(Boolean).join(' · '), href: deal.primary_person_id ? `/prospects/people/${deal.primary_person_id}` : undefined });
	if (person?.email) out.push({ label: 'Email', value: person.email, href: `mailto:${person.email}` });
	if (person?.phone) out.push({ label: 'Phone', value: person.phone, href: `tel:${person.phone.replace(/[^+\d]/g, '')}` });
	const mrr = deal.est_mrr_cents ?? 0;
	const once = deal.est_one_time_cents ?? 0;
	if (mrr || once) out.push({ label: 'Value', value: [mrr ? `${formatCents(mrr)}/mo` : '', once ? `${formatCents(once)} once` : ''].filter(Boolean).join(' + ') });
	for (const [label, id] of [['Closer', deal.owner_closer_id], ['Setter', deal.owner_setter_id], ['Lead gen', deal.owner_lg_id]] as const) {
		const name = id ? who(id) : null;
		if (name) out.push({ label, value: name });
	}
	if (deal.brand_name) out.push({ label: 'Brand', value: deal.brand_name, href: deal.brand_id ? `/prospects/brands/${deal.brand_id}` : undefined });
	return out;
}

/** Quick add has one Name field; GHL pushes first_name, so split it (first word / the rest). */
export function splitDisplayName(name: string): { first_name: string | null; last_name: string | null } {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return { first_name: null, last_name: null };
	return { first_name: parts[0], last_name: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

/**
 * Quick add only (§7): a name plus an email or a phone, and a pipeline. First
 * or last name under More fields count as the name. A form pre-filled from an
 * existing person or brand ("Add deal" on their page) keeps the old rule —
 * any one identifier — so brand-only and LinkedIn-only records can still get
 * a deal (review 2026-10-20).
 */
export function quickAddError(v: {
	display_name?: string;
	first_name?: string;
	last_name?: string;
	email?: string;
	phone?: string;
	linkedin_url?: string;
	brand_name?: string;
	pipeline?: string;
	prefilled?: boolean;
}): { field: 'display_name' | 'contact' | 'pipeline'; message: string } | null {
	const has = (x?: string) => !!x?.trim();
	const named = has(v.display_name) || has(v.first_name) || has(v.last_name);
	if (v.prefilled) {
		if (!named && !has(v.email) && !has(v.phone) && !has(v.linkedin_url) && !has(v.brand_name)) return { field: 'display_name', message: 'Give at least a name, email, phone, LinkedIn URL or brand.' };
	} else {
		if (!named) return { field: 'display_name', message: 'Add a name.' };
		if (!has(v.email) && !has(v.phone)) return { field: 'contact', message: 'Add an email or a phone.' };
	}
	if (!has(v.pipeline)) return { field: 'pipeline', message: 'Pick a pipeline.' };
	return null;
}

const BACKSLASH = String.fromCharCode(92);

/** Escape ilike's wildcards (% and _) and its escape character so a brand name matches literally. */
export function ilikeEscape(s: string): string {
	let out = '';
	for (const c of s) out += c === '%' || c === '_' || c === BACKSLASH ? BACKSLASH + c : c;
	return out;
}
