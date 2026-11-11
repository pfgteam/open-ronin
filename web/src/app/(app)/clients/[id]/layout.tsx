// /clients/[id] layout — [id] is clients_v2.id. Fetches the client bundle
// (clients_v2 + contracts + the primary contract's Airtable record) once and
// renders the header (name + status + retainer + leads + health) plus a tab
// nav. Each tab page renders inside this layout's <main>.
//
// A legacy Airtable record id in [id] still resolves here (so the shell
// renders) while the page issues the 308 to the client id.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getClientContext, statusColor, healthColor, formatHealth, hasHealth } from './_lib';
import { getClientHealth } from '@/lib/health/server';
import { healthTone } from '@/lib/health/shared';
import { formatCurrency, formatDate } from '@/lib/format';
import { notFound } from 'next/navigation';
import ClientTabs from './ClientTabs';
import RequestButton from '@/components/nav/RequestButton';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
// The tab shows WHICH client — these are the pages people keep several of
// open at once. getClientContext is react-cache'd, so this costs no extra fetch.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const ctx = await getClientContext(id);
	return { title: ctx?.name ?? 'Client' };
}

interface LayoutProps {
	params: Promise<{ id: string }>;
	children: React.ReactNode;
}

export default async function ClientDetailLayout({ params, children }: LayoutProps) {
	const { id } = await params;
	const ctx = await getClientContext(id);
	if (!ctx) notFound();

	const f = ctx.fields;
	const name = ctx.name;
	const health = await getClientHealth(ctx.clientId);
	const status = f['Client Status'] ?? ctx.primary?.status ?? ctx.client.status;
	const retainer = f['Per Month'] ?? (ctx.primary?.per_month_cents != null ? ctx.primary.per_month_cents / 100 : undefined);

	return (
		<>
			{/* Breadcrumbs */}
			<div className="flex items-center gap-1 text-xs text-slate-500 mb-2">
				<Link href="/clients" className="hover:underline">
					Clients
				</Link>
				<ChevronRight className="w-3 h-3" />
				<span className="text-slate-700 dark:text-slate-300 truncate max-w-md">
					{name}
				</span>
			</div>

			{/* Header card */}
			<Card className="mb-4" padding="lg">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-3 flex-wrap">
							<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
								{name}
							</h1>
							{status && (
								<Badge color={statusColor(status)}>
									{status}
								</Badge>
							)}
							{health?.total_score != null ? (
								<Link href={`/clients/${ctx.clientId}/health`} title={`Computed ${health.coverage ? `from ${health.coverage.measured_count} of ${health.coverage.total_count} factors` : ''}`}>
									<Badge color={healthTone(health.total_score)}>
										Health: {health.total_score}
										{health.coverage && health.coverage.measured_count < health.coverage.total_count
											? ` · ${health.coverage.measured_count}/${health.coverage.total_count} measured`
											: ''}
									</Badge>
								</Link>
							) : hasHealth(f['Client Health']) ? (
								<Badge color={healthColor(f['Client Health'])}>
									Health: {formatHealth(f['Client Health'])}
								</Badge>
							) : null}
							{ctx.contracts.length > 1 && (
								<Badge color="default">{ctx.contracts.length} contracts</Badge>
							)}
						</div>
						<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
							{f.Industry && <span>{f.Industry}</span>}
							{f['Lead Source'] && <span>via {f['Lead Source']}</span>}
							{f['Kickoff(Service Start)'] && (
								<span>Kickoff {formatDate(f['Kickoff(Service Start)'])}</span>
							)}
							{f['End of Service'] && (
								<span>Ended {formatDate(f['End of Service'])}</span>
							)}
							{!ctx.contract && (
								<span className="text-amber-700 dark:text-amber-400">
									{ctx.airtableId ? 'Airtable record unavailable — showing mirror data' : 'No Airtable contract on file'}
								</span>
							)}
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
						<MetaField label="Retainer" value={formatCurrency(retainer)} />
						<MetaField
							label="Acct Lead"
							value={f['Acct Lead']?.name ?? '—'}
						/>
						<MetaField
							label="Media Specialist"
							value={f['Media Specialist']?.name ?? '—'}
						/>
						<MetaField
							label="SMM Acct Man"
							value={f['Acct Man-SMM']?.name ?? f.SMAM?.name ?? '—'}
						/>
						<MetaField
							label="Success Partner"
							value={
								f['Success Partner']
									?.map((c) => c.name)
									.filter(Boolean)
									.join(', ') ?? '—'
							}
						/>
						<MetaField label="POC Email" value={f['POC Email'] ?? '—'} />
					</div>
				</div>

				{f.Packages && f.Packages.length > 0 && (
					<div className="mt-4 flex flex-wrap gap-1.5">
						{f.Packages.map((p) => (
							<Badge key={p} color={/beacon/i.test(p) ? 'accent' : 'default'}>
								{p}
							</Badge>
						))}
					</div>
				)}
				{/* Contextual requests (menu sheet): open + New prefilled with this client. */}
				<div className="mt-4 flex flex-wrap gap-2">
					<RequestButton label="Request content" option="Content" context={{ label: name, params: { client: ctx.clientId } }} variant="outline" />
					<RequestButton label="Log client ticket" option="Client ticket" context={{ label: name, params: { client: ctx.clientId } }} variant="outline" />
				</div>
			</Card>

			{/* Tabs */}
			<ClientTabs id={ctx.clientId} />

			{/* Tab content */}
			<div className="mt-4">{children}</div>
		</>
	);
}

function MetaField({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-0.5">{label}</p>
			<p className="text-sm text-slate-900 dark:text-slate-100 truncate" title={value}>
				{value}
			</p>
		</div>
	);
}
