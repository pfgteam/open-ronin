'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { AuditAnswerRow, AuditBundle } from '@/lib/flywheel/server';
import type { ClusterRow, ProgramRow } from '@/lib/flywheel/shared';
import { AnswersTable, LatestScores, PromptsPanel, RunControls, RunsList, TrendChart } from './VisibilityPanels';

export default function VisibilityTab({ program, bundle, clusters, answers, pickedRun, lockedTarget, aiOn }: { program: ProgramRow; bundle: AuditBundle; clusters: ClusterRow[]; answers: AuditAnswerRow[]; pickedRun: string | null; lockedTarget: number; aiOn: boolean }) {
	const router = useRouter();
	const sp = useSearchParams();
	const pick = (id: string | null) => {
		const q = new URLSearchParams(sp.toString());
		q.set('tab', 'visibility');
		if (id) q.set('run', id);
		else q.delete('run');
		router.push(`/flywheel/${program.id}?${q.toString()}`);
	};
	return (
		<div className="space-y-4">
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-4">
					<LatestScores bundle={bundle} />
					<TrendChart runs={bundle.runs} />
					<RunsList program={program} runs={bundle.runs} onPick={pick} picked={pickedRun} />
					{pickedRun && <AnswersTable answers={answers} prompts={bundle.prompts} coreIds={bundle.panel.coreIds} />}
				</div>
				<div className="space-y-4">
					<RunControls program={program} bundle={bundle} clusters={clusters} />
					<PromptsPanel program={program} prompts={bundle.prompts} locked={lockedTarget} canSuggest={aiOn} />
				</div>
			</div>
		</div>
	);
}
