// /admin/audit — Recent audit events from Supabase audit_log.
// Restricted to admin/exec (RLS handles it but middleware redirects).

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';
import { redirect } from 'next/navigation';
import {
	LogIn,
	Plus,
	Pencil,
	Trash2,
	Download,
	Activity,
	type LucideIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface AuditRow {
	id: number;
	actor_id: string | null;
	entity_kind: string;
	entity_ref: string;
	action: string;
	diff: unknown;
	ip: string | null;
	status: string | null;
	created_at: string;
}

interface ProfileMini {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

const ACTION_ICONS: Record<string, LucideIcon> = {
	login: LogIn,
	logout: LogIn,
	create: Plus,
	update: Pencil,
	delete: Trash2,
	export: Download,
	sync: Activity,
};

const ACTION_COLOR: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'primary'> = {
	login: 'primary',
	logout: 'default',
	create: 'success',
	update: 'warning',
	delete: 'danger',
	export: 'primary',
	sync: 'default',
};

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
	success: 'success',
	warning: 'warning',
	error: 'danger',
};

export default async function AuditPage() {
	const supabase = await createClient();

	// Auth + role gate
	const user = await getAuthUser();
	if (!user) redirect('/auth/login?redirect=/admin/audit');
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
						Audit log is restricted to <code>admin</code> / <code>exec</code> roles.
					</p>
				</Card>
			</>
		);
	}

	const [{ data: events, error }, { data: profiles }] = await Promise.all([
		supabase
			.from('audit_log')
			.select('*')
			.order('created_at', { ascending: false })
			.limit(200),
		supabase.from('profiles').select('id, first_name, last_name, email'),
	]);

	const rows = (events ?? []) as AuditRow[];
	const profilesById = new Map<string, ProfileMini>();
	for (const p of (profiles ?? []) as ProfileMini[]) profilesById.set(p.id, p);

	return (
		<>
			<PageHeader
				title="Audit Log"
				description={
					<>
						{rows.length} most recent events · Supabase <code>audit_log</code>
					</>
				}
			/>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error.message}
					</p>
				</Card>
			)}

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									When
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Actor
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Action
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Entity
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									Status
								</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">
									IP
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.length === 0 ? (
								<tr>
									<td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
										No audit events yet. They&apos;ll start appearing as the app records writes.
									</td>
								</tr>
							) : (
								rows.map((e) => {
									const profile = e.actor_id ? profilesById.get(e.actor_id) : null;
									const actorName = profile
										? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() ||
											profile.email
										: e.actor_id
											? '(deleted user)'
											: 'System';
									const Icon = ACTION_ICONS[e.action] ?? Activity;
									return (
										<tr
											key={e.id}
											className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors"
										>
											<td className="px-4 py-3 text-slate-500 whitespace-nowrap">
												{formatRelative(e.created_at)}
											</td>
											<td className="px-4 py-3 text-slate-700 dark:text-slate-300">
												{actorName}
											</td>
											<td className="px-4 py-3">
												<Badge color={ACTION_COLOR[e.action] ?? 'default'}>
													<Icon className="w-3 h-3 mr-1 inline" />
													{e.action}
												</Badge>
											</td>
											<td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 truncate max-w-md">
												<span className="text-slate-400">{e.entity_kind}:</span>{' '}
												{e.entity_ref}
											</td>
											<td className="px-4 py-3">
												{e.status && (
													<Badge color={STATUS_COLOR[e.status] ?? 'default'}>
														{e.status}
													</Badge>
												)}
											</td>
											<td className="px-4 py-3 text-slate-500 font-mono text-xs">
												{e.ip ?? '—'}
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</Card>

			<p className="text-xs text-slate-400 mt-4">
				90-day TTL via pg_cron lands next session · Filter + export buttons coming.
			</p>
		</>
	);
}
