'use client';

// Publish / reject (approver) or withdraw (author) for one pending revision.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Callout from '@/components/ui/Callout';
import { Check, X, Undo2 } from 'lucide-react';
import { publishRevision, rejectRevision, withdrawRevision } from '../../actions';

interface Props {
	revisionId: string;
	approver: boolean;
	isAuthor: boolean;
	kind: 'create' | 'edit';
	className?: string;
}

export default function ReviewControls({ revisionId, approver, isAuthor, kind, className }: Props) {
	const router = useRouter();
	const [note, setNote] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const [which, setWhich] = useState<'publish' | 'reject' | null>(null);

	function run(action: 'publish' | 'reject') {
		setError(null);
		setWhich(action);
		const fd = new FormData();
		fd.set('revision_id', revisionId);
		fd.set('review_note', note);
		startTransition(async () => {
			const res = await (action === 'publish' ? publishRevision(fd) : rejectRevision(fd));
			setWhich(null);
			if (!res.ok) {
				setError(res.error);
				return;
			}
			router.push(res.href ?? '/team/knowledge-base/changes');
			router.refresh();
		});
	}

	if (!approver && !isAuthor) return null;

	return (
		<Card className={className}>
			{error && (
				<Callout tone="error" className="mb-3">
					{error}
				</Callout>
			)}
			{approver ? (
				<div className="flex flex-col sm:flex-row sm:items-end gap-3">
					<div className="flex-1">
						<Input
							label="Reviewer note (optional, sent to the author)"
							value={note}
							onChange={(e) => setNote(e.target.value)}
							maxLength={500}
							placeholder={kind === 'create' ? 'e.g. Published under Overview; renamed heading 2.' : 'e.g. Looks good. / Needs the KPI table from the playbook.'}
						/>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<Button type="button" variant="outline" size="md" onClick={() => run('reject')} loading={pending && which === 'reject'} disabled={pending}>
							<X className="w-3.5 h-3.5" /> Reject
						</Button>
						<Button type="button" size="md" onClick={() => run('publish')} loading={pending && which === 'publish'} disabled={pending}>
							<Check className="w-3.5 h-3.5" /> Publish
						</Button>
					</div>
				</div>
			) : (
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm text-slate-600 dark:text-slate-300">Waiting for a wiki approver. You can withdraw this change until it is reviewed.</p>
					<form action={withdrawRevision}>
						<input type="hidden" name="revision_id" value={revisionId} />
						<Button type="submit" variant="outline" size="sm">
							<Undo2 className="w-3.5 h-3.5" /> Withdraw
						</Button>
					</form>
				</div>
			)}
		</Card>
	);
}
