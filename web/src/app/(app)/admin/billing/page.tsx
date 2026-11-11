// /admin/billing — Revenue + AR overview.
// Live data from Airtable Payments + Contract Agreement.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { BASE_IDS, type DataRecord } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import {
	DollarSign,
	AlertTriangle,
	TrendingUp,
	Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PaymentFields {
	'Due Date'?: string;
	Amount?: number;
	Type?: string;
	Client?: { id: string; name?: string }[];
	Status?: string;
	'Date Paid'?: string;
}

interface ContractFields {
	Client?: string;
	'Client Status'?: string;
	'Per Month'?: number;
	Packages?: string[];
	// Airtable percent field — a number like 0.85, NOT the word "High".
	'Client Health'?: string | number;
}

async function fetchBilling() {
	// These two used to be inline cursor walks — up to 50 serial Airtable round
	// trips per pageview, and the two walks ran one after the other inside the
	// Promise.all because each awaited its own pages in sequence.
	const [payments, contracts] = await Promise.all([
		listFullTable<PaymentFields>(BASE_IDS.CLIENT_CENTRAL, 'Payments', {
			fields: ['Due Date', 'Amount', 'Type', 'Client', 'Status', 'Date Paid'],
		}),
		listFullTable<ContractFields>(BASE_IDS.CLIENT_CENTRAL, 'Contract Agreement', {
			fields: ['Client', 'Client Status', 'Per Month', 'Packages', 'Client Health'],
		}),
	]).then(([p, c]) => [p.rows, c.rows] as const);

	const isActive = (s?: string) =>
		s === 'Active' || s === '30-day' || s === '60-day';

	const activeContracts = contracts.filter((c) => isActive(c.fields['Client Status']));
	const mrr = activeContracts.reduce((sum, c) => sum + (c.fields['Per Month'] ?? 0), 0);
	const avgRetainer = activeContracts.length > 0 ? mrr / activeContracts.length : 0;

	const isOverdue = (p: DataRecord<PaymentFields>) => {
		const status = (p.fields.Status ?? '').toLowerCase();
		if (status.includes('paid')) return false;
		const due = p.fields['Due Date'];
		if (!due) return false;
		return Date.parse(due) < Date.now();
	};

	const outstanding = payments
		.filter((p) => !(p.fields.Status ?? '').toLowerCase().includes('paid'))
		.reduce((s, p) => s + (p.fields.Amount ?? 0), 0);

	const overdue = payments.filter(isOverdue);
	const clientsAtRisk = new Set(
		overdue.flatMap((p) => (p.fields.Client ?? []).map((c) => c.name).filter(Boolean)),
	).size;

	// Last 8 payments for the table
	const recentPayments = payments
		.slice()
		.sort((a, b) => (b.fields['Due Date'] ?? '').localeCompare(a.fields['Due Date'] ?? ''))
		.slice(0, 12);

	// Top 5 overdue
	const topOverdue = overdue
		.slice()
		.sort((a, b) => (a.fields['Due Date'] ?? '').localeCompare(b.fields['Due Date'] ?? ''))
		.slice(0, 8);

	return {
		mrr,
		avgRetainer,
		outstanding,
		clientsAtRisk,
		activeCount: activeContracts.length,
		recentPayments,
		topOverdue,
	};
}

function statusColor(s?: string): 'default' | 'success' | 'warning' | 'danger' | 'primary' {
	if (!s) return 'default';
	const lower = s.toLowerCase();
	if (lower.includes('paid')) return 'success';
	if (lower.includes('past due') || lower.includes('overdue') || lower.includes('late'))
		return 'danger';
	if (lower.includes('pending') || lower.includes('follow')) return 'warning';
	return 'default';
}

interface KpiTileProps {
	label: string;
	value: string;
	icon: LucideIcon;
	subtitle?: string;
}

