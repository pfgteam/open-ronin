'use client';

// Inbox row controls (0158): status buttons + notes, through updateSubmission.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import { STATUS_LABELS, SUBMISSION_STATUSES, type SubmissionStatus } from '@/lib/forms/shared';
import { updateSubmission } from '../../actions';

export default function SubmissionActions({ id, slug, status, notes, compact }: { id: string; slug: string; status: SubmissionStatus; notes: string | null; compact?: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [err, setErr] = useState<string | null>(null);
	const [text, setText] = useState(notes ?? '');

	function setStatus(next: SubmissionStatus) {
		setErr(null);
		start(async () => {
			const res = await updateSubmission({ id, slug, status: next });
			if (!res.ok) setErr(res.error);
			else router.refresh();
		});
	}
	function saveNotes() {
		setErr(null);
		start(async () => {
			const res = await updateSubmission({ id, slug, notes: text });
			if (!res.ok) setErr(res.error);
			else router.refresh();
		});
	}

	if (compact) {
		return (
			<span className="inline-flex items-center gap-2">
				<select
					value={status}
					disabled={pending}
					onChange={(e) => setStatus(e.target.value as SubmissionStatus)}
					className="text-2xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-300"
					aria-label="Status"
				>
					{SUBMISSION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
				</select>
				{err && <span className="text-2xs text-red-600">{err}</span>}
			</span>
		);
	}

	return (
		<div className="space-y-3">
			{err && <Callout tone="error">{err}</Callout>}
			<div className="inline-flex items-center gap-1 flex-wrap">
				{SUBMISSION_STATUSES.map((s) => (
					<button
						key={s}
						type="button"
						disabled={pending || s === status}
						onClick={() => setStatus(s)}
						className={
							s === status
								? 'text-2xs rounded-md px-2 py-1 bg-primary-700 text-white'
								: 'text-2xs rounded-md px-2 py-1 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45 disabled:opacity-50'
						}
					>
						{STATUS_LABELS[s]}
					</button>
				))}
			</div>
			<div>
				<label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Internal notes</label>
				<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2" />
				<div className="mt-2">
					<Button size="sm" variant="outline" type="button" onClick={saveNotes} disabled={pending || text === (notes ?? '')}>Save notes</Button>
				</div>
			</div>
		</div>
	);
}
