// Composed position rendering (migration 0033).
//
// Naming convention (Sam, 19/08/2026):
//   {department} + {track: Analyst/Specialist/Coordinator/...} + {level I/II/III}
//   e.g. "Media Specialist II"
// The position is stored as components on profiles (department_tag_id,
// position_track, position_level) and RENDERED here — never typed by hand.
// The free-text role (what the person actually does) is profiles.job_role.

export function romanLevel(level: number | null | undefined): string | null {
	if (level === 1) return 'I';
	if (level === 2) return 'II';
	if (level === 3) return 'III';
	return null;
}

/**
 * Renders the composed position from its components. Missing components are
 * simply omitted ("Media Specialist", "Specialist II", "Media"…); returns
 * null when nothing is set so callers can fall back to the legacy title.
 */
export function formatPosition(
	departmentLabel: string | null | undefined,
	trackLabel: string | null | undefined,
	level: number | null | undefined,
): string | null {
	const parts = [departmentLabel, trackLabel, romanLevel(level)].filter(Boolean);
	return parts.length > 0 ? parts.join(' ') : null;
}
