// /admin/bots — Bot Management. Create, view and edit Hermes bot profiles
// with the same sections `hermes setup` configures (model, tts, terminal,
// gateway, tools, telemetry, agent). Separate from /admin/identities (0106,
// read-only spine registry): this page is about the fleet host's profiles,
// spine-migrated or not.
//
// Boundary: Open Ronin stores the DESIRED config and a provisioning queue
// (migration 0112). scripts/hermes_bot_bridge.py runs on the fleet host as a
// cron, applies each request with `hermes profile create` / `hermes config
// set`, acks it, and reports the OBSERVED state of every profile. So the
// list shows what the host last reported and each row's status says whether
// the last save has landed. MCP scopes are the one immediate write (they are
// Open Ronin-side state). Exec + admin only, same gate as /admin/identities.

import Link from 'next/link';
import { Bot, Lock, Plus, RefreshCw } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';
import { loadBotsPage } from '@/lib/bots/server';
import { SYNC_STALE_MS, consumerForBot, type BotRow, type BotStatus } from '@/lib/bots/shared';
import BotForm from './BotForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bots' };

const STATUS_COLOR: Record<BotStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
	draft: 'default',
	pending: 'warning',
	applied: 'success',
	failed: 'danger',
	retired: 'default',
};

function observedModel(b: BotRow): { provider?: string; model?: string } {
	const m = (b.observed as { model?: { provider?: string; default?: string } } | null)?.model;
	return { provider: m?.provider, model: m?.default };
}

function observedToolsets(b: BotRow): string[] {
	const t = (b.observed as { tools?: { toolsets?: unknown } } | null)?.tools?.toolsets;
	return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
}

function observedDisabledToolsets(b: BotRow): string[] {
	const t = (b.observed as { tools?: { disabled?: unknown } } | null)?.tools?.disabled;
	return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
}

