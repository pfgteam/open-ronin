// Podcast episodes vocabulary (0111, Tier B #14). No server imports.

export const EPISODE_STATUSES = ['planned', 'scheduled', 'recorded', 'editing', 'published', 'cancelled'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
	planned: 'Planned',
	scheduled: 'Scheduled',
	recorded: 'Recorded',
	editing: 'Editing',
	published: 'Published',
	cancelled: 'Cancelled',
};

export const EPISODE_STATUS_COLORS: Record<EpisodeStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
	planned: 'default',
	scheduled: 'primary',
	recorded: 'warning',
	editing: 'warning',
	published: 'success',
	cancelled: 'danger',
};

/** Statuses the release gate protects (mirror of the 0111 CHECK). */
export const GATED_STATUSES: ReadonlySet<string> = new Set(['recorded', 'editing', 'published']);

/** Mirror of public.podcast_two_party_consent_state(). Null/unknown = two-party (fail closed). */
export const TWO_PARTY_STATES: ReadonlySet<string> = new Set(['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'OR', 'PA', 'WA']);

export function isTwoPartyState(state: string | null | undefined): boolean {
	if (!state) return true;
	const s = state.trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(s)) return true;
	return TWO_PARTY_STATES.has(s);
}

/** Pure client-side pre-check so the UI can explain before the DB refuses. */
export function releaseGateBlocks(status: string, releaseSigned: boolean, guestState: string | null | undefined): boolean {
	return GATED_STATUSES.has(status) && !releaseSigned && isTwoPartyState(guestState);
}

export const PODCAST_PATH = '/social/podcast';

export const US_STATES = [
	'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
] as const;

export interface EpisodeRow {
	id: string;
	title: string;
	guest_name: string;
	guest_email: string | null;
	guest_state: string | null;
	release_signed: boolean;
	release_signed_at: string | null;
	status: string;
	scheduled_for: string | null;
	notes_md: string | null;
	created_at: string;
}
