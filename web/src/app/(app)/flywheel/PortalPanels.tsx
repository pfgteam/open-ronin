'use client';

// Staff-side portal panels (F5): contacts + invites, pending approvals,
// client requests, Google connection status.

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

import ActionForm from './ActionForm';
import { inviteContact, pullGoogleNow, replyNote, resendInvite, setPortalUserActive, withdrawApproval } from './portalActions';

export interface PortalUserRow {
	user_id: string;
	client_id: string;
	email: string;
	display_name: string | null;
	is_primary: boolean;
	is_active: boolean;
	invited_at: string;
	first_seen_at: string | null;
	last_seen_at: string | null;
}
export interface StaffApprovalRow {
	id: string;
	kind: string;
	title: string;
	status: string;
	requested_at: string;
	due_at: string | null;
	decided_at: string | null;
	decided_by_label: string | null;
	client_comment: string | null;
	reminder_1_at: string | null;
	escalated_at: string | null;
}
export interface StaffNoteRow {
	id: string;
	client_id: string;
	program_id: string | null;
	kind: string;
	title: string;
	body_md: string | null;
	meta: Record<string, unknown>;
	status: string;
	reply_md: string | null;
	internal_note: string | null;
	created_at: string;
	created_by_label: string | null;
	client_name?: string;
}

export function PortalUsersPanel({ clientId, programId, users, appUrl, contacts }: { clientId: string; programId: string | null; users: PortalUserRow[]; appUrl: string; contacts: { id: string; display_name: string; email: string | null }[] }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Portal logins</h2>
			<p className="text-xs text-slate-500 mb-2">
				Magic-link logins per client contact (decision 28: nobody makes logins by hand). The client signs in at <code>{appUrl}/portal</code>. A portal login can never read a staff row (RLS wall).
			</p>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
				{users.map((u) => (
					<li key={u.user_id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
						<span>
							<span className="font-medium text-slate-800 dark:text-slate-200">{u.display_name ?? u.email}</span> <span className="text-slate-500">{u.email}</span>
							{u.is_primary && <Badge className="ml-1">primary</Badge>}
							{!u.is_active && <Badge color="danger" className="ml-1">inactive</Badge>}
							<span className="block text-2xs text-slate-500">invited {u.invited_at.slice(0, 10)} · {u.last_seen_at ? `last seen ${u.last_seen_at.slice(0, 10)}` : 'never signed in'}</span>
						</span>
						<span className="flex gap-1">
							<ActionForm action={resendInvite} success="Link sent (if SMTP is configured).">
								<input type="hidden" name="email" value={u.email} />
								<Button type="submit" size="sm" variant="ghost">
									Resend link
								</Button>
							</ActionForm>
							<ActionForm action={setPortalUserActive} success={null}>
								<input type="hidden" name="user_id" value={u.user_id} />
								<input type="hidden" name="client_id" value={clientId} />
								{programId && <input type="hidden" name="program_id" value={programId} />}
								<input type="hidden" name="is_active" value={u.is_active ? 'off' : 'on'} />
								<Button type="submit" size="sm" variant="ghost">
									{u.is_active ? 'Deactivate' : 'Reactivate'}
								</Button>
							</ActionForm>
						</span>
					</li>
				))}
				{users.length === 0 && <li className="py-2 text-xs text-slate-500">No portal logins yet.</li>}
			</ul>
			<ActionForm action={inviteContact} success="Invited — the magic link is on its way (when SMTP is configured; otherwise copy a link from Supabase Auth → Users)." className="grid gap-1.5 md:grid-cols-[1fr_1fr_160px_auto_auto]" resetOnSuccess>
				<input type="hidden" name="client_id" value={clientId} />
				{programId && <input type="hidden" name="program_id" value={programId} />}
				<Input name="email" type="email" placeholder="contact@client.com" required />
				<Input name="display_name" placeholder="Name" />
				<Select name="contact_id" size="sm" defaultValue="">
					<option value="">New contact</option>
					{contacts.map((c) => (
						<option key={c.id} value={c.id}>
							{c.display_name}
						</option>
					))}
				</Select>
				<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
					<Checkbox name="is_primary" /> primary
				</label>
				<Button type="submit" size="sm">
					Invite
				</Button>
			</ActionForm>
		</Card>
	);
}

