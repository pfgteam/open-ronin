// Route-level loading state. Until these existed the app had ZERO loading.tsx
// files with 63 force-dynamic pages — navigation froze on the previous page
// until Airtable answered, then jumped.
//
// The shell is supplied by the (app) group layout and preserved across
// navigation, so this is a bare synchronous skeleton: it paints on click
// without waiting on Auth. (It used to be wrapped in <AppLayout> by each
// module's loading.tsx, which made the skeleton itself auth-blocked.)

import Skeleton from './Skeleton';

export default function PageSkeleton() {
	return (
		<div aria-busy="true" aria-label="Loading">
			{/* header: title + actions */}
			<div className="flex items-center justify-between mb-6">
				<div className="space-y-2">
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-3.5 w-72" />
				</div>
				<Skeleton className="h-9 w-28" />
			</div>
			{/* filter row */}
			<div className="flex items-center gap-2 mb-4">
				<Skeleton className="h-7 w-20 !rounded-full" />
				<Skeleton className="h-7 w-24 !rounded-full" />
				<Skeleton className="h-7 w-16 !rounded-full" />
				<Skeleton className="h-9 w-56 ml-auto" />
			</div>
			{/* table shell */}
			<div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 space-y-3">
				<Skeleton className="h-4 w-full" />
				{Array.from({ length: 8 }).map((_, i) => (
					<Skeleton key={i} className="h-9 w-full" />
				))}
			</div>
		</div>
	);
}