export default async function BotsPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
	const params = await searchParams;
	const supabase = await createClient();
	const user = await getAuthUser();
	const { data: me } = user ? await supabase.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle() : { data: null };
	const canView = !!me && me.is_active && (me.role === 'admin' || me.role === 'exec');

	if (!canView) {
		return (
			<Card>
				<div className="text-center py-12 text-slate-500">
					<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
					<p className="text-sm">Bot management is visible to exec and admin accounts only.</p>
				</div>
			</Card>
		);
	}

	const data = await loadBotsPage();
	if (!data.applied) {
		return (
			<>
				<PageHeader title="Bots" description="Hermes bot profiles: model, tools, terminal, telemetry, agent settings" />
				<Callout tone="warning">
					Migration 0112 (bot profiles) is not applied yet, so there is nothing to list. Until then bots are managed with{' '}
					<code className="text-2xs">hermes setup</code> per profile on the fleet host.
				</Callout>
			</>
		);
	}

	const { bots, consumers, catalog, lastSync, pending } = data;
	const live = bots.filter((b) => b.status !== 'retired');
	const running = live.filter((b) => b.gateway_running).length;
	const syncAge = lastSync ? Date.now() - Date.parse(lastSync.at) : null;
	const stale = syncAge === null || syncAge > SYNC_STALE_MS;
	const editing = params.edit ? (bots.find((b) => b.name === params.edit) ?? null) : null;
	const creating = params.new === '1';

	return (
		<>
			<PageHeader
				title="Bots"
				description={`${live.length} profiles · ${running} gateway running · ${pending} pending on the bridge${catalog.hermes_version ? ` · hermes ${catalog.hermes_version}` : ''}`}
				actions={
					<Link href="/admin/bots?new=1">
						<Button size="sm">
							<Plus className="w-3.5 h-3.5" /> New bot
						</Button>
					</Link>
				}
			/>

			<div className="space-y-4">
				{stale ? (
					<Callout tone="warning">
						{lastSync
							? `The fleet bridge last reported ${formatRelative(lastSync.at)} from ${lastSync.host}; what you see may be behind the host.`
							: 'The fleet bridge has never reported. Rows here are desired config only until scripts/hermes_bot_bridge.py runs on the Hermes host (cron every 15 min with INGEST_API_KEY).'}
					</Callout>
				) : (
					<Callout tone="info">
						<span className="inline-flex items-center gap-1.5">
							<RefreshCw className="w-3.5 h-3.5" />
							Host {lastSync!.host} reported {formatRelative(lastSync!.at)}. Saves queue a provisioning request; the bridge applies it on its
							next pass and the row flips from <em>pending</em> to <em>applied</em>.
						</span>
					</Callout>
				)}

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
						<Bot className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Roster</h2>
					</div>
					{bots.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-6">No bots yet. Create one, or wait for the bridge to report the host&rsquo;s profiles.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
									<tr>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Bot</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Gateway</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Model</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Tools</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">MCP</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
										<th className="px-3 py-2" />
									</tr>
								</thead>
								<tbody>
									{bots.map((b) => {
										const om = observedModel(b);
										const tools = observedToolsets(b);
										const disabled = observedDisabledToolsets(b);
										const consumer = consumerForBot(b.name, consumers);
										return (
											<tr
												key={b.id}
												className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top"
											>
												<td className="px-3 py-2">
													<div className="text-slate-900 dark:text-slate-100 font-medium">{b.display_name ?? b.name}</div>
													<div className="text-2xs text-slate-600 dark:text-slate-400 font-mono">{b.name}</div>
													{b.role_description && <div className="text-2xs text-slate-500 mt-1 max-w-sm line-clamp-2">{b.role_description}</div>}
												</td>
												<td className="px-3 py-2">
													{b.gateway_running === null ? (
														<span className="text-slate-500 text-2xs">unknown</span>
													) : b.gateway_running ? (
														<Badge color="success">running</Badge>
													) : (
														<Badge>stopped</Badge>
													)}
												</td>
												<td className="px-3 py-2 text-2xs">
													<div className="text-slate-900 dark:text-slate-100 font-mono">{om.model ?? b.desired.model?.default ?? '—'}</div>
													<div className="text-slate-500">{om.provider ?? b.desired.model?.provider ?? ''}</div>
												</td>
												<td className="px-3 py-2 text-2xs text-slate-600 dark:text-slate-400 max-w-xs">
													{tools.length ? `${tools.length} toolsets` : b.desired.tools?.toolsets?.length ? `${b.desired.tools.toolsets.length} desired` : '—'}
													{tools.length > 0 && <div className="text-slate-500 truncate">{tools.join(', ')}</div>}
													{disabled.length > 0 && (
														<div className="text-amber-600 dark:text-amber-400 truncate" title="agent.disabled_toolsets (hard deny)">
															deny: {disabled.join(', ')}
														</div>
													)}
												</td>
												<td className="px-3 py-2 text-2xs">
													{consumer ? (
														<>
															<div className="font-mono text-slate-900 dark:text-slate-100">{consumer.slug}</div>
															<div className="text-slate-500">{consumer.scopes.length} scopes{consumer.identity_slug ? ` · ${consumer.identity_slug}` : ''}</div>
														</>
													) : (
														<span className="text-slate-500">no token</span>
													)}
												</td>
												<td className="px-3 py-2">
													<Badge color={STATUS_COLOR[b.status]}>{b.status}</Badge>
													<div className="text-2xs text-slate-500 mt-1">{b.observed_at ? `seen ${formatRelative(b.observed_at)}` : 'never seen on host'}</div>
													{b.last_error && <div className="text-2xs text-red-600 dark:text-red-400 mt-1 max-w-xs">{b.last_error}</div>}
												</td>
												<td className="px-3 py-2 text-right">
													<Link href={`/admin/bots?edit=${encodeURIComponent(b.name)}`} className="text-xs text-primary-600 hover:text-primary-700 transition-colors">
														Edit
													</Link>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			</div>

			{(creating || editing) && (
				<BotForm
					bot={editing}
					consumer={editing ? consumerForBot(editing.name, consumers) : null}
					catalog={catalog}
					existingNames={bots.map((b) => b.name)}
				/>
			)}
		</>
	);
}
