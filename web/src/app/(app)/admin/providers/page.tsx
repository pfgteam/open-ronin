// /admin/providers: the provider registry with key status, the caps table,
// today's spend, and the last 50 content jobs (WIP_BUILD_PLAN.md 1.5).
//
// Reads content_caps, content_spend_today() and content_jobs through the
// session client, so RLS decides; before migration 0065 is applied those
// queries fail and the page says so in a Callout instead of erroring,
// because the registry rows must render with or without the tables.

import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';
import { listProviders } from '@/lib/providers/registry';
import ProvidersTable, { type ProviderRow } from './ProvidersTable';
import { cancelJob, runNow, setCap } from './actions';

export const dynamic = 'force-dynamic';

interface CapRow {
	scope: 'role' | 'consumer';
	key: string;
	daily_usd: number;
	updated_at: string;
}
interface SpendRow {
	scope: string;
	key: string;
	label: string;
	usd: number;
	jobs: number;
}
interface JobRow {
	id: string;
	capability: string;
	provider: string;
	status: string;
	cost_usd: number | null;
	requested_via: string;
	consumer_slug: string | null;
	requested_by: string | null;
	error: string | null;
	created_at: string;
	finished_at: string | null;
}

const STATUS_DOT: Record<string, string> = {
	queued: 'bg-slate-400',
	submitted: 'bg-primary-500',
	running: 'bg-primary-500',
	done: 'bg-green-500',
	failed: 'bg-red-500',
	cancelled: 'bg-slate-300',
};

function th(label: string, right = false) {
	return <th className={`${right ? 'text-right' : 'text-left'} text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2`}>{label}</th>;
}

