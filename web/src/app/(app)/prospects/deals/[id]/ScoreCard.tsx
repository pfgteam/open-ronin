'use client';

// Scoring card on the deal page (0122): Quality /25 and Heat with their
// breakdowns, the MQL tier and routing, the AI fit summary, "Enrich now",
// "Rescore". The fit answers are edited in Qualification (spec 2026-10-20 §4.1);
// this card now lives in the deal page's Details section.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import { formatRelative } from '@/lib/format';
import { ROUTINGS, ROUTING_LABELS, type DealCard } from '@/lib/revenue/shared';
import { enrichBrandNow, rescoreDeal, setRouting } from '../../scoringActions';

const PART_LABELS: Record<string, string> = {
	work_email: 'Work email',
	website: 'Website',
	why_grow: 'Why grow',
	roadblock: 'Roadblock',
	interest_pr: 'PR',
	interest_ads: 'Ads',
	interest_smm: 'Social',
	industry: 'Industry',
	budget: 'Budget',
	agency_before: 'Agency before',
	touches: 'Touches (30d)',
	timing: 'Timing',
	call: 'Call status',
	no_shows: 'No-shows',
};

export default function ScoreCard({ deal, canEdit }: { deal: DealCard; canEdit: boolean }) {
	const router = useRouter();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, start] = useTransition();
	const q = deal.quality_breakdown;
	const h = deal.heat_breakdown;
	const qParts = Object.entries(q?.parts ?? {}).filter(([, v]) => typeof v === 'number' && v !== 0) as [string, number][];
	const hParts = Object.entries(h?.parts ?? {}).filter(([k, v]) => typeof v === 'number' && v !== 0 && !k.endsWith('_count') && k !== 'call_status') as [string, number][];

	const run = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, okText: (r: Record<string, unknown>) => string) => {
		setMsg(null);
		start(async () => {
			const r = await fn();
			if (!r.ok) setMsg({ ok: false, text: r.error ?? 'Failed.' });
			else {
				setMsg({ ok: true, text: okText(r) });
				router.refresh();
			}
		});
	};

	return (
		<Card className="space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Fit and heat</h2>
					<p className="text-2xs text-slate-500">{deal.scored_at ? `Scored ${formatRelative(deal.scored_at)}` : 'Not scored yet'}</p>
				</div>
				<div className="flex items-center gap-2">
					{deal.brand_id && (
						<Button size="sm" variant="outline" loading={pending} onClick={() => run(() => enrichBrandNow({ brand_id: deal.brand_id!, deal_id: deal.id }), (r) => `Enriched (${(r.providers as string[] | undefined)?.join(', ') || 'nothing new'}).`)}>
							<Sparkles className="w-3.5 h-3.5" /> Enrich
						</Button>
					)}
					<Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => rescoreDeal({ deal_id: deal.id }), () => 'Rescored.')}>
						Rescore
					</Button>
				</div>
			</div>

			<div className="grid sm:grid-cols-3 gap-3">
				<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
					<div className="text-2xs uppercase tracking-wide text-slate-500">Quality</div>
					<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
						{deal.quality_score ?? '—'}
						<span className="text-sm text-slate-500"> / 25</span>
					</div>
					<ul className="mt-1 space-y-0.5 text-2xs text-slate-600 dark:text-slate-400">
						{qParts.map(([k, v]) => (
							<li key={k} className="flex justify-between">
								<span>{PART_LABELS[k] ?? k}</span>
								<span className="tabular-nums">+{v}</span>
							</li>
						))}
						{qParts.length === 0 && <li className="text-slate-400">No fit signals yet.</li>}
					</ul>
				</div>
				<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
					<div className="text-2xs uppercase tracking-wide text-slate-500">Heat</div>
					<div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{deal.heat_score ?? '—'}</div>
					<ul className="mt-1 space-y-0.5 text-2xs text-slate-600 dark:text-slate-400">
						{hParts.map(([k, v]) => (
							<li key={k} className="flex justify-between">
								<span>
									{PART_LABELS[k] ?? k}
									{k === 'call' && h?.parts?.call_status ? ` · ${String(h.parts.call_status).replace(/_/g, ' ')}` : ''}
								</span>
								<span className="tabular-nums">{v > 0 ? `+${v}` : v}</span>
							</li>
						))}
						{hParts.length === 0 && <li className="text-slate-400">No engagement yet.</li>}
					</ul>
				</div>
				<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
					<div className="text-2xs uppercase tracking-wide text-slate-500">Routing</div>
					<div className="flex items-center gap-2">
						<Badge color={deal.routing === 'book_call' ? 'success' : deal.routing === 'setter_outreach' ? 'warning' : 'default'}>{deal.routing ? ROUTING_LABELS[deal.routing] : 'Unrouted'}</Badge>
						{deal.mql_tier && <span className="text-2xs text-slate-500">tier {deal.mql_tier}</span>}
					</div>
					{deal.delay_until && new Date(deal.delay_until) > new Date() && (
						<div className="text-2xs text-red-600 dark:text-red-400">On delay until {new Date(deal.delay_until).toLocaleDateString()} (no-shows)</div>
					)}
					{canEdit && (
						<Select size="sm" aria-label="Override routing" defaultValue={deal.routing ?? ''} onChange={(e) => run(() => setRouting({ deal_id: deal.id, routing: e.target.value as (typeof ROUTINGS)[number] | '' }), () => 'Routing set.')}>
							<option value="">Auto (from budget tier)</option>
							{ROUTINGS.map((r) => (
								<option key={r} value={r}>
									{ROUTING_LABELS[r]}
								</option>
							))}
						</Select>
					)}
				</div>
			</div>

			{deal.ai_fit_summary && (
				<div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-300">
					<span className="text-2xs uppercase tracking-wide text-slate-500 block mb-1">AI fit summary</span>
					{deal.ai_fit_summary}
				</div>
			)}

			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}

		</Card>
	);
}
