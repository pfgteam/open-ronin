import { describe, expect, it } from 'vitest';
import { daysSince, identityFlags, type RegistryIdentity } from './identityRegistryShared';

const NOW = Date.parse('2026-09-19T12:00:00Z');

function identity(over: Partial<RegistryIdentity> = {}): RegistryIdentity {
	return {
		slug: 'client_success',
		tier: 'reader',
		pg_role: 'agent_client_success',
		workflow: 'client-success',
		justification: 'Pulse reads client health.',
		enabled: true,
		created_at: '2026-09-19T00:00:00Z',
		disabled_at: null,
		allowed_scopes: ['clients:read', 'sessions:read'],
		owner: { id: 'u1', email: 'owner@example.com', name: 'Alex' },
		display_name: 'Client Success',
		consumers: [
			{ slug: 'pulse-cs', name: 'Pulse', scopes: ['clients:read'], created_at: '2026-09-19T00:00:00Z', last_used_at: '2026-09-19T08:00:00Z', revoked_at: null },
		],
		table_grants: [],
		last_audit_at: null,
		audit_rows_30d: 0,
		...over,
	};
}

describe('identityFlags', () => {
	it('is clean for an enabled, owned identity with a used token inside the ceiling', () => {
		expect(identityFlags(identity(), NOW)).toEqual([]);
	});
	it('flags disabled and ownerless identities', () => {
		expect(identityFlags(identity({ enabled: false, owner: null }), NOW)).toEqual(['disabled', 'no_owner']);
	});
	it('flags an enabled identity with no live token, ignoring revoked ones', () => {
		const row = identity({ consumers: [{ ...identity().consumers[0], revoked_at: '2026-09-19T09:00:00Z' }] });
		expect(identityFlags(row, NOW)).toEqual(['no_live_consumer']);
	});
	it('flags never-used and 90-day-idle tokens', () => {
		const never = identity({ consumers: [{ ...identity().consumers[0], last_used_at: null }] });
		expect(identityFlags(never, NOW)).toEqual(['consumer_never_used']);
		const stale = identity({ consumers: [{ ...identity().consumers[0], last_used_at: '2026-06-01T00:00:00Z' }] });
		expect(identityFlags(stale, NOW)).toEqual(['consumer_stale_90d']);
	});
	it('flags a token holding a scope outside the identity ceiling', () => {
		const row = identity({ consumers: [{ ...identity().consumers[0], scopes: ['clients:read', 'finance:read'] }] });
		expect(identityFlags(row, NOW)).toEqual(['consumer_over_ceiling']);
	});
});

describe('daysSince', () => {
	it('handles null and garbage', () => {
		expect(daysSince(null)).toBeNull();
		expect(daysSince('not a date')).toBeNull();
		expect(daysSince('2026-09-09T12:00:00Z', NOW)).toBe(10);
	});
});
