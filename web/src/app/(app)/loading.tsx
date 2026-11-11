import PageSkeleton from '@/components/ui/PageSkeleton';

// Group-level fallback: the nearest loading.tsx for any route in (app) that
// doesn't declare its own. Before the shell moved up here, eight modules had
// a skeleton and everything else had none — so /, /contacts, /prospects,
// /clients/[id], /the-work/[id], /team/[id] and /media/lead-scraper froze on
// the previous page until their data answered, then jumped. Those are the
// routes people described as "not responding to the click".
export default function Loading() {
	return <PageSkeleton />;
}
