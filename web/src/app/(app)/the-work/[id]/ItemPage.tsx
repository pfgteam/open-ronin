'use client';

// /the-work/[id]: the item panel in its page size (spec §4.2 screen 3: "the
// same component in two sizes"). The server page loads the board context and
// renders this; archive / restore / delete from the "⋯" menu refresh the page
// (the archived banner appears) or go back to the board after a delete.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { localToday } from '@/lib/work/boards/groups';
import WorkItemPanel from '@/components/work/WorkItemPanel';
import type { BoardContext } from '@/lib/work/boards/types';

export default function ItemPage({ itemId, ctx, today, boardHref }: { itemId: string; ctx: BoardContext; today: string; boardHref: string }) {
	const router = useRouter();
	// Server gives the UTC date; the viewer's local day decides what is late.
	const [day, setDay] = useState(today);
	useEffect(() => { setDay(localToday()); }, []);
	return (
		<WorkItemPanel
			variant="page"
			itemId={itemId}
			ctx={ctx}
			today={day}
			onRemoved={(_id, how) => { if (how === 'deleted') router.push(boardHref); else router.refresh(); }}
			onUndone={() => router.refresh()}
			onOpenItem={(id) => router.push(`/the-work/${id}`)}
		/>
	);
}
