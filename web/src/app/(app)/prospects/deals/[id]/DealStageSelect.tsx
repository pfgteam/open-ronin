'use client';

// Stage mover on the deal page: a select grouped by pipeline (current lane
// first). The SQL guard validates required fields, hands off between lanes
// and writes history; we call moveDeal, refresh, and raise a toast. Undo only
// for a plain move inside the same pipeline (spec 2026-10-20 §3; same rule as
// Self → Sales and the board).

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { stageUndoable } from '@/lib/revenue/dealPage';
import type { PipelineRow, StageRow } from '@/lib/revenue/shared';
import { moveDeal } from '../../actions';

export default function DealStageSelect({ dealId, stageId, stages, allStages, pipelines }: { dealId: string; stageId: string; stages: StageRow[]; allStages: StageRow[]; pipelines: PipelineRow[] }) {
	const router = useRouter();
	const { toast } = useToast();
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const currentPipelineId = stages[0]?.pipeline_id;
	const others = pipelines.filter((p) => p.id !== currentPipelineId && p.is_active);

	return (
		<div className="flex items-center gap-2">
			<Select
				size="sm"
				aria-label="Stage"
				value={stageId}
				disabled={pending}
				className="w-64"
				onChange={(e) => {
					const next = e.target.value;
					if (next === stageId) return;
					setError(null);
					start(async () => {
						const r = await moveDeal({ deal_id: dealId, stage_id: next });
						if (!r.ok) {
							setError(r.error);
							return;
						}
						router.refresh();
						const target = allStages.find((s) => s.id === next);
						if (!target) return;
						if (!currentPipelineId || !stageUndoable(target, currentPipelineId)) {
							const lane = target.handoff_pipeline_id ? pipelines.find((p) => p.id === target.handoff_pipeline_id)?.name : null;
							toast({ message: lane ? `Handed off to ${lane}` : `→ ${target.name}`, variant: 'success' });
							return;
						}
						const prev = stageId;
						toast({
							message: `→ ${target.name}`,
							undo: async () => {
								const back = await moveDeal({ deal_id: dealId, stage_id: prev });
								if (back.ok) router.refresh();
								else toast({ message: back.error, variant: 'error' });
							},
						});
					});
				}}
			>
				<optgroup label="This pipeline">
					{stages.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
							{s.handoff_pipeline_id ? ' →' : ''}
							{s.outcome !== 'open' ? ` (${s.outcome})` : ''}
						</option>
					))}
				</optgroup>
				{others.map((p) => (
					<optgroup key={p.id} label={p.name}>
						{allStages
							.filter((s) => s.pipeline_id === p.id)
							.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
					</optgroup>
				))}
			</Select>
			{error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
		</div>
	);
}
