import { Suspense } from 'react';
import ChatView from './ChatView';

// Server shell; the view is client-side (polling, composer state). Suspense
// is required by useSearchParams inside ChatView during static prerender.
export default function Page() {
	return (
		<Suspense fallback={<div className="h-[calc(100vh-5.5rem)]" />}>
			<ChatView />
		</Suspense>
	);
}
