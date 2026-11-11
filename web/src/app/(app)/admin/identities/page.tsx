// /admin/identities — the spine identity registry (migration 0106). Every
// agent identity with its owner, scope ceiling, bound MCP consumers and
// hygiene flags, plus unbound consumers (a provisioning smell: no act, no
// sub). Read-only: hiring and retiring go through spine.provision_identity /
// spine.retire_identity (SPINE_HIRING_PLAN.md) so every change is a numbered,
// audited call rather than a form. Exec + admin only.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { formatDate, formatRelative } from '@/lib/format';
import {
	FLAG_LABELS,
	identityFlags,
	type IdentityFlag,
	type RegistryIdentity,
	type UnboundConsumer,
} from '@/lib/spine/identityRegistryShared';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Spine Identities' };

const FLAG_COLOR: Record<IdentityFlag, 'default' | 'warning' | 'danger'> = {
	disabled: 'default',
	no_owner: 'danger',
	no_live_consumer: 'warning',
	consumer_never_used: 'warning',
	consumer_stale_90d: 'warning',
	consumer_over_ceiling: 'danger',
};

const TIER_COLOR: Record<RegistryIdentity['tier'], 'default' | 'primary' | 'warning' | 'accent'> = {
	reader: 'default',
	writer: 'warning',
	audit: 'primary',
	personal_assistant: 'accent',
};

