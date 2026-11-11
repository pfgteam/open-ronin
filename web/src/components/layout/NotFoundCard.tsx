// The 404 body, shared by the two not-found boundaries.
//
// There are two because the shell moved into the (app) route group:
//   - src/app/(app)/not-found.tsx answers notFound() from any in-app segment
//     (a mistyped client id, a dead knowledge-base slug, a retired work item)
//     and inherits the nav from the group layout.
//   - src/app/not-found.tsx answers genuinely unmatched URLs, which resolve
//     OUTSIDE the group where no layout provides chrome, so that one wraps
//     this card in <AppLayout> itself.

import Card from '@/components/ui/Card';
import Link from 'next/link';
import { SearchX } from 'lucide-react';

export default function NotFoundCard() {
	return (
		<div className="flex items-center justify-center py-24">
			<Card className="max-w-md text-center" padding="lg">
				<SearchX className="w-8 h-8 text-slate-400 mx-auto mb-3" />
				<h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
					This page doesn&rsquo;t exist
				</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
					The link may be stale — a record that was removed, or an id that was
					mistyped. Nothing was changed.
				</p>
				<div className="mt-4 flex items-center justify-center gap-2">
					<Link
						href="/"
						className="inline-flex items-center justify-center rounded-md bg-primary-600 hover:bg-primary-700 px-3.5 py-2 text-sm font-medium text-white transition-colors"
					>
						Back to Home
					</Link>
				</div>
			</Card>
		</div>
	);
}
