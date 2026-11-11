'use client';

// Add prospect as a dialog over the current screen (Pipeline, a brand, a
// person, Self → Sales). Options load when it opens; a successful add lands
// on the new deal. /prospects/deals/new stays for direct links.

import { useState, useTransition } from 'react';
import Callout from '@/components/ui/Callout';
import Dialog from '@/components/ui/Dialog';
import Skeleton from '@/components/ui/Skeleton';
import QuickAddForm from './deals/new/QuickAddForm';
import { loadQuickAdd } from './deals/new/quickAddActions';

type Loaded = Awaited<ReturnType<typeof loadQuickAdd>>;

export default function AddProspectButton({ pipeline, person, brand, className, children }: {
	pipeline?: string | null;
	person?: string | null;
	brand?: string | null;
	className?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [, start] = useTransition();

	const openDialog = () => {
		setOpen(true);
		setLoaded(null);
		start(async () => setLoaded(await loadQuickAdd({ pipeline, person, brand })));
	};
	const close = () => setOpen(false);

	return (
		<>
			<button type="button" onClick={openDialog} className={className}>
				{children}
			</button>
			<Dialog
				open={open}
				onClose={close}
				title="Add prospect"
				subtitle="If this person already exists (LinkedIn, phone or email) the deal attaches to them."
			>
				{!loaded ? (
					<div className="space-y-3" aria-busy="true" aria-label="Loading the form">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-2/3" />
					</div>
				) : !loaded.ok ? (
					<Callout tone="error">{loaded.error}</Callout>
				) : (
					<div className="space-y-4">
						{loaded.data.prefilledFrom && (
							<Callout tone="info">Pre-filled from {loaded.data.prefilledFrom}. The deal attaches to the existing record.</Callout>
						)}
						<QuickAddForm {...loaded.data} meId={loaded.meId} meEmail={loaded.meEmail} onCancel={close} inDialog />
					</div>
				)}
			</Dialog>
		</>
	);
}
