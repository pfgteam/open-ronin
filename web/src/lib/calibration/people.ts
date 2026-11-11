// Calibration roster reader (0117). No `lib/supabase/server` import so client
// trees could use the vocabulary; the client itself is passed in.
//
// `profiles.calibration_excluded` (0117) marks a person who stays active and
// in the org chart but is never assessed (Vera). Until 0117 is applied the
// column does not exist, so the read falls back to the pre-0117 shape and
// treats everyone as included — the page keeps working either way.

import { envOrgDomains } from '@/lib/tenant/domains';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CalibrationPerson {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	department_tag_id: string | null;
	manager_id: string | null;
	role: string;
	calibration_excluded: boolean;
}

const WITH_FLAG = 'id, email, first_name, last_name, department_tag_id, manager_id, role, calibration_excluded';
const WITHOUT_FLAG = 'id, email, first_name, last_name, department_tag_id, manager_id, role';

/**
 * Calibration applies to internal Open Ronin staff only (Alex, 2026-10-01).
 * Mirrors `public.is_internal_staff()` (0118): staff role + company domain.
 * Every profile is staff today; this is the one place to tighten when
 * client / external accounts arrive.
 */
export const STAFF_DOMAINS: readonly string[] = envOrgDomains(); // empty = every domain counts
export const STAFF_ROLES = ['exec', 'admin', 'manager', 'contributor'] as const;
export function isInternalStaff(p: { email: string; role: string }): boolean {
	const domain = (p.email.split('@')[1] ?? '').toLowerCase();
	return (STAFF_ROLES as readonly string[]).includes(p.role) && (STAFF_DOMAINS.length === 0 || STAFF_DOMAINS.includes(domain));
}

function isMissingColumn(e: { code?: string; message?: string } | null): boolean {
	return !!e && (e.code === '42703' || /column .* does not exist|schema cache/i.test(e.message ?? ''));
}

/**
 * Active people with their exclusion flag. `excluded` rows are returned too
 * (callers decide: the roster hides them, a person view says why).
 */
export async function loadCalibrationPeople(
	supabase: SupabaseClient,
	filter?: { id?: string; includeInactive?: boolean },
): Promise<{ people: CalibrationPerson[]; flagAvailable: boolean }> {
	const run = async (cols: string) => {
		let q = supabase.from('profiles').select(cols).order('first_name');
		if (!filter?.includeInactive) q = q.eq('is_active', true);
		if (filter?.id) q = q.eq('id', filter.id);
		return q;
	};
	const first = await run(WITH_FLAG);
	if (!first.error) {
		return {
			people: ((first.data ?? []) as unknown as Partial<CalibrationPerson>[]).map((p) => ({
				...(p as CalibrationPerson),
				calibration_excluded: !!p.calibration_excluded,
			})),
			flagAvailable: true,
		};
	}
	if (!isMissingColumn(first.error)) return { people: [], flagAvailable: true };
	const second = await run(WITHOUT_FLAG);
	return {
		people: ((second.data ?? []) as unknown as Omit<CalibrationPerson, 'calibration_excluded'>[]).map((p) => ({
			...p,
			calibration_excluded: false,
		})),
		flagAvailable: false,
	};
}

/** The people who take part in a cycle: active internal staff, not excluded. */
export function assessable<T extends { calibration_excluded: boolean; email: string; role: string }>(people: T[]): T[] {
	return people.filter((p) => !p.calibration_excluded && isInternalStaff(p));
}
