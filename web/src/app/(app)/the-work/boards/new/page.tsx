// /the-work/boards/new — any team creates a board from a template (spec §4.2
// screen 6). The board shows existing work items that match its filter.

import Link from 'next/link';
import { loadFormSupportingData } from '../../_lib';
import BoardSettingsForm from '@/components/board/BoardSettingsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New board' };

export default async function NewBoardPage() {
	const { tags } = await loadFormSupportingData();
	const departments = (tags as { id: string; label: string; category: string | null }[]).filter((t) => t.category === 'department').map((t) => ({ id: t.id, label: t.label }));
	return (
		<div>
			<Link href="/the-work" className="text-sm text-primary-700 hover:underline dark:text-primary-400">← The Work</Link>
			<h1 className="mt-1 mb-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">New board</h1>
			<BoardSettingsForm
				mode="create"
				customColumns={[]}
				departments={departments}
				initial={{
					name: '',
					section: 'department',
					kinds: ['task'],
					quarter: 'any',
					department_tag_ids: [],
					client_id: null,
					show_done: false,
					group_by: 'parent',
					default_view: 'table',
					columns: [{ key: 'owner', visible: true }, { key: 'status', visible: true }, { key: 'due', visible: true }, { key: 'followers', visible: true }],
				}}
			/>
		</div>
	);
}
