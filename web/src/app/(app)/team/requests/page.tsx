// /team/requests — moved to the Innovation Desk (2026-09-14). Requests and
// Insights merged into /the-work/innovation-desk; this URL is kept for
// bookmarks and for notification hrefs written before migration 0081.

import { redirect } from 'next/navigation';
import { INNOVATION_DESK_PATH } from '@/lib/requests/kinds';

export default async function RequestsRedirect({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = await searchParams;
	redirect(error ? `${INNOVATION_DESK_PATH}?error=${encodeURIComponent(error)}` : INNOVATION_DESK_PATH);
}
