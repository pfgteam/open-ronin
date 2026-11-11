// Shape returned by public.mcp_identity_registry() (migration 0106), shared
// by /admin/identities and the spine:identities:read MCP tool. No server
// imports here on purpose (see open-ronin-feature-workflow: *Shared modules).

export type RegistryConsumer = {
	slug: string;
	name: string;
	scopes: string[];
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
};

export type RegistryIdentity = {
	slug: string;
	tier: 'reader' | 'writer' | 'audit' | 'personal_assistant';
	pg_role: string;
	workflow: string;
	justification: string;
	enabled: boolean;
	created_at: string;
	disabled_at: string | null;
	allowed_scopes: string[];
	owner: { id: string; email: string; name: string | null } | null;
	display_name: string | null;
	consumers: RegistryConsumer[];
	table_grants: string[];
	last_audit_at: string | null;
	audit_rows_30d: number;
};

export type UnboundConsumer = Omit<RegistryConsumer, 'revoked_at'>;

/** Days since a timestamp, or null. */
export function daysSince(iso: string | null, now = Date.now()): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return null;
	return Math.floor((now - t) / 86_400_000);
}

export type IdentityFlag =
	| 'disabled'
	| 'no_owner'
	| 'no_live_consumer'
	| 'consumer_never_used'
	| 'consumer_stale_90d'
	| 'consumer_over_ceiling';

/**
 * Hygiene flags for the registry page and the audit tool (Ops bot items 5/6:
 * "which identities exist, are any over-scoped, is anything stale"). Pure
 * so it is unit-testable; the DB trigger already refuses over-ceiling rows,
 * so that flag only fires on rows bound before 0106 applied.
 */
export function identityFlags(row: RegistryIdentity, now = Date.now()): IdentityFlag[] {
	const flags: IdentityFlag[] = [];
	if (!row.enabled) flags.push('disabled');
	if (!row.owner) flags.push('no_owner');
	const live = row.consumers.filter((c) => !c.revoked_at);
	if (row.enabled && live.length === 0) flags.push('no_live_consumer');
	const ceiling = new Set(row.allowed_scopes);
	for (const c of live) {
		if (!c.last_used_at) {
			if (!flags.includes('consumer_never_used')) flags.push('consumer_never_used');
		} else {
			const d = daysSince(c.last_used_at, now);
			if (d !== null && d >= 90 && !flags.includes('consumer_stale_90d')) flags.push('consumer_stale_90d');
		}
		if (c.scopes.some((s) => !ceiling.has(s)) && !flags.includes('consumer_over_ceiling')) {
			flags.push('consumer_over_ceiling');
		}
	}
	return flags;
}

export const FLAG_LABELS: Record<IdentityFlag, string> = {
	disabled: 'Disabled',
	no_owner: 'No owner (sub)',
	no_live_consumer: 'No live token',
	consumer_never_used: 'Token never used',
	consumer_stale_90d: 'Token idle 90d+',
	consumer_over_ceiling: 'Token exceeds ceiling',
};
