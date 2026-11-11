'use client';

// H4 controls: score the role (unscored / rescore all), refresh the
// shortlist, score one application, run enrichment now.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import { enrichNow, refreshShortlist, scoreNow, scoreRole } from '../../../actions';

export function ScoreRoleBar({ positionId, unscored, aiReady }: { positionId: string; unscored: number; aiReady: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const run = (rescore: boolean) =>
		start(async () => {
			setMsg(null);
			const r = await scoreRole({ position_id: positionId, rescore });
			setMsg(r.ok ? { ok: true, text: `Scored ${r.scored}.${r.errors.length ? ` ${r.errors.join(' · ')}` : ''}` } : { ok: false, text: r.error });
			router.refresh();
		});
	const shortlist = () =>
		start(async () => {
			const r = await refreshShortlist({ position_id: positionId });
			setMsg(r.ok ? { ok: true, text: `Shortlist refreshed: ${r.ranked} ranked.` } : { ok: false, text: r.error });
			router.refresh();
		});
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button size="sm" onClick={() => run(false)} loading={pending} disabled={!aiReady || unscored === 0} title={aiReady ? '' : 'Needs ANTHROPIC_API_KEY / OPENAI_API_KEY'}>
				Score {unscored} unscored
			</Button>
			<Button size="sm" variant="outline" onClick={() => run(true)} loading={pending} disabled={!aiReady}>
				Rescore all
			</Button>
			<Button size="sm" variant="ghost" onClick={shortlist} loading={pending}>
				Refresh shortlist
			</Button>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
		</div>
	);
}

export function ScoreOneBar({ id, positionId, scored, aiReady }: { id: string; positionId: string; scored: boolean; aiReady: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					onClick={() =>
						start(async () => {
							setMsg(null);
							const r = await scoreNow({ id, position_id: positionId });
							setMsg(r.ok ? { ok: true, text: `Overall ${r.overall} · merit ${r.merit} · integrity ${r.integrity}.` } : { ok: false, text: r.error });
							router.refresh();
						})
					}
					loading={pending}
					disabled={!aiReady}
					title={aiReady ? '' : 'Needs ANTHROPIC_API_KEY / OPENAI_API_KEY'}
				>
					{scored ? 'Rescore' : 'Score now'}
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() =>
						start(async () => {
							setMsg(null);
							const r = await enrichNow({ id, position_id: positionId });
							setMsg(r.ok ? { ok: true, text: `Enrichment: ${r.done} done · ${r.skipped} skipped · ${r.failed} failed.` } : { ok: false, text: r.error });
							router.refresh();
						})
					}
					loading={pending}
				>
					Run enrichment
				</Button>
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
		</div>
	);
}
