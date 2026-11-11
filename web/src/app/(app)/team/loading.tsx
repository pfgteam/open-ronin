import PageSkeleton from '@/components/ui/PageSkeleton';

// Synchronous on purpose. This used to render <AppLayout>, which made the
// skeleton itself await Auth + two Supabase selects before it could paint —
// so the "instant" loading state wasn't. The shell now lives in the (app)
// group layout and is preserved across navigation, so this is pure markup
// and shows the moment the link is clicked.
export default function Loading() {
	return <PageSkeleton />;
}
