// The 4R (Role, Responsibilities, Results, Requirements) on a profile.
// Migration 0093. Pure helpers only: no Supabase, no server imports, because
// the client section imports this file (a server import here would drag the
// Supabase server client into the browser bundle). The permission check
// lives in lib/people/permissions.ts with its siblings.

/** The four sections, in display order. `key` is the DB column stem. */
export const FOUR_R_SECTIONS = [
	{ key: 'role', label: 'Role', hint: 'What this position is for, in a paragraph or two.' },
	{ key: 'responsibilities', label: 'Responsibilities', hint: 'What the person does. One item per line, starting with "- ".' },
	{ key: 'results', label: 'Results', hint: 'What it looks like when the role is done well. One item per line.' },
	{ key: 'requirements', label: 'Requirements', hint: 'Skills, experience and traits the role needs. One item per line.' },
] as const;

export type FourRSectionKey = (typeof FOUR_R_SECTIONS)[number]['key'];

/** A `four_r_templates` row (0093). */
export interface FourRTemplate {
	slug: string;
	position_label: string;
	department: string | null;
	reports_to: string | null;
	role_md: string;
	responsibilities_md: string;
	results_md: string;
	requirements_md: string;
	match_keywords: string[];
	source_url: string | null;
	sort: number;
}

/** A `profile_four_r` row (0093). */
export interface ProfileFourR {
	user_id: string;
	position_label: string;
	department: string | null;
	reports_to: string | null;
	role_md: string;
	responsibilities_md: string;
	results_md: string;
	requirements_md: string;
	template_slug: string | null;
	source: 'template' | 'drive' | 'manual';
	source_url: string | null;
	revision: number;
	created_by: string | null;
	updated_by: string | null;
	created_at: string;
	updated_at: string;
}

/** A `profile_four_r_revisions` row, with the actor's name joined in. */
export interface FourRRevision {
	id: number;
	revision: number;
	snapshot: Record<string, unknown>;
	changed_fields: string[];
	change_note: string | null;
	changed_by: string | null;
	changed_by_name: string | null;
	changed_at: string;
}

/** The editable shape: what the form carries and what the action validates. */
export interface FourRDraft {
	position_label: string;
	department: string | null;
	reports_to: string | null;
	role_md: string;
	responsibilities_md: string;
	results_md: string;
	requirements_md: string;
}

/** The profile fields the matcher reads. Every one may be empty. */
export interface FourRMatchInput {
	job_role?: string | null;
	pap_position?: string | null;
	position_track?: string | null;
	title?: string | null;
	department?: string | null;
}

/**
 * Walks `manager_id` upward from `subjectId` and reports whether `viewerId`
 * is on the way up. Takes the whole (id → manager_id) map so the page issues
 * one query, not one per hop. Capped like the SQL version so a cycle cannot
 * spin.
 */
export function isInLeadershipChain(
	viewerId: string | null,
	subjectId: string,
	managerOf: ReadonlyMap<string, string | null>,
	maxHops = 12,
): boolean {
	if (!viewerId || viewerId === subjectId) return false;
	let cursor: string | null | undefined = managerOf.get(subjectId);
	for (let hop = 0; hop < maxHops && cursor; hop++) {
		if (cursor === viewerId) return true;
		cursor = managerOf.get(cursor);
	}
	return false;
}

function norm(s: string | null | undefined): string {
	return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Picks the template that best describes a person, or null when nothing
 * matches at all.
 *
 * Scoring, highest wins:
 *   - keyword found in job_role: 100 + keyword length (a longer keyword is a
 *     more specific claim: "social media account manager" beats "manager")
 *   - keyword found in pap_position (the specialty): 60 + length
 *   - keyword found in title: 40 + length
 *   - keyword equals position_track (Assistant/Analyst/…): 20
 *   - ties broken by the template's `sort` (specific positions sort before
 *     the generic ones, which sit at 900+)
 *
 * The generic track templates only carry their track word as a keyword, so
 * they win only when nothing specific did.
 */
export function pickFourRTemplate(
	input: FourRMatchInput,
	templates: readonly FourRTemplate[],
): FourRTemplate | null {
	const jobRole = norm(input.job_role);
	const specialty = norm(input.pap_position);
	const title = norm(input.title);
	const track = norm(input.position_track);

	let best: { t: FourRTemplate; score: number } | null = null;
	for (const t of templates) {
		let score = 0;
		for (const raw of t.match_keywords) {
			const kw = norm(raw);
			if (!kw) continue;
			const hit = (hay: string, base: number) =>
				hay && (hay === kw || hay.includes(kw)) ? base + kw.length : 0;
			score = Math.max(
				score,
				hit(jobRole, 100),
				hit(specialty, 60),
				hit(title, 40),
				track && track === kw ? 20 : 0,
			);
		}
		if (score === 0) continue;
		if (!best || score > best.score || (score === best.score && t.sort < best.t.sort)) {
			best = { t, score };
		}
	}
	return best?.t ?? null;
}

/** A draft prefilled from a template, for a person with no 4R yet. */
export function draftFromTemplate(
	t: FourRTemplate,
	profile: { job_role?: string | null; title?: string | null; department?: string | null },
	managerName: string | null,
): FourRDraft {
	return {
		// The person's own job_role wins over the template's label when set:
		// "Junior Publicist" stays "Junior Publicist" on a Publicist template.
		position_label: (profile.job_role || profile.title || t.position_label).trim(),
		department: profile.department ?? t.department,
		reports_to: managerName ?? t.reports_to,
		role_md: t.role_md,
		responsibilities_md: t.responsibilities_md,
		results_md: t.results_md,
		requirements_md: t.requirements_md,
	};
}

/** An empty draft, for a person nothing matched. */
export function emptyDraft(
	profile: { job_role?: string | null; title?: string | null; department?: string | null },
	managerName: string | null,
): FourRDraft {
	return {
		position_label: (profile.job_role || profile.title || '').trim(),
		department: profile.department ?? null,
		reports_to: managerName,
		role_md: '',
		responsibilities_md: '',
		results_md: '',
		requirements_md: '',
	};
}

/**
 * Normalises the free text people paste into the list sections: a line that
 * is not already a bullet or a heading becomes one, blank runs collapse.
 * Keeps `**Group**` sub-headings from the templates intact.
 */
export function normaliseListMarkdown(text: string): string {
	const out: string[] = [];
	let blank = false;
	for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
		const line = raw.trimEnd();
		if (!line.trim()) {
			if (!blank && out.length) out.push('');
			blank = true;
			continue;
		}
		blank = false;
		const t = line.trim();
		if (/^([-*•]\s|\d+[.)]\s|#{1,6}\s|\*\*.+\*\*$)/.test(t)) {
			out.push(t.replace(/^[•*]\s/, '- '));
		} else {
			out.push(`- ${t}`);
		}
	}
	while (out.length && out[out.length - 1] === '') out.pop();
	return out.join('\n');
}

/** Lines that differ between two snapshots of a section, for the change log. */
export function sectionDelta(before: string, after: string): { added: string[]; removed: string[] } {
	const a = new Set(before.split('\n').map((l) => l.trim()).filter(Boolean));
	const b = new Set(after.split('\n').map((l) => l.trim()).filter(Boolean));
	return {
		added: [...b].filter((l) => !a.has(l)),
		removed: [...a].filter((l) => !b.has(l)),
	};
}
