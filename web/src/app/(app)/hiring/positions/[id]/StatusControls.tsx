'use client';

// Status + request controls on the position page (0128). The SQL guard
// decides what each move needs (approval before open, a complete 4R).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import { POSITION_NEXT, POSITION_STATUS_LABELS, type PositionStatus } from '@/lib/hiring/shared';
import { deleteDraftPosition, setPositionStatus } from '../../actions';

export default function StatusControls({ id, status, canManage, hasRequest }: { id: string; status: PositionStatus; canManage: boolean; hasRequest: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<string | null>(null);
	const [reason, setReason] = useState('');
	const move = (next: PositionStatus) =>
		start(async () => {
			setMsg(null);
			const r = await setPositionStatus({ id, status: next, reason: reason || null });
			if (!r.ok) setMsg(r.error);
			router.refresh();
		});
	const remove = () =>
		start(async () => {
			const r = await deleteDraftPosition({ id });
			if (!r.ok) return setMsg(r.error);
			router.push('/hiring/positions');
		});
	const next = POSITION_NEXT[status];
	return (
		<div className="space-y-2">
			{msg && <Callout tone="error">{msg}</Callout>}
			<div className="flex flex-wrap items-center gap-2">
				{status === 'draft' && !hasRequest && (
					<Link href={`/hiring/requests?new=1&position=${id}`}>
						<Button size="sm">Request approval (Alex)</Button>
					</Link>
				)}
				{status === 'pending_approval' && <span className="text-xs text-slate-500">Waiting on Alex in the Innovation Desk pipeline.</span>}
				{canManage &&
					next.map((s) => (
						<Button key={s} size="sm" variant={s === 'open' ? 'primary' : 'outline'} loading={pending} onClick={() => move(s)}>
							{s === 'open' ? (status === 'approved' ? 'Open the role' : 'Reopen') : POSITION_STATUS_LABELS[s]}
						</Button>
					))}
				{canManage && status === 'draft' && (
					<Button size="sm" variant="ghost" loading={pending} onClick={remove}>
						Delete draft
					</Button>
				)}
			</div>
			{canManage && (status === 'open' || status === 'paused') && <Input label="Close reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} />}
		</div>
	);
}
