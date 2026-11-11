'use client';

// To-dos on a deal (or a person): add, tick off. Owner defaults to the deal's
// responsible rep (me on a person); each one also shows up in The Work (0159).

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import { formatRelative } from '@/lib/format';
import type { TaskRow } from '@/lib/revenue/shared';
import { addTask, toggleTask } from '../../actions';

export default function TaskList({ dealId, personId, tasks, staff }: { dealId: string | null; personId: string | null; tasks: TaskRow[]; staff: Record<string, string> }) {
	const router = useRouter();
	const ref = useRef<HTMLFormElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const open = tasks.filter((t) => !t.done_at);
	const done = tasks.filter((t) => t.done_at);

	return (
		<Card className="space-y-2 text-sm">
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">To-dos</h2>
			<form
				ref={ref}
				className="flex gap-2"
				action={(fd) => {
					setError(null);
					start(async () => {
						const r = await addTask(fd);
						if (!r.ok) setError(r.error);
						else {
							ref.current?.reset();
							router.refresh();
						}
					});
				}}
			>
				{dealId && <input type="hidden" name="deal_id" value={dealId} />}
				{personId && <input type="hidden" name="person_id" value={personId} />}
				<input
					name="title"
					required
					placeholder="Add a to-do…"
					aria-label="To-do"
					className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
				/>
				<input name="due_at" type="date" aria-label="Due" className="w-32 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs" />
				<Button type="submit" size="sm" variant="secondary" loading={pending}>
					Add
				</Button>
			</form>
			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
			{open.length === 0 && done.length === 0 && <p className="text-xs text-slate-500">Nothing open.</p>}
			<ul className="space-y-1">
				{[...open, ...done.slice(0, 5)].map((t) => (
					<li key={t.id} className="flex items-start gap-2 text-xs">
						<Checkbox
							checked={!!t.done_at}
							aria-label={t.done_at ? 'Reopen' : 'Done'}
							className="mt-0.5"
							onChange={(e) =>
								start(async () => {
									await toggleTask({ id: t.id, done: e.target.checked, deal_id: dealId, person_id: personId });
									router.refresh();
								})
							}
						/>
						<div className={clsx('min-w-0', t.done_at && 'line-through text-slate-400')}>
							<div className="text-slate-800 dark:text-slate-200">{t.title}</div>
							<div className="text-2xs text-slate-500">
								{t.owner_id ? staff[t.owner_id] ?? '—' : '—'}
								{t.due_at && <span className={clsx(!t.done_at && new Date(t.due_at) < new Date() && 'text-red-600 dark:text-red-400')}> · due {formatRelative(t.due_at)}</span>}
								{t.created_by_kind !== 'human' && <span> · {t.created_by_kind}</span>}
							</div>
						</div>
					</li>
				))}
			</ul>
		</Card>
	);
}
