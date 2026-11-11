'use client';

// Full page of an ARCHIVED item: say so, and offer the way back. Without this
// an archived task rendered exactly like a live one (chips editable, no hint).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { unarchiveItems } from '@/app/(app)/the-work/b/actions';

export default function ArchivedBanner({ itemId, boardHref }: { itemId: string; boardHref: string }) {
	const router = useRouter();
	const { toast } = useToast();
	const [busy, setBusy] = useState(false);
	return (
		<div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
			<Archive className="w-4 h-4 shrink-0" aria-hidden="true" />
			<span>This item is archived. It is read-only and hidden from boards and queues.</span>
			<span className="ml-auto flex items-center gap-2">
				<a href={`${boardHref}?archived=1`} className="text-xs underline">See the board&apos;s archived items</a>
				<Button
					size="sm"
					variant="outline"
					loading={busy}
					onClick={async () => {
						setBusy(true);
						const res = await unarchiveItems([itemId]);
						setBusy(false);
						if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
						toast({ message: 'Restored', variant: 'success' });
						router.refresh();
					}}
				>
					<ArchiveRestore className="w-4 h-4" aria-hidden="true" />Restore
				</Button>
			</span>
		</div>
	);
}
