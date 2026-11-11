// /prospects/my-day moved to Self → My work → Sales (2026-10-15,
// docs/superpowers/specs/2026-10-15-self-sales-design.md). Kept as a
// redirect so bookmarks and old links still land on the queue.
import { redirect } from 'next/navigation';

export default function MyDayMoved() {
	redirect('/?tab=work&queue=sales');
}
