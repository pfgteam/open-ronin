// /clients/payments — All payments across clients.
// Source: Client Central → Payments. Client names link to /clients/[clients_v2.id]
// through the contracts mirror.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { BASE_IDS, DataAdapterError } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { resolveLinkNames } from '../[id]/_lib';
import { clientIdsForAirtableContracts } from '@/lib/clients/server';
import { formatCurrency, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface PaymentFields {
	'Due Date'?: string;
	Amount?: number;
	Type?: string;
	Client?: string[]; // multipleRecordLinks: rec ids, resolved to names via resolveLinkNames
	Status?: string;
	'Last Follow Up'?: string;
	'Date Paid'?: string;
	'New client '?: boolean;
	'Payment Method'?: string[];
	'Billing Contact'?: string;
	'AR Assignee'?: { id: string; name?: string; email?: string };
	Platform?: string;
}

async function fetchPayments() {
	try {
		const { rows } = await listFullTable<PaymentFields>(BASE_IDS.CLIENT_CENTRAL, 'Payments', {
			sort: [{ field: 'Due Date', direction: 'desc' }],
		});
		return { rows, error: null as string | null };
	} catch (e) {
		return {
			rows: [],
			error:
				e instanceof DataAdapterError
					? `${e.status} — ${e.message}`
					: e instanceof Error
						? e.message
						: String(e),
		};
	}
}

function statusColor(s?: string): 'default' | 'success' | 'warning' | 'danger' | 'primary' {
	if (!s) return 'default';
	// Real Payments Status options: Invoice / Pending / Follow Up / Paid /
	// Hold / Lost Revenue / Reminder / Charge Card.
	const lower = s.toLowerCase();
	if (lower.includes('paid') || lower === 'complete') return 'success';
	if (lower.includes('lost revenue')) return 'danger';
	if (lower.includes('hold') || lower.includes('pending') || lower.includes('follow') || lower.includes('reminder'))
		return 'warning';
	if (lower.includes('invoice') || lower.includes('charge card') || lower.includes('sent')) return 'primary';
	return 'default';
}

export default async function PaymentsPage() {
	const { rows, error } = await fetchPayments();

	// Resolve Client link ids -> client names (REST returns bare rec ids) and
	// -> clients_v2.id for the detail link.
	const clientIds = rows.flatMap((r) => r.fields.Client ?? []);
	const [clientNames, clientKeys] = await Promise.all([
		resolveLinkNames(BASE_IDS.CLIENT_CENTRAL, 'Contract Agreement', clientIds, 'Client'),
		clientIdsForAirtableContracts(clientIds),
	]);

	const now = Date.now();
	const past90Days = rows.filter((r) => {
		const due = r.fields['Due Date'];
		if (!due) return false;
		return Date.parse(due) > now - 90 * 86400000;
	});

	// Outstanding AR = unpaid, excluding written-off revenue ('Lost Revenue').
	const outstanding = rows
		.filter((r) => {
			const s = (r.fields.Status ?? '').toLowerCase();
			return !s.includes('paid') && !s.includes('lost revenue') && r.fields.Amount;
		})
		.reduce((sum, r) => sum + (r.fields.Amount ?? 0), 0);

	const paidLast90 = past90Days
		.filter((r) => (r.fields.Status ?? '').toLowerCase().includes('paid'))
		.reduce((sum, r) => sum + (r.fields.Amount ?? 0), 0);

	return (
		<>
			<PageHeader
				title="Payments"
				description={`Live from Airtable · Client Central · Payments · ${rows.length} records`}
				actions={
					<div className="flex items-center gap-6 text-right text-xs">
						<div>
							<div className="text-slate-500">Outstanding</div>
							<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
								{formatCurrency(outstanding)}
							</div>
						</div>
						<div>
							<div className="text-slate-500">Paid (last 90d)</div>
							<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
								{formatCurrency(paidLast90)}
							</div>
						</div>
					</div>
				}
			/>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error}
					</p>
				</Card>
			)}

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Due
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Client
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Type
								</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Amount
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Status
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Paid
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									AR Owner
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.length === 0 ? (
								<tr>
									<td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
										No payments on file.
									</td>
								</tr>
							) : (
								rows.slice(0, 200).map((row) => {
									const f = row.fields;
									return (
										<tr
											key={row.id}
											className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
										>
											<td className="px-4 py-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
												{formatDate(f['Due Date'])}
											</td>
											<td className="px-4 py-3 text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
												{(f.Client ?? []).length === 0
													? '—'
													: (f.Client ?? []).map((cid, i) => {
															const name = clientNames.get(cid) ?? cid;
															const key = clientKeys.get(cid);
															return (
																<span key={cid}>
																	{i > 0 ? ', ' : ''}
																	{key ? (
																		<Link href={`/clients/${key}`} className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline">
																			{name}
																		</Link>
																	) : (
																		name
																	)}
																</span>
															);
														})}
											</td>
											<td className="px-4 py-3 text-slate-500">{f.Type ?? '—'}</td>
											<td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-slate-100">
												{formatCurrency(f.Amount)}
											</td>
											<td className="px-4 py-3">
												{f.Status && <Badge color={statusColor(f.Status)}>{f.Status}</Badge>}
											</td>
											<td className="px-4 py-3 text-slate-500 whitespace-nowrap">
												{formatDate(f['Date Paid'])}
											</td>
											<td className="px-4 py-3 text-slate-500 truncate max-w-[140px]">
												{f['AR Assignee']?.name ?? '—'}
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</Card>
			{rows.length > 200 && (
				<p className="text-xs text-slate-400 mt-3 text-center">
					Showing first 200 of {rows.length}.
				</p>
			)}
		</>
	);
}
