'use client';

// Batch history with rollback. Rollback refuses when any target row drifted
// from its after snapshot and lists the rows that did.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import { rollbackBatch } from './actions';
import { targetInfo } from '@/lib/imports/targets';
import type { BatchRow, BatchStatus } from '@/lib/imports/types';

const STATUS_DOT: Record<BatchStatus, string> = {
	draft: 'bg-slate-300 dark:bg-slate-600',
	uploaded: 'bg-slate-300 dark:bg-slate-600',
	targeted: 'bg-slate-300 dark:bg-slate-600',
	mapped: 'bg-slate-300 dark:bg-slate-600',
	dry_run: 'bg-primary-500',
	committing: 'bg-primary-500',
	committed: 'bg-green-500',
	rolled_back: 'bg-amber-500',
	failed: 'bg-red-500',
};

export function StatusText({ status }: { status: BatchStatus }) {
	const label = status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
	return (
		<span className="inline-flex items-center gap-1.5 text-2xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
			<span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
			{label}
		</span>
	);
}

function fmt(iso: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function HistoryTable({ batches }: { batches: BatchRow[] }) {
	const [pending, startTransition] = useTransition();
	const [busyId, setBusyId] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string; drifts?: { rowNumber: number; keys: string[] }[] } | null>(null);

	function rollback(id: string) {
		if (!window.confirm('Roll this batch back? Inserted rows are deleted and updated rows are restored.')) return;
		setBusyId(id);
		setNotice(null);
		startTransition(async () => {
			const res = await rollbackBatch(id);
			setBusyId(null);
			if (res.ok) setNotice({ tone: 'success', text: `Rolled back ${res.reverted} row${res.reverted === 1 ? '' : 's'}.` });
			else setNotice({ tone: 'error', text: res.error, drifts: 'drifts' in res ? res.drifts : undefined });
		});
	}

	if (batches.length === 0) {
		return <p className="text-sm text-slate-500 dark:text-slate-400">No imports yet.</p>;
	}

	return (
		<div className="space-y-2">
			{notice && (
				<Callout tone={notice.tone}>
					{notice.text}
					{notice.drifts && notice.drifts.length > 0 && (
						<ul className="mt-1 text-xs list-disc pl-4">
							{notice.drifts.map((d) => (
								<li key={d.rowNumber}>
									Row {d.rowNumber}: {d.keys.join(', ')}
								</li>
							))}
						</ul>
					)}
				</Callout>
			)}
			<div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
				<table className="w-full text-xs">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">When</th>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">File</th>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Target</th>
							<th className="text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Status</th>
							<th className="text-right px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Rows</th>
							<th className="text-right px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Inserts</th>
							<th className="text-right px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Updates</th>
							<th className="text-right px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">Rejects</th>
							<th className="px-3 py-2" />
						</tr>
					</thead>
					<tbody>
						{batches.map((b) => (
							<tr key={b.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
								<td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{fmt(b.created_at)}</td>
								<td className="px-3 py-2">
									<Link href={`/data/imports?batch=${b.id}`} className="text-primary-600 dark:text-primary-400 hover:underline">
										{b.file_name ?? 'untitled'}
									</Link>
								</td>
								<td className="px-3 py-2 text-slate-600 dark:text-slate-300">
									{b.target ? targetInfo(b.target).label : ''}
									{b.target === 'airtable' && b.target_ref ? <span className="text-slate-400"> {b.target_ref.split('/')[1]}</span> : null}
								</td>
								<td className="px-3 py-2">
									<StatusText status={b.status} />
								</td>
								<td className="px-3 py-2 text-right tabular-nums">{b.row_count}</td>
								<td className="px-3 py-2 text-right tabular-nums">{b.insert_count}</td>
								<td className="px-3 py-2 text-right tabular-nums">{b.update_count}</td>
								<td className="px-3 py-2 text-right tabular-nums">{b.reject_count}</td>
								<td className="px-3 py-2 text-right whitespace-nowrap">
									{(b.status === 'committed' || b.status === 'failed') && (
										<Button size="sm" variant="outline" loading={pending && busyId === b.id} disabled={pending} onClick={() => rollback(b.id)}>
											Roll back
										</Button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
