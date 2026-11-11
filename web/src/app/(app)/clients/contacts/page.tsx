// /clients/contacts — Aggregated client-side contacts.
// Derived from Client Central → Contract Agreement (POC Email / Billing Email
// / Billing PoC). Rows link to /clients/[clients_v2.id] via the contracts
// mirror. Future iteration could pull from a dedicated contacts table.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { BASE_IDS, DataAdapterError } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { clientIdsForAirtableContracts } from '@/lib/clients/server';
import { Mail } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ContractFields {
	Client?: string;
	'Client Status'?: string;
	'POC Email'?: string;
	'Billing Email'?: string;
	'Billing PoC'?: string;
	'Acct Lead'?: { id: string; name?: string };
}

async function fetchContacts() {
	try {
		const { rows: all } = await listFullTable<ContractFields>(
			BASE_IDS.CLIENT_CENTRAL,
			'Contract Agreement',
			{
				fields: [
					'Client',
					'Client Status',
					'POC Email',
					'Billing Email',
					'Billing PoC',
					'Acct Lead',
				],
			},
		);

		// Only keep records with at least one email or contact name
		const withContacts = all.filter(
			(r) => r.fields['POC Email'] || r.fields['Billing Email'] || r.fields['Billing PoC'],
		);
		// Active clients first
		withContacts.sort((a, b) => {
			const sa = a.fields['Client Status'] === 'Active' ? 0 : 1;
			const sb = b.fields['Client Status'] === 'Active' ? 0 : 1;
			if (sa !== sb) return sa - sb;
			return (a.fields.Client ?? '').localeCompare(b.fields.Client ?? '');
		});

		return { rows: withContacts, error: null as string | null };
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

export default async function ContactsPage() {
	const { rows, error } = await fetchContacts();
	const clientIds = await clientIdsForAirtableContracts(rows.map((r) => r.id));

	return (
		<>
			<PageHeader
				title="Contacts"
				description={`Derived from Contract Agreement · ${rows.length} clients with on-file contacts`}
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
									Client
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									POC Email
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Billing PoC
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Billing Email
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Acct Lead
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.slice(0, 200).map((row) => {
								const f = row.fields;
								const clientId = clientIds.get(row.id);
								return (
									<tr
										key={row.id}
										className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
									>
										<td className="px-4 py-3">
											{clientId ? (
												<Link
													href={`/clients/${clientId}`}
													className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
												>
													{f.Client ?? '—'}
												</Link>
											) : (
												<span className="font-medium text-slate-700 dark:text-slate-300" title="Not yet mirrored to clients_v2">
													{f.Client ?? '—'}
												</span>
											)}
										</td>
										<td className="px-4 py-3">
											{f['POC Email'] ? (
												<a
													href={`mailto:${f['POC Email']}`}
													className="inline-flex items-center gap-1.5 text-primary-600 hover:underline"
												>
													<Mail className="w-3 h-3" />
													{f['POC Email']}
												</a>
											) : (
												<span className="text-slate-300">—</span>
											)}
										</td>
										<td className="px-4 py-3 text-slate-700 dark:text-slate-300 truncate max-w-[180px]">
											{f['Billing PoC'] ?? '—'}
										</td>
										<td className="px-4 py-3">
											{f['Billing Email'] ? (
												<a
													href={`mailto:${f['Billing Email']}`}
													className="inline-flex items-center gap-1.5 text-primary-600 hover:underline"
												>
													<Mail className="w-3 h-3" />
													{f['Billing Email']}
												</a>
											) : (
												<span className="text-slate-300">—</span>
											)}
										</td>
										<td className="px-4 py-3 text-slate-500 truncate max-w-[140px]">
											{f['Acct Lead']?.name ?? '—'}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</Card>
		</>
	);
}
