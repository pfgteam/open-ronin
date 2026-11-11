// Details → lane history, source and dates (spec 2026-10-20 §4.3): what used
// to sit in the always-open "Deal" and "Lane history" cards. Value and owners
// moved to the header.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import { formatDate, formatRelative } from '@/lib/format';
import { productPriceLabel, type DealCard, type PipelineRow, type ProductRow, type StageHistoryRow, type StageRow } from '@/lib/revenue/shared';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-3 text-xs">
			<span className="w-20 shrink-0 text-slate-500">{label}</span>
			<span className="min-w-0 text-slate-700 dark:text-slate-300">{children}</span>
		</div>
	);
}

export function SourceAndDates({ deal, products }: { deal: DealCard; products: ProductRow[] }) {
	return (
		<Card className="space-y-2 text-sm">
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Source and dates</h2>
			<Row label="Source">{[deal.source, deal.campaign, deal.channel].filter(Boolean).join(' · ') || '—'}</Row>
			<Row label="Created">
				{formatDate(deal.created_at)} · {deal.created_via}
			</Row>
			{deal.first_touch_at && <Row label="First touch">{formatRelative(deal.first_touch_at)}</Row>}
			{deal.last_touch_at && <Row label="Last touch">{formatRelative(deal.last_touch_at)}</Row>}
			{deal.won_at && <Row label="Won">{formatDate(deal.won_at)}</Row>}
			{deal.lost_at && <Row label="Lost">{formatDate(deal.lost_at)}{deal.lost_reason ? ` · ${deal.lost_reason}` : ''}</Row>}
			{deal.client_id && (
				<Row label="Client">
					<Link href={`/clients/${deal.client_id}`} className="text-primary-700 underline dark:text-primary-300">
						Open client
					</Link>
				</Row>
			)}
			{products.length > 0 && (
				<div className="pt-1">
					<div className="mb-1 text-2xs uppercase tracking-wide text-slate-500">Products of interest</div>
					<ul className="space-y-0.5">
						{products.map((p) => (
							<li key={p.id} className="flex justify-between text-xs">
								<span className="text-slate-700 dark:text-slate-300">{p.name}</span>
								<span className="tabular-nums text-slate-500">{productPriceLabel(p)}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</Card>
	);
}

export function LaneHistory({ history, stages, pipelines, who }: { history: StageHistoryRow[]; stages: StageRow[]; pipelines: PipelineRow[]; who: (id: string | null) => string }) {
	const stageById = new Map(stages.map((s) => [s.id, s]));
	const pipelineById = new Map(pipelines.map((p) => [p.id, p]));
	return (
		<Card className="text-sm">
			<h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Lane history</h2>
			{history.length === 0 ? (
				<p className="text-xs text-slate-500">No stage changes yet.</p>
			) : (
				<ul className="space-y-1.5">
					{history.map((h) => {
						const to = stageById.get(h.to_stage_id);
						const from = h.from_stage_id ? stageById.get(h.from_stage_id) : null;
						const toP = pipelineById.get(h.to_pipeline_id);
						return (
							<li key={h.id} className="text-xs">
								<div className="text-slate-700 dark:text-slate-300">
									{from ? `${from.name} → ` : ''}
									<span className="font-medium">{to?.name ?? '—'}</span>
									{toP && <span className="text-slate-500"> · {toP.name}</span>}
								</div>
								<div className="text-2xs text-slate-500">
									{formatRelative(h.created_at)} · {h.reason}
									{h.changed_by ? ` · ${who(h.changed_by)}` : ''}
									{h.note ? ` · ${h.note}` : ''}
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</Card>
	);
}
