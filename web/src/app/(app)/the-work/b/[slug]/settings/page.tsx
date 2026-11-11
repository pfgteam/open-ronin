// /the-work/b/[slug]/settings — board settings (spec §4.2 screen 4).
// Editors only (can_edit_board: creator, board editors, admin); everyone
// else gets the restricted card, same pattern as data/layout.tsx.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import { loadBoard } from '@/lib/work/boards/load';
import { loadFormSupportingData } from '../../../_lib';
import BoardSettingsForm from '@/components/board/BoardSettingsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Board settings' };

export default async function BoardSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const loaded = await loadBoard(slug);
	if (!loaded) notFound();
	const { board, customColumns, canEdit } = loaded;
	if (!canEdit) {
		return (
			<Card>
				<h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Board settings are restricted</h1>
				<p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Only the board&rsquo;s creator, its editors and admins can change {board.name}. You can still edit the items on it.</p>
				<Link href={`/the-work/b/${slug}`} className="mt-3 inline-block text-sm font-medium text-primary-700 hover:underline dark:text-primary-400">Back to {board.name}</Link>
			</Card>
		);
	}
	const { tags } = await loadFormSupportingData();
	const departments = (tags as { id: string; label: string; category: string | null }[]).filter((t) => t.category === 'department').map((t) => ({ id: t.id, label: t.label }));
	return (
		<div>
			<Link href={`/the-work/b/${slug}`} className="text-sm text-primary-700 hover:underline dark:text-primary-400">← {board.name}</Link>
			<h1 className="mt-1 mb-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Board settings</h1>
			<BoardSettingsForm
				mode="edit"
				boardId={board.id}
				slug={board.slug}
				isSystem={board.is_system}
				customColumns={customColumns}
				departments={departments}
				initial={{
					name: board.name,
					section: board.section,
					kinds: board.base_filter.kinds ?? ['task'],
					quarter: board.base_filter.quarter ? 'current' : 'any',
					department_tag_ids: board.base_filter.department_tag_ids ?? [],
					client_id: board.base_filter.client_id ?? null,
					show_done: board.base_filter.show_done === true,
					group_by: board.group_by,
					default_view: board.default_view === 'form' ? 'table' : board.default_view,
					columns: board.columns,
				}}
			/>
		</div>
	);
}
