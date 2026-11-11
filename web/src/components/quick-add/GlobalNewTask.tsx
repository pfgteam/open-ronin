'use client';

// The 'or-quick-add' event opens the SAME "+ New" modal the boards and Self
// use (NewItemModal, kinds = task, owner = me). This replaced the old
// QuickAddModal (project required, hard-coded status) on 2026-10-05: one way
// to create a task everywhere. ⌘K / Ctrl+K moved to the sidebar's "+ New"
// palette (nav/NewMenu, menu restructure 2026-10-23), whose Task option
// fires this event.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import NewItemModal from '@/components/board/NewItemModal';
import { useToast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth';
import { loadNewItemContext } from '@/app/(app)/the-work/b/actions';
import type { BoardContext } from '@/lib/work/boards/types';

export default function GlobalNewTask() {
	const router = useRouter();
	const { toast } = useToast();
	const viewerId = useAuthStore((s) => s.profile?.id);
	const [open, setOpen] = useState(false);
	const [ctx, setCtx] = useState<BoardContext | null>(null);

	useEffect(() => {
		const onCustom = () => setOpen(true);
		window.addEventListener('or-quick-add', onCustom);
		return () => { window.removeEventListener('or-quick-add', onCustom); };
	}, []);

	// People + statuses are fetched once, on first open (nothing on page load).
	useEffect(() => {
		if (!open || ctx) return;
		let cancelled = false;
		loadNewItemContext()
			.then((res) => {
				if (cancelled) return;
				if (res.ok) setCtx(res.data);
				else { toast({ message: res.error, variant: 'error' }); setOpen(false); }
			})
			.catch(() => { if (!cancelled) { toast({ message: 'Could not open the new-task form. Try again.', variant: 'error' }); setOpen(false); } });
		return () => { cancelled = true; };
	}, [open, ctx, toast]);

	if (!open || !ctx) return null;
	return (
		<NewItemModal
			open
			onClose={() => setOpen(false)}
			kinds={['task']}
			ctx={ctx}
			viewerId={viewerId}
			boardName="your work"
			defaults={{ quarter_id: null, department_tag_id: null, client_id: null }}
			onCreated={(row, openIt) => {
				toast({ message: `Created ${row.name}`, variant: 'success' });
				if (openIt) router.push(`/the-work/${row.id}`);
				else router.refresh();
			}}
		/>
	);
}
