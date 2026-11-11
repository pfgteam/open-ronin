'use client';

// GHL sync status for one deal (0123): eligible / pushed / failed, the GHL
// contact id, "Push now" (respects the cutover) and "Force push".

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { formatRelative } from '@/lib/format';
import type { DealCard } from '@/lib/revenue/shared';
import { pushDealToGhl } from '../../ghlActions';

export default function GhlCard({ deal, canManage, ghlUrl }: { deal: DealCard; canManage: boolean; ghlUrl: string | null }) {
	const router = useRouter();
	const [msg, setMsg] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const s = deal.ghl_push_status;
	const go = (force: boolean) =>
		start(async () => {
			setMsg(null);
			const r = await pushDealToGhl({ deal_id: deal.id, force });
			setMsg(r.ok ? `Pushed (contact ${r.ghl_contact_id ?? '?'}).` : r.error);
			router.refresh();
		});
	return (
		<Card className="space-y-2 text-xs">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">GHL</h2>
				<Badge color={s === 'pushed' ? 'success' : s === 'failed' ? 'danger' : s === 'eligible' ? 'warning' : 'default'}>{s ?? 'not eligible'}</Badge>
			</div>
			{ghlUrl && (
				<a href={ghlUrl} target="_blank" rel="noreferrer" className="inline-flex text-primary-700 dark:text-primary-300 hover:underline">
					Open in GHL ↗
				</a>
			)}
			{deal.ghl_contact_id && <div className="font-mono text-slate-500 truncate">contact {deal.ghl_contact_id}</div>}
			{deal.ghl_opportunity_id && <div className="font-mono text-slate-500 truncate">opportunity {deal.ghl_opportunity_id}</div>}
			{deal.ghl_pushed_at && <div className="text-slate-500">pushed {formatRelative(deal.ghl_pushed_at)}</div>}
			{deal.ghl_push_error && <div className="text-red-600 dark:text-red-400">{deal.ghl_push_error}</div>}
			{!s && <p className="text-slate-500">Pushed to GHL once there is a positive reply or a booked call.</p>}
			{(s || canManage) && (
				<div className="flex gap-2 pt-1">
					<Button size="sm" variant="outline" loading={pending} onClick={() => go(false)}>
						Push now
					</Button>
					{canManage && (
						<Button size="sm" variant="ghost" loading={pending} onClick={() => go(true)}>
							Force
						</Button>
					)}
				</div>
			)}
			{msg && <p className="text-slate-600 dark:text-slate-400">{msg}</p>}
		</Card>
	);
}
