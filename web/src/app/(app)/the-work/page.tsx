// /the-work — The Work opens on the hub (rework D1, 5.1). The company
// overview (KPIs, goals, overdue) moved to /the-work/overview.

import { redirect } from 'next/navigation';
import { hubQueryString, parseHubState } from '@/lib/work/hub/state';
import { hubTabForKind } from '@/lib/work/hub/tabs';

export const dynamic = 'force-dynamic';

export default async function TheWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const sp = await searchParams;
	const kind = typeof sp.kind === 'string' ? sp.kind : 'priority';
	const tab = hubTabForKind(kind) ?? hubTabForKind('priority')!;
	redirect(`/the-work/${tab.key}${hubQueryString(parseHubState(sp))}`);
}
