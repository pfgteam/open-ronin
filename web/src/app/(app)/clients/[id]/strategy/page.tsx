// /clients/[id]/strategy — 12 Week Plans + Goals + PR strategy docs
//
// Pulls from:
//   - Client Central → 12 Week Goals (linked to this contract)
//   - Client Media → Client Metrics (cross-base lookup by client name —
//     each "brand metrics" record carries PR Plan, Message House, Notes,
//     Awareness Day Calendar for that brand)

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { requireClient, listByIds, findClientMetricsByName } from '../_lib';
import { BASE_IDS } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { Compass, Goal, Megaphone, FileText, Calendar } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
}

interface TwelveWeekGoalFields {
	Name?: string;
	Goal?: string;
	'Start Date'?: string;
	Quarter?: string;
	'To-dos'?: { id: string; name?: string }[];
}

interface ClientMetricFields {
	'Contoso'?: string;
	'Brand Name'?: string;
	'Message House'?: string;
	'PR Plan'?: string;
	Notes?: string;
	'Awareness Day Calendar'?: string;
	Goal?: string[];
	'Publicity Value'?: number;
	'Total Ops'?: number;
}

export default async function StrategyPage({ params }: PageProps) {
	const { id } = await params;
	const ctx = await requireClient(id, '/strategy');
	const f = ctx.fields;
	// multipleRecordLinks come back as string[] of rec ids from the REST API
	const goalIds = f['12 Week Goals'] ?? [];
	const [twelveWeekGoals, brandMetrics] = await Promise.all([
		listByIds<TwelveWeekGoalFields>(
			BASE_IDS.CLIENT_CENTRAL,
			'12 Week Goals',
			goalIds,
			{ fields: ['Name', 'Goal', 'Start Date', 'Quarter', 'To-dos'] },
		),
		findClientMetricsByName(ctx.name),
	]);

	return (
		<div className="space-y-4">
			{/* 12 Week Goals */}
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
						<Goal className="w-4 h-4 text-slate-400" />
						12-Week Plans ({twelveWeekGoals.length})
					</h3>
					<span className="text-xs text-slate-400">Source: 12 Week Goals</span>
				</div>
				{twelveWeekGoals.length === 0 ? (
					<p className="p-6 text-sm text-slate-400 text-center">
						No 12-week plans on file for this client.
					</p>
				) : (
					<div className="divide-y divide-slate-100 dark:divide-slate-800">
						{twelveWeekGoals.map((g) => (
							<div key={g.id} className="px-4 py-3">
								<div className="flex items-center justify-between gap-2 mb-1">
									<p className="font-medium text-sm text-slate-900 dark:text-slate-100">
										{g.fields.Goal ?? g.fields.Name ?? '(unnamed)'}
									</p>
									{g.fields.Quarter && (
										<Badge color="primary">{g.fields.Quarter}</Badge>
									)}
								</div>
								<div className="flex items-center gap-3 text-xs text-slate-500">
									<span className="inline-flex items-center gap-1">
										<Calendar className="w-3 h-3" />
										{formatDate(g.fields['Start Date'])}
									</span>
									{g.fields['To-dos'] && g.fields['To-dos'].length > 0 && (
										<span>{g.fields['To-dos'].length} to-dos</span>
									)}
								</div>
							</div>
						))}
					</div>
				)}
			</Card>

			{/* Per-brand strategy from Client Media → Client Metrics */}
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
						<Compass className="w-4 h-4 text-slate-400" />
						PR Strategy by Brand ({brandMetrics.length})
					</h3>
					<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
						Source: Client Media · Client Metrics · matched by client name
					</p>
				</div>
				{brandMetrics.length === 0 ? (
					<p className="p-6 text-sm text-slate-400 text-center">
						No brand-level strategy records found in Client Media.
					</p>
				) : (
					<div className="divide-y divide-slate-100 dark:divide-slate-800">
						{brandMetrics.map((m) => {
							const mf = m.fields as ClientMetricFields;
							return (
								<div key={m.id} className="px-4 py-4 space-y-3">
									<div className="flex items-center justify-between">
										<p className="font-medium text-sm text-slate-900 dark:text-slate-100">
											{mf['Brand Name'] ?? mf['Contoso'] ?? '(unnamed brand)'}
										</p>
									</div>
									{mf['PR Plan'] && (
										<StrategySection
											icon={<Megaphone className="w-3.5 h-3.5" />}
											title="PR Plan"
											content={mf['PR Plan']}
										/>
									)}
									{mf['Message House'] && (
										<StrategySection
											icon={<FileText className="w-3.5 h-3.5" />}
											title="Message House"
											content={mf['Message House']}
										/>
									)}
									{mf['Awareness Day Calendar'] && (
										<StrategySection
											icon={<Calendar className="w-3.5 h-3.5" />}
											title="Awareness Days"
											content={mf['Awareness Day Calendar']}
										/>
									)}
									{mf.Notes && (
										<StrategySection
											icon={<FileText className="w-3.5 h-3.5" />}
											title="Notes"
											content={mf.Notes}
										/>
									)}
								</div>
							);
						})}
					</div>
				)}
			</Card>
		</div>
	);
}

function StrategySection({
	icon,
	title,
	content,
}: {
	icon: React.ReactNode;
	title: string;
	content: string;
}) {
	return (
		<div>
			<div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
				{icon}
				{title}
			</div>
			<p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
				{content}
			</p>
		</div>
	);
}
