// /admin/health-factors — Admin-tunable Health Score factor weights per package.
// Reads seeded factors + computes weight totals per package.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Activity, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface FactorRow {
	id: string;
	key: string;
	label: string;
	description: string | null;
	category: string | null;
	data_source: string | null;
	is_active: boolean;
	default_weight_pct: number;
}

interface WeightRow {
	id: string;
	factor_id: string;
	package_name: string;
	weight_pct: number;
}

export default async function HealthFactorsPage() {
	const supabase = await createClient();
	const user = await getAuthUser();
	if (!user) redirect('/auth/login?redirect=/admin/health-factors');

	const { data: me } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	if (!me || !['exec', 'admin'].includes(me.role)) {
		return (
			<>
				<Card>
					<p className="text-sm text-slate-700 dark:text-slate-300">
						Health Factors is restricted to <code>admin</code> / <code>exec</code>.
					</p>
				</Card>
			</>
		);
	}

	const [{ data: factors }, { data: weights }] = await Promise.all([
		supabase
			.from('health_factors')
			.select('*')
			.order('default_weight_pct', { ascending: false }),
		supabase.from('health_package_weights').select('*'),
	]);

	const factorRows = (factors ?? []) as FactorRow[];
	const weightRows = (weights ?? []) as WeightRow[];

	const totalDefault = factorRows.reduce((s, f) => s + (f.default_weight_pct ?? 0), 0);

	return (
		<>
			<PageHeader
				title="Health Factors"
				description="Define the factors that compute Client Health Score · package-specific weights · the Engagement factor has its own sub-section"
			/>

			<Card className="mb-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-xs text-slate-500 dark:text-slate-400">Default total</p>
						<p className="text-2xl font-semibold">
							{totalDefault}
							<span className="text-base font-normal text-slate-400">%</span>
						</p>
					</div>
					<Badge color={totalDefault === 100 ? 'success' : 'warning'}>
						{totalDefault === 100
							? 'Balanced'
							: `${totalDefault < 100 ? 'Under' : 'Over'} by ${Math.abs(100 - totalDefault)}%`}
					</Badge>
				</div>
			</Card>

			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						Factors ({factorRows.length})
					</h2>
				</div>
				<div className="divide-y divide-slate-200 dark:divide-slate-700">
					{factorRows.map((f) => {
						const packageWeights = weightRows.filter((w) => w.factor_id === f.id);
						const isEngagement = f.key === 'engagement';
						return (
							<div key={f.id} className="px-4 py-4">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2 mb-1">
											<p className="font-medium text-sm text-slate-900 dark:text-slate-100">
												{f.label}
											</p>
											<Badge>{f.category ?? 'uncategorized'}</Badge>
											{!f.is_active && <Badge color="default">inactive</Badge>}
											{isEngagement && (
												<Badge color="primary">
													<Activity className="w-3 h-3 mr-1 inline" />
													has sub-section
												</Badge>
											)}
										</div>
										{f.description && (
											<p className="text-xs text-slate-500 dark:text-slate-400">
												{f.description}
											</p>
										)}
										<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1 font-mono">
											{f.key} · source: {f.data_source ?? '—'}
										</p>
										{isEngagement && (
											<div className="mt-3 ml-2 pl-3 border-l-2 border-primary-200 dark:border-primary-800">
												<p className="text-xs font-medium text-primary-700 dark:text-primary-400 mb-1">
													Engagement sub-rules
												</p>
												<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
													<li>· call attendance window (default 30d)</li>
													<li>· response staleness threshold (default 21d → flag)</li>
													<li>· min calls scheduled before scoring (default 2)</li>
													<li>· weighting of calls vs emails (default 70/30)</li>
												</ul>
												<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">
													UI for these knobs lands next session.
												</p>
											</div>
										)}
									</div>
									<div className="text-right shrink-0">
										<p className="text-xs text-slate-400">Default weight</p>
										<p className="text-lg font-semibold font-mono">
											{f.default_weight_pct}%
										</p>
										{packageWeights.length > 0 && (
											<p className="text-2xs text-slate-600 dark:text-slate-400 mt-1">
												{packageWeights.length} package overrides
											</p>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</Card>

			<Card className="mt-4 border-dashed">
				<div className="flex gap-3">
					<AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
					<div className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
						<p>
							<strong className="text-slate-900 dark:text-slate-100">
								Coming in the next admin UI pass:
							</strong>
						</p>
						<ul className="list-disc list-inside text-xs space-y-1">
							<li>Edit weights inline · drag to reorder · activate/deactivate</li>
							<li>
								Per-package weight matrix (Brand Accelerator vs Kickstarter vs Grow
								& Scale, etc.) — picks up the Packages list from Airtable
							</li>
							<li>Engagement sub-section with the 4 sub-rules above</li>
							<li>Add custom factor (e.g. &quot;renewal probability&quot;)</li>
							<li>Trigger recompute now (manual one-off)</li>
							<li>
								See <Link href="/admin/audit" className="text-primary-600 hover:underline">/admin/audit</Link>{' '}
								for who edited which factor when
							</li>
						</ul>
					</div>
				</div>
			</Card>
		</>
	);
}
