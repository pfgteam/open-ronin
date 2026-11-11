// Reads public.checkin_window() (0065): which reporting week we are in,
// which is the newest one that has OPENED (Friday 09:15 company time), and
// when the current one opens. SQL owns the timezone math; this only shapes
// the row. Falls back to checkin_current_week_end() when 0065 is not applied
// yet, treating the current week as open (the pre-0065 behaviour), so the
// page keeps working during the deploy window.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckinWindow } from './checkinWeeks';

export interface CheckinWindowRow extends CheckinWindow {
	/** ISO instant the current week opens; null on the pre-0065 fallback. */
	currentOpensAt: string | null;
}

export async function loadCheckinWindow(supabase: SupabaseClient): Promise<CheckinWindowRow | null> {
	const { data, error } = await supabase.rpc('checkin_window');
	if (!error) {
		const row = (Array.isArray(data) ? data[0] : data) as
			| { current_week_end?: string; latest_open_week_end?: string; current_opens_at?: string }
			| null
			| undefined;
		if (row && typeof row.current_week_end === 'string' && typeof row.latest_open_week_end === 'string') {
			return {
				currentWeekEnd: row.current_week_end,
				latestOpenWeekEnd: row.latest_open_week_end,
				currentOpensAt: row.current_opens_at ?? null,
			};
		}
	}
	// 0065 not applied yet: behave like 0035 did (current week is open).
	const { data: currentWeekRaw } = await supabase.rpc('checkin_current_week_end');
	if (typeof currentWeekRaw !== 'string') return null;
	return { currentWeekEnd: currentWeekRaw, latestOpenWeekEnd: currentWeekRaw, currentOpensAt: null };
}
