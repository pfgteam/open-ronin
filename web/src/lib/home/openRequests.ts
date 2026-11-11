// Server reader for Work › Overview › "My open requests". RLS scopes both
// tables to the requester (and reviewers), and the filters below pin it to
// the viewer. A missing table (migration not applied) or any read error
// yields an empty list: the Overview must never fail on this card.

import type { SupabaseClient } from '@supabase/supabase-js';
import { TWO_STEP_KINDS } from '@/lib/requests/kinds';
import {
	OPEN_CONTENT_STATUSES,
	buildOpenRequests,
	type ContentRequestRow,
	type OpenRequest,
	type StaffRequestRow,
} from './openRequestsShared';

export async function loadOpenRequests(supabase: SupabaseClient, me: string): Promise<OpenRequest[]> {
	const [staff, content] = await Promise.all([
		supabase
			.from('staff_requests')
			.select('id, kind, title, status, created_at')
			.eq('requester_id', me)
			.or(`status.in.(pending,in_review),and(status.eq.approved,kind.in.(${[...TWO_STEP_KINDS].join(',')}))`)
			.order('created_at', { ascending: false })
			.limit(20),
		supabase
			.from('content_requests')
			.select('id, title, status, created_at')
			.eq('requester_id', me)
			.in('status', [...OPEN_CONTENT_STATUSES])
			.order('created_at', { ascending: false })
			.limit(20),
	]);
	return buildOpenRequests(
		staff.error ? [] : ((staff.data ?? []) as StaffRequestRow[]),
		content.error ? [] : ((content.data ?? []) as ContentRequestRow[]),
		me,
	);
}
