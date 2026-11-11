// 404 for URLs that match no route at all. These resolve outside the (app)
// route group, so there is no layout above to supply the nav — this boundary
// renders the shell itself. In-app notFound() calls are answered by
// src/app/(app)/not-found.tsx, which inherits the shell instead.

import AppLayout from '@/components/layout/AppLayout';
import NotFoundCard from '@/components/layout/NotFoundCard';

export default function NotFound() {
	return (
		<AppLayout>
			<NotFoundCard />
		</AppLayout>
	);
}
