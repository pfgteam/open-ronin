'use client';

// Applications table controls (0130): select + bulk status, CSV export,
// star toggle. The table itself is server-rendered; this wraps the rows.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Select from '@/components/ui/Select';
import { bulkReview, exportApplicationsCsv, reviewApplication } from '../../../actions';

export const APP_STATUS_LABELS: Record<string, string> = { new: 'New', screening: 'Screening', culture_fit: 'Culture fit', job_fit: 'Job fit', final: 'Final', offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn', pool: 'Talent pool' };

export function BulkBar({ positionId, ids }: { positionId: string; ids: string[] }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<string | null>(null);
	const [status, setStatus] = useState('screening');
	const selected = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[data-app-id]:checked')).map((i) => i.dataset.appId!).filter(Boolean);
	const run = () =>
		start(async () => {
			const sel = selected();
			if (!sel.length) return setMsg('Select at least one application.');
			const r = await bulkReview({ position_id: positionId, ids: sel, status: status as never });
			setMsg(r.ok ? `Moved ${r.updated} to ${APP_STATUS_LABELS[status]}.` : r.error);
			router.refresh();
		});
	const csv = () =>
		start(async () => {
			const r = await exportApplicationsCsv({ position_id: positionId });
			if (!r.ok) return setMsg(r.error);
			const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = r.filename;
			a.click();
			URL.revokeObjectURL(a.href);
		});
	return (
		<div className="flex flex-wrap items-center gap-2">
			<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
				<Checkbox onChange={(e) => document.querySelectorAll<HTMLInputElement>('input[data-app-id]').forEach((i) => (i.checked = e.target.checked))} /> all ({ids.length})
			</label>
			<Select size="sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Bulk status">
				{Object.entries(APP_STATUS_LABELS).map(([k, v]) => (
					<option key={k} value={k}>
						{v}
					</option>
				))}
			</Select>
			<Button size="sm" variant="outline" onClick={run} loading={pending}>
				Move selected
			</Button>
			<Button size="sm" variant="ghost" onClick={csv} loading={pending}>
				Export CSV
			</Button>
			{msg && <Callout tone="info" className="py-1">{msg}</Callout>}
		</div>
	);
}

export function RowSelect({ id }: { id: string }) {
	return <Checkbox data-app-id={id} aria-label="Select" />;
}

export function StarButton({ id, positionId, starred }: { id: string; positionId: string; starred: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	return (
		<button
			type="button"
			className={`text-base leading-none ${starred ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
			disabled={pending}
			aria-label={starred ? 'Unstar' : 'Star'}
			onClick={() =>
				start(async () => {
					const fd = new FormData();
					fd.set('id', id);
					fd.set('position_id', positionId);
					fd.set('starred', String(!starred));
					await reviewApplication(fd);
					router.refresh();
				})
			}
		>
			★
		</button>
	);
}