export function StaffApprovalsPanel({ programId, approvals }: { programId: string; approvals: StaffApprovalRow[] }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Client approvals</h2>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700">
				{approvals.map((a) => (
					<li key={a.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
						<span>
							<span className="text-slate-800 dark:text-slate-200">{a.title}</span>
							<span className="block text-2xs text-slate-500">
								sent {a.requested_at.slice(0, 10)}
								{a.due_at ? ` · silent approval ${a.due_at.slice(0, 10)}` : ''}
								{a.reminder_1_at ? ' · reminded' : ''}
								{a.escalated_at ? ' · escalated' : ''}
								{a.decided_at ? ` · ${a.status.replace('_', ' ')} ${a.decided_at.slice(0, 10)} by ${a.decided_by_label ?? ''}` : ''}
								{a.client_comment ? ` · “${a.client_comment.slice(0, 120)}”` : ''}
							</span>
						</span>
						<span className="flex items-center gap-1">
							<Badge color={a.status === 'pending' ? 'warning' : a.status === 'changes_requested' ? 'danger' : a.status === 'withdrawn' ? 'default' : 'success'}>{a.status.replace('_', ' ')}</Badge>
							{a.status === 'pending' && (
								<ActionForm action={withdrawApproval} success="Withdrawn.">
									<input type="hidden" name="id" value={a.id} />
									<input type="hidden" name="program_id" value={programId} />
									<Button type="submit" size="sm" variant="ghost">
										Withdraw
									</Button>
								</ActionForm>
							)}
						</span>
					</li>
				))}
				{approvals.length === 0 && <li className="py-2 text-xs text-slate-500">Nothing sent for approval yet (a plan or page set to “awaiting client” opens one).</li>}
			</ul>
		</Card>
	);
}

export function StaffNotesPanel({ notes, programId, title = 'Client requests & ideas' }: { notes: StaffNoteRow[]; programId?: string | null; title?: string }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h2>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700">
				{notes.map((n) => (
					<li key={n.id} className="py-2">
						<div className="flex items-center justify-between gap-2 text-xs">
							<span>
								{n.client_name && <span className="font-medium text-slate-900 dark:text-slate-100">{n.client_name} · </span>}
								<span className="text-slate-800 dark:text-slate-200">{n.title}</span>
								<span className="text-2xs text-slate-500 ml-2">
									{n.kind.replace('_', ' ')} · {n.created_at.slice(0, 10)} · {n.created_by_label?.replace('client:', '') ?? ''}
								</span>
							</span>
							<Badge color={n.status === 'done' ? 'success' : n.status === 'declined' ? 'default' : n.status === 'open' ? 'warning' : 'primary'}>{n.status.replace('_', ' ')}</Badge>
						</div>
						{n.body_md && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{n.body_md}</p>}
						{Object.keys(n.meta ?? {}).length > 0 && <p className="text-2xs text-slate-500">{Object.entries(n.meta).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>}
						<ActionForm action={replyNote} success="Saved." className="mt-1.5 grid gap-1.5 md:grid-cols-[1fr_1fr_140px_auto]">
							<input type="hidden" name="id" value={n.id} />
							{(programId ?? n.program_id) && <input type="hidden" name="program_id" value={programId ?? n.program_id ?? ''} />}
							<Input name="reply_md" placeholder="Reply (the client sees this)" defaultValue={n.reply_md ?? ''} />
							<Input name="internal_note" placeholder="Internal note (never shown)" defaultValue={n.internal_note ?? ''} />
							<Select name="status" size="sm" defaultValue={n.status}>
								{['open', 'acknowledged', 'in_progress', 'done', 'declined'].map((s) => (
									<option key={s} value={s}>
										{s.replace('_', ' ')}
									</option>
								))}
							</Select>
							<Button type="submit" size="sm" variant="outline">
								Save
							</Button>
						</ActionForm>
					</li>
				))}
				{notes.length === 0 && <li className="py-2 text-xs text-slate-500">Nothing from the client yet.</li>}
			</ul>
		</Card>
	);
}

export function GoogleStatusPanel({ clientId, programId, conn }: { clientId: string; programId: string | null; conn: { status: string; google_email: string | null; ga4_property_name: string | null; sc_site_url: string | null; last_pull_at: string | null; last_error: string | null } | null }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Google connection</h2>
			{!conn || conn.status !== 'connected' ? (
				<p className="text-xs text-slate-500">Not connected. The client connects on their portal (Connections tab), or invites the Open Ronin Google account as a viewer. Never passwords.</p>
			) : (
				<>
					<p className="text-xs text-slate-700 dark:text-slate-300">
						{conn.google_email} · GA4 {conn.ga4_property_name ?? '—'} · Search Console {conn.sc_site_url ?? '—'} · last pull {conn.last_pull_at?.slice(0, 10) ?? 'never'}
					</p>
					{conn.last_error && <p className="text-2xs text-red-600">{conn.last_error}</p>}
					<ActionForm action={pullGoogleNow} success="Pulled the last 28 days." className="mt-2">
						<input type="hidden" name="client_id" value={clientId} />
						{programId && <input type="hidden" name="program_id" value={programId} />}
						<Button type="submit" size="sm" variant="outline">
							Pull now
						</Button>
					</ActionForm>
				</>
			)}
		</Card>
	);
}