export default async function ProvidersPage() {
	const me = await getAuthProfile();
	if (!me) redirect('/auth/login?redirect=/admin/providers');
	if (!['admin', 'exec'].includes(me.role)) {
		return (
			<Card>
				<p className="text-sm text-slate-700 dark:text-slate-300">Providers are restricted to admin and exec roles.</p>
			</Card>
		);
	}

	const rows: ProviderRow[] = listProviders().map((p) => ({
		id: p.spec.id,
		label: p.spec.label,
		category: p.spec.category,
		capabilities: p.spec.capabilities,
		envKeys: p.spec.envKeys,
		docsUrl: p.spec.docsUrl,
		costNote: p.spec.costNote,
		async: p.spec.async,
		configured: p.configured,
		missingKeys: p.missingKeys,
	}));
	const configured = rows.filter((r) => r.configured).length;

	const supabase = await createClient();
	const [capsRes, spendRes, jobsRes] = await Promise.all([
		supabase.from('content_caps').select('scope, key, daily_usd, updated_at').order('scope').order('key'),
		supabase.rpc('content_spend_today'),
		supabase
			.from('content_jobs')
			.select('id, capability, provider, status, cost_usd, requested_via, consumer_slug, requested_by, error, created_at, finished_at')
			.order('created_at', { ascending: false })
			.limit(50),
	]);
	const tablesMissing = !!capsRes.error || !!jobsRes.error;
	const caps = (capsRes.data ?? []) as CapRow[];
	const spend = (spendRes.data ?? []) as SpendRow[];
	const jobs = (jobsRes.data ?? []) as JobRow[];

	const requesterIds = [...new Set(jobs.map((j) => j.requested_by).filter((v): v is string => !!v))];
	const { data: profiles } = requesterIds.length
		? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', requesterIds)
		: { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string }[] };
	const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email]));

	return (
		<>
			<PageHeader
				title="Providers"
				description={`${rows.length} content providers, ${configured} configured. Keys live in Vercel; this page shows presence only.`}
				actions={
					<form action={runNow}>
						<Button size="sm" variant="secondary" type="submit">
							Run queue now
						</Button>
					</form>
				}
			/>

			{tablesMissing && (
				<Callout tone="warning" className="mb-4">
					Migration 0065 (content_jobs, content_caps, the content bucket) is not applied yet. Provider rows and key status work; Test, caps, spend and the jobs list wait for it.
				</Callout>
			)}

			<div className="space-y-4">
				<ProvidersTable rows={rows} />

				<div className="grid gap-4 lg:grid-cols-2">
					<Card padding="none" className="overflow-hidden">
						<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
							<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Daily caps (USD)</span>
							<span className="text-xs tabular-nums text-slate-400">{caps.length}</span>
							<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
						</div>
						<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									{th('Scope')}
									{th('Key')}
									{th('Cap', true)}
									{th('')}
								</tr>
							</thead>
							<tbody>
								{caps.length === 0 && (
									<tr>
										<td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
											No caps yet — they arrive when Ops finishes enabling this.
										</td>
									</tr>
								)}
								{caps.map((c) => (
									<tr key={`${c.scope}:${c.key}`} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-2 text-xs text-slate-500">{c.scope}</td>
										<td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{c.key}</td>
										<td className="px-4 py-2 text-right">
											<form action={setCap} className="inline-flex items-center gap-2 justify-end">
												<input type="hidden" name="scope" value={c.scope} />
												<input type="hidden" name="key" value={c.key} />
												<Input name="daily_usd" type="number" step="1" min={0} max={10000} defaultValue={c.daily_usd} className="w-24 text-right tabular-nums py-1 text-xs" aria-label={`Daily cap for ${c.key}`} />
												<Button size="sm" variant="outline" type="submit">
													Save
												</Button>
											</form>
										</td>
										<td className="px-4 py-2 text-2xs text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatRelative(c.updated_at)}</td>
									</tr>
								))}
							</tbody>
						</table>
						</div>
					</Card>

					<Card padding="none" className="overflow-hidden">
						<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
							<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Spend today</span>
							<span className="text-xs tabular-nums text-slate-400">{spend.length}</span>
							<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
						</div>
						<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									{th('Who')}
									{th('Kind')}
									{th('Jobs', true)}
									{th('USD', true)}
								</tr>
							</thead>
							<tbody>
								{spend.length === 0 && (
									<tr>
										<td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-500">
											Nothing spent today.
										</td>
									</tr>
								)}
								{spend.map((s) => (
									<tr key={`${s.scope}:${s.key}`} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-2 text-xs text-slate-700 dark:text-slate-300">{s.label}</td>
										<td className="px-4 py-2 text-xs text-slate-500">{s.scope}</td>
										<td className="px-4 py-2 text-right text-xs tabular-nums">{s.jobs}</td>
										<td className="px-4 py-2 text-right text-xs tabular-nums">${Number(s.usd).toFixed(2)}</td>
									</tr>
								))}
							</tbody>
						</table>
						</div>
					</Card>
				</div>

				<Card padding="none" className="overflow-hidden">
					<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
						<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last 50 jobs</span>
						<span className="text-xs tabular-nums text-slate-400">{jobs.length}</span>
						<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									{th('When')}
									{th('Status')}
									{th('Provider')}
									{th('Capability')}
									{th('Requested by')}
									{th('Cost', true)}
									{th('Error')}
									{th('')}
								</tr>
							</thead>
							<tbody>
								{jobs.length === 0 && (
									<tr>
										<td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-500">
											No content jobs yet. Press Test on a configured provider to run the first one.
										</td>
									</tr>
								)}
								{jobs.map((j) => (
									<tr key={j.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{formatRelative(j.created_at)}</td>
										<td className="px-4 py-2 whitespace-nowrap">
											<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
												<span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[j.status] ?? 'bg-slate-400'}`} />
												{j.status}
											</span>
										</td>
										<td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{j.provider}</td>
										<td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">{j.capability.replace(/_/g, ' ')}</td>
										<td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">
											{j.requested_via === 'mcp' ? `agent ${j.consumer_slug ?? ''}` : (j.requested_by ? nameById.get(j.requested_by) : null) ?? 'System'}
										</td>
										<td className="px-4 py-2 text-right text-xs tabular-nums">{j.cost_usd !== null ? `$${Number(j.cost_usd).toFixed(3)}` : ''}</td>
										<td className="px-4 py-2 text-2xs text-red-600 dark:text-red-400 max-w-xs truncate" title={j.error ?? undefined}>
											{j.error ?? ''}
										</td>
										<td className="px-4 py-2 text-right">
											{['queued', 'submitted', 'running'].includes(j.status) && (
												<form action={cancelJob}>
													<input type="hidden" name="id" value={j.id} />
													<Button size="sm" variant="ghost" type="submit">
														Cancel
													</Button>
												</form>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			</div>
		</>
	);
}