function KpiTile({ label, value, icon: Icon, subtitle }: KpiTileProps) {
	return (
		<Card>
			<div className="flex items-start justify-between mb-2">
				<div className="w-8 h-8 rounded-md bg-primary-50 dark:bg-primary-950 flex items-center justify-center">
					<Icon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
				</div>
			</div>
			<p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
			<p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
				{value}
			</p>
			{subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
		</Card>
	);
}

export default async function BillingPage() {
	const kpis = await fetchBilling();

	return (
		<>
			<PageHeader
				title={<>Billing &amp; Finance</>}
				description="Revenue, accounts receivable, and risk. Live from Airtable."
			/>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
				<KpiTile
					label="Total MRR"
					value={formatCurrency(kpis.mrr)}
					icon={DollarSign}
					subtitle={`${formatNumber(kpis.activeCount)} active contracts`}
				/>
				<KpiTile
					label="Outstanding AR"
					value={formatCurrency(kpis.outstanding)}
					icon={AlertTriangle}
				/>
				<KpiTile
					label="Avg retainer"
					value={formatCurrency(kpis.avgRetainer)}
					icon={TrendingUp}
				/>
				<KpiTile
					label="Clients at risk"
					value={formatNumber(kpis.clientsAtRisk)}
					icon={Users}
					subtitle="With overdue invoices"
				/>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				{/* Recent payments */}
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							Recent payments
						</h3>
					</div>
					{kpis.recentPayments.length === 0 ? (
						<p className="p-6 text-sm text-slate-400 text-center">No payments recorded.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
										<th className="px-4 py-2 font-medium">Due</th>
										<th className="px-4 py-2 font-medium">Client</th>
										<th className="px-4 py-2 font-medium text-right">Amount</th>
										<th className="px-4 py-2 font-medium">Status</th>
									</tr>
								</thead>
								<tbody>
									{kpis.recentPayments.map((p) => {
										const f = p.fields;
										return (
											<tr
												key={p.id}
												className="border-b border-slate-200 dark:border-slate-700"
											>
												<td className="px-4 py-2 text-slate-500 whitespace-nowrap">
													{formatDate(f['Due Date'])}
												</td>
												<td className="px-4 py-2 text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
													{(f.Client ?? [])
														.map((c) => c.name)
														.filter(Boolean)
														.join(', ') || '—'}
												</td>
												<td className="px-4 py-2 text-right font-mono">
													{formatCurrency(f.Amount)}
												</td>
												<td className="px-4 py-2">
													{f.Status && (
														<Badge color={statusColor(f.Status)}>{f.Status}</Badge>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</Card>

				{/* AR Risk */}
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
							<AlertTriangle className="w-4 h-4 text-red-500" />
							AR risk
						</h3>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
							Overdue invoices, oldest first
						</p>
					</div>
					{kpis.topOverdue.length === 0 ? (
						<p className="p-6 text-sm text-green-600 text-center">
							No overdue invoices. Nice work.
						</p>
					) : (
						<div className="divide-y divide-slate-200 dark:divide-slate-700">
							{kpis.topOverdue.map((p) => {
								const f = p.fields;
								const daysOverdue = f['Due Date']
									? Math.floor((Date.now() - Date.parse(f['Due Date'])) / 86400000)
									: 0;
								return (
									<div
										key={p.id}
										className="px-4 py-3 flex items-center justify-between gap-3"
									>
										<div className="min-w-0 flex-1">
											<p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
												{(f.Client ?? [])
													.map((c) => c.name)
													.filter(Boolean)
													.join(', ') || '—'}
											</p>
											<p className="text-xs text-slate-500 dark:text-slate-400">
												Due {formatDate(f['Due Date'])} · {daysOverdue} days overdue
											</p>
										</div>
										<span className="font-mono text-sm text-red-600 dark:text-red-400">
											{formatCurrency(f.Amount)}
										</span>
									</div>
								);
							})}
						</div>
					)}
				</Card>
			</div>

			<Card className="mt-4 border-dashed">
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
					Billing stack — what&apos;s wiring up next
				</h3>
				<p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
					Current numbers are from Airtable Payments (transition source). Real
					integrations replace this view as they land:
				</p>
				<ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1.5 list-disc list-inside">
					<li>
						<strong>NMI portal</strong> — primary processor, card-on-file + recurring charges
					</li>
					<li>
						<strong>QuickBooks</strong> — ACH bank info + invoice ledger source of truth
					</li>
					<li>
						<strong>Stripe</strong> — secondary processor for some clients
					</li>
					<li>
						<strong>Client-facing billing</strong> ships inside <code>/clients/portals</code> — each client sees their own invoices, methods, AR, autopay status at <code>portal.example.com/[client]</code>
					</li>
				</ul>
				<p className="text-xs text-slate-400 mt-3">
					The DataAdapter pattern lets the read switch from Airtable → NMI/QB/Stripe
					without changing any module pages.
				</p>
			</Card>
		</>
	);
}
