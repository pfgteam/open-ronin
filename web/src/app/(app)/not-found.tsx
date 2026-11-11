// 404 for notFound() thrown inside the app — a mistyped client id, a dead
// knowledge-base slug, a retired work item. The nav comes from the group
// layout, so this renders the card alone; without this file the boundary
// would fall through to src/app/not-found.tsx, which supplies its own shell
// and would nest a second one inside this group's.

import NotFoundCard from '@/components/layout/NotFoundCard';

export default function NotFound() {
	return <NotFoundCard />;
}
