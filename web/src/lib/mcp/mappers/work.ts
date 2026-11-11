// Pure allowlist mapper for the work:read tool. `projects` carries several
// internal-planning columns (notes_md, lead_measure_md, lag_measure_md,
// process_action_md) that must never leave the server.

// The 17 kinds currently allowed by projects_kind_check
// (0016:24-31 + 'bug' from 0111). Keep in sync with that constraint.
export const WORK_ITEM_KINDS = [
	'goal', 'priority', 'process', 'recurring',
	'project', 'stage', 'task',
	'client_work', 'assignment', 'strategy', 'client_goal', 'target',
	'campaign', 'twelve_week_plan',
	'event', 'product_launch',
	'bug',
] as const;

export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

/** kind=bug vocabulary (0162). Severity mirrors projects_severity_check; environment is free text there, these are the suggested values. */
export const BUG_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export const BUG_ENVIRONMENTS = ['production', 'preview', 'staging', 'local'] as const;
export type BugEnvironment = (typeof BUG_ENVIRONMENTS)[number];

export type ProjectRow = {
	id: string;
	name: string;
	kind: string;
	status: string;
	priority: string | null;
	owner_id: string | null;
	starts_at: string | null;
	ends_at: string | null;
	description_md: string | null;
	client_id: string | null;
};

export type WorkItemRow = {
	id: string;
	name: string;
	kind: string;
	status: string;
	priority: string | null;
	owner_name: string | null;
	owner_email: string | null;
	starts_at: string | null;
	ends_at: string | null;
	description_md: string | null;
	/** clients_v2 id (the Airtable contract link was retired with The Work rework). */
	client_id: string | null;
	url: string;
};

export type BugProjectRow = ProjectRow & {
	severity: string | null;
	environment: string | null;
	is_regression: boolean | null;
	created_at: string;
	updated_at: string | null;
};

export type BugRow = WorkItemRow & {
	severity: string | null;
	environment: string | null;
	regression: boolean;
	created_at: string;
	updated_at: string | null;
};

export function mapBug(
	raw: BugProjectRow,
	owner: { ownerName: string | null; ownerEmail: string | null },
): BugRow {
	return {
		...mapWorkItem(raw, owner),
		severity: raw.severity,
		environment: raw.environment,
		regression: raw.is_regression === true,
		created_at: raw.created_at,
		updated_at: raw.updated_at,
	};
}

export function mapWorkItem(
	raw: ProjectRow,
	owner: { ownerName: string | null; ownerEmail: string | null },
): WorkItemRow {
	return {
		id: raw.id,
		name: raw.name,
		kind: raw.kind,
		status: raw.status,
		priority: raw.priority,
		owner_name: owner.ownerName,
		owner_email: owner.ownerEmail,
		starts_at: raw.starts_at,
		ends_at: raw.ends_at,
		description_md: raw.description_md,
		client_id: raw.client_id,
		url: `/the-work/${raw.id}`,
	};
}

/** A work item is overdue if it has an end date strictly before today and its status isn't terminal for its kind. Due today is not overdue. */
export function isOverdue(endsAt: string | null, today: string, isTerminal: boolean): boolean {
	if (!endsAt) return false;
	if (isTerminal) return false;
	return endsAt < today;
}

/** Statuses are scoped per kind (the-work/_lib.ts:337-358) — the same slug can be terminal for one kind and not another. */
export function terminalKey(kind: string, slug: string): string {
	return `${kind}:${slug}`;
}

export function buildTerminalSet(rows: Array<{ kind: string; slug: string; is_terminal: boolean }>): Set<string> {
	const set = new Set<string>();
	for (const r of rows) {
		if (r.is_terminal) set.add(terminalKey(r.kind, r.slug));
	}
	return set;
}

/**
 * Kinds without their own status config inherit a sibling kind's set
 * (the-work/_lib.ts:50-54) — but ONLY when that sibling actually has a
 * config; alias to nothing just returns the original kind unchanged.
 * Aliasing unconditionally (as if every alias target were configured) would
 * disagree with the page for a kind whose alias target has since lost its
 * config too.
 */
export function resolveTerminalKind(
	kind: string,
	kindsWithConfig: Set<string>,
	aliases: Record<string, string>,
): string {
	if (kindsWithConfig.has(kind)) return kind;
	const alias = aliases[kind];
	return alias && kindsWithConfig.has(alias) ? alias : kind;
}
