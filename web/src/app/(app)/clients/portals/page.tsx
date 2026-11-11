// /clients/portals — every client portal login (F5, 0144): who has one,
// who signed in, open approvals and requests per client.

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import { loadFlywheelConfig } from '@/lib/flywheel/server';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PortalsPage() {
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <Callout tone="warning">Client portals need migration 0144.</Callout>;
	const [{ data: users }, { data: approvals }, { data: notes }, { data: clients }] = await Promise.all([
		supabase.from('fw_portal_users').select('user_id, client_id, email, display_name, is_primary, is_active, invited_at, last_seen_at').order('invited_at', { ascending: false }),
		supabase.from('fw_approvals').select('client_id').eq('status', 'pending'),
		supabase.from('fw_portal_notes').select('client_id').in('status', ['open', 'acknowledged', 'in_progress']),
		supabase.from('clients_v2').select('id, display_name, status').eq('status', 'active').order('display_name'),
	]);
	type U = { user_id: string; client_id: string; email: string; display_name: string | null; is_primary: boolean; is_active: boolean; invited_at: string; last_seen_at: string | null };
	const us = (users ?? []) as U[];
	const pend = new Map<string, number>();
	for (const a of (approvals ?? []) as { client_id: string }[]) pend.set(a.client_id, (pend.get(a.client_id) ?? 0) + 1);
	const open = new Map<string, number>();
	for (const n of (notes ?? []) as { client_id: string }[]) open.set(n.client_id, (open.get(n.client_id) ?? 0) + 1);
	const cs = (clients ?? []) as { id: string; display_name: string; status: string }[];
	const withPortal = cs.filter((c) => us.some((u) => u.client_id === c.id));
	const without = cs.filter((c) => !us.some((u) => u.client_id === c.id));
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	return (
		<>
			<PageHeader title="Client portals" description={`${withPortal.length} of ${cs.length} active clients have a portal login · sign-in at ${appUrl}/portal (portal.example.com once DNS points here) · magic link per contact, strict org-scoped RLS`} />
			<Card className="mb-4">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">With a portal</h2>
				{withPortal.length === 0 ? (
					<p className="text-sm text-slate-500">None yet. Invite a contact from a client&apos;s Portal tab.</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
								<th className="py-1.5 pr-3">Client</th>
								<th className="py-1.5 pr-3">Logins</th>
								<th className="py-1.5 pr-3">Last seen</th>
								<th className="py-1.5 pr-3">Waiting on client</th>
								<th className="py-1.5">Open requests</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
							{withPortal.map((c) => {
								const mine = us.filter((u) => u.client_id === c.id);
								const seen = mine.map((u) => u.last_seen_at).filter(Boolean).sort().pop() ?? null;
								return (
									<tr key={c.id}>
										<td className="py-1.5 pr-3">
											<Link href={`/clients/${c.id}/portal`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
												{c.display_name}
											</Link>
										</td>
										<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{mine.map((u) => `${u.display_name ?? u.email}${u.is_active ? '' : ' (inactive)'}`).join(', ')}</td>
										<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{seen ? formatRelative(seen) : 'never'}</td>
										<td className="py-1.5 pr-3">{pend.get(c.id) ? <Badge color="warning">{pend.get(c.id)}</Badge> : '—'}</td>
										<td className="py-1.5">{open.get(c.id) ? <Badge color="primary">{open.get(c.id)}</Badge> : '—'}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</Card>
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Without a portal ({without.length})</h2>
				<p className="text-xs text-slate-500 mb-2">Open the client → Portal tab → invite the primary contact.</p>
				<ul className="columns-2 md:columns-3 text-xs text-slate-700 dark:text-slate-300">
					{without.map((c) => (
						<li key={c.id}>
							<Link href={`/clients/${c.id}/portal`} className="hover:underline">
								{c.display_name}
							</Link>
						</li>
					))}
				</ul>
			</Card>
		</>
	);
}
