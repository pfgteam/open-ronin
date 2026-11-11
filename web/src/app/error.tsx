'use client';

// Global error boundary — before this existed, any uncaught server error
// (e.g. a transient Airtable 5xx in a layout) dumped users on Next's raw
// unstyled error screen (18/08 QA audit).

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
			<div className="w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center">
				<AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
				<h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
					Something went wrong
				</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
					This is usually a temporary hiccup talking to an external source
					(Airtable, Google). Try again — if it keeps happening, tell the Ops
					team what you were doing.
				</p>
				{error.digest && (
					<p className="text-2xs text-slate-400 dark:text-slate-500 mt-2 font-mono">
						ref: {error.digest}
					</p>
				)}
				<Button size="sm" onClick={reset} className="mt-4 gap-1.5">
					<RotateCw className="w-3 h-3" /> Try again
				</Button>
			</div>
		</div>
	);
}