export default async function IdentitiesPage() {
	const supabase = await createClient();
	const user = await getAuthUser();
	const { data: me } = user
		? await supabase.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle()
		: { data: null };
	const canView = !!me && me.is_active && (me.role === 'admin' || me.role === 'exec');

	if (!canView) {
		return (
			<Card>
				<div className="text-center py-12 text-slate-500">
					<Lock className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
					<p className="text-sm">The identity registry is visible to exec and admin accounts only.</p>
				</div>
			</Card>
		);
	}

	const [{ data: regData, error: regError }, { data: unboundData }] = await Promise.all([
		supabase.rpc('mcp_identity_registry_guarded'),
		supabase.rpc('mcp_unbound_consumers'),
	]);

	if (regError) {
		return (
			<>
				<PageHeader title="Spine Identities" description="Agent identities, their tokens and scope ceilings" />
				<Callout tone="warning">
					Migration 0106 (spine identity provisioning) is not applied yet, so the registry cannot be read. Until then
					identities are listed only in spine.agent_identities and consumers in mcp_consumers.
				</Callout>
			</>
		);
	}

	const identities = ((regData ?? []) as RegistryIdentity[]).map((r) => ({ ...r, flags: identityFlags(r) }));
	const unbound = (unboundData ?? []) as UnboundConsumer[];
	const flaggedCount = identities.filter((r) => r.flags.length > 0).length;
	const liveTokens = identities.reduce((n, r) => n + r.consumers.filter((c) => !c.revoked_at).length, 0);

	return (
		<>
			<PageHeader
				title="Spine Identities"
				description={`${identities.length} identities · ${liveTokens} live tokens · ${flaggedCount} flagged · ${unbound.length} unbound consumers`}
			/>

			<div className="space-y-4">
				<Callout tone="info">
					Hire with <code className="text-2xs">spine.provision_identity(...)</code>, mint a token with{' '}
					<code className="text-2xs">public.mcp_provision_consumer(...)</code>, retire with{' '}
					<code className="text-2xs">spine.retire_identity(...)</code>. The checklist and the rule for what &ldquo;moved to
					Open Ronin&rdquo; changes for Hermes live in SPINE_HIRING_PLAN.md. Tokens are shown here as scopes and last use only;
					the plaintext is returned once at mint and never stored.
				</Callout>

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
						<ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Identities</h2>
					</div>
					{identities.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-6">No identities in the catalog.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
									<tr>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Identity</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Tier</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Owner (sub)</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Scope ceiling</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Tokens</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Grants</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Activity</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Flags</th>
									</tr>
								</thead>
								<tbody>
									{identities.map((r) => {
										const live = r.consumers.filter((c) => !c.revoked_at);
										return (
											<tr
												key={r.slug}
												className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top"
											>
												<td className="px-3 py-2">
													<div className="text-slate-900 dark:text-slate-100 font-medium">{r.display_name ?? r.slug}</div>
													<div className="text-2xs text-slate-600 dark:text-slate-400 font-mono">{r.slug}</div>
													<div className="text-2xs text-slate-500 mt-1 max-w-xs">{r.justification}</div>
												</td>
												<td className="px-3 py-2">
													<Badge color={TIER_COLOR[r.tier]}>{r.tier}</Badge>
													<div className="text-2xs text-slate-500 mt-1">{r.workflow}</div>
												</td>
												<td className="px-3 py-2">
													{r.owner ? (
														<Link href={`/team/${r.owner.id}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600 transition-colors">
															{r.owner.name ?? r.owner.email}
														</Link>
													) : (
														<span className="text-slate-500">—</span>
													)}
												</td>
												<td className="px-3 py-2">
													<div className="flex flex-wrap gap-1 max-w-xs">
														{r.allowed_scopes.length === 0 ? (
															<span className="text-slate-500 text-2xs">none</span>
														) : (
															r.allowed_scopes.map((s) => (
																<Badge key={s} className="text-2xs font-mono">
																	{s}
																</Badge>
															))
														)}
													</div>
												</td>
												<td className="px-3 py-2">
													{live.length === 0 ? (
														<span className="text-slate-500">none</span>
													) : (
														<ul className="space-y-1">
															{live.map((c) => (
																<li key={c.slug} className="text-2xs">
																	<span className="font-mono text-slate-900 dark:text-slate-100">{c.slug}</span>
																	<span className="text-slate-500"> · {c.scopes.length} scopes · </span>
																	<span className="text-slate-500">
																		{c.last_used_at ? `used ${formatRelative(c.last_used_at)}` : 'never used'}
																	</span>
																</li>
															))}
														</ul>
													)}
													{r.consumers.length > live.length && (
														<div className="text-2xs text-slate-500 mt-1">{r.consumers.length - live.length} revoked</div>
													)}
												</td>
												<td className="px-3 py-2 text-2xs text-slate-500">
													{r.table_grants.length === 0 ? 'none (reads via service role)' : r.table_grants.join(', ')}
												</td>
												<td className="px-3 py-2 text-2xs text-slate-500">
													<div>{r.audit_rows_30d} audit rows / 30d</div>
													<div>{r.last_audit_at ? `last ${formatRelative(r.last_audit_at)}` : 'no audit rows'}</div>
													<div>since {formatDate(r.created_at)}</div>
												</td>
												<td className="px-3 py-2">
													<div className="flex flex-wrap gap-1">
														{r.flags.length === 0 ? (
															<Badge color="success" className="text-2xs">
																clean
															</Badge>
														) : (
															r.flags.map((f) => (
																<Badge key={f} color={FLAG_COLOR[f]} className="text-2xs">
																	{FLAG_LABELS[f]}
																</Badge>
															))
														)}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</Card>

				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
						<KeyRound className="w-3.5 h-3.5 text-slate-400" />
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Unbound consumers</h2>
						<span className="text-2xs text-slate-500">tokens with no identity: reads carry no act / sub</span>
					</div>
					{unbound.length === 0 ? (
						<p className="text-sm text-slate-500 text-center py-6">Every live token is bound to an identity.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="bg-slate-50/80 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
									<tr>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Slug</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Name</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Scopes</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Created</th>
										<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Last used</th>
									</tr>
								</thead>
								<tbody>
									{unbound.map((c) => (
										<tr key={c.slug} className="border-b border-slate-200 dark:border-slate-700">
											<td className="px-3 py-2 font-mono text-2xs text-slate-900 dark:text-slate-100">{c.slug}</td>
											<td className="px-3 py-2 text-slate-600 dark:text-slate-400">{c.name}</td>
											<td className="px-3 py-2">
												<div className="flex flex-wrap gap-1">
													{c.scopes.map((s) => (
														<Badge key={s} className="text-2xs font-mono">
															{s}
														</Badge>
													))}
												</div>
											</td>
											<td className="px-3 py-2 text-slate-500">{formatDate(c.created_at)}</td>
											<td className="px-3 py-2 text-slate-500">{c.last_used_at ? formatRelative(c.last_used_at) : 'never'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			</div>
		</>
	);
}
