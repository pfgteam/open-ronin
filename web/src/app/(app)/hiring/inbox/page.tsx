// /hiring/inbox — the review queue for candidate messages (0132): every
// draft awaiting approval, approved-but-unsent (queued / failed), across
// roles. Approve, edit, send now, cancel. Nothing leaves without a person.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadHiringConfig, loadMessageQueue } from '@/lib/hiring/server';
import { emailConfigured } from '@/lib/hiring/comms';
import { formatRelative } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';
import InboxRow from './InboxRow';

export const metadata = { title: 'Message review · Hiring' };
export const dynamic = 'force-dynamic';

export default async function HiringInboxPage() {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const rows = await loadMessageQueue(supabase);
	const drafts = rows.filter((r) => r.status === 'draft');
	const queued = rows.filter((r) => r.status === 'approved');
	const failed = rows.filter((r) => r.status === 'failed');
	const { data: conn } = await supabase.from('ghl_connections').select('id').is('disconnected_at', null).limit(1);
	const senders = (config.settings.senders ?? {}) as { email?: string; sms_number?: string };
	return (
		<>
			<PageHeader title="Message review" description={`${drafts.length} drafts to review · ${queued.length} approved and queued · ${failed.length} failed`} />
			<Callout tone={emailConfigured() && (conn ?? []).length ? 'info' : 'warning'} className="mb-4">
				Senders: email from <code>{senders.email ?? 'careers@example.com'}</code> via Resend ({emailConfigured() ? 'key present' : 'RESEND_API_KEY missing — approved emails wait; copy and send by hand'}); SMS / WhatsApp from <code>{senders.sms_number ?? '(555) 010-0263'}</code> via the GHL Open Ronin sub-account ({(conn ?? []).length ? 'connected' : 'not connected — connect it in Admin → Connections'}). Approved messages send on the next 10-minute tick or with &quot;Approve + send now&quot;.
			</Callout>
			<Card padding="none">
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Nothing to review.</li>}
					{[...drafts, ...failed, ...queued].map((m) => (
						<li key={m.id} className="px-4 py-3 space-y-1.5">
							<div className="flex flex-wrap items-center gap-2 text-xs">
								<Badge color={m.status === 'approved' ? 'primary' : m.status === 'failed' ? 'danger' : 'warning'}>{m.status}</Badge>
								<Badge>{m.channel}</Badge>
								<span className="font-medium text-slate-900 dark:text-slate-100">{m.candidate_name}</span>
								{m.position_title && <span className="text-slate-500">· {m.position_title}</span>}
								<span className="text-slate-500">· to {m.to_address}</span>
								<span className="text-slate-500 ml-auto">{formatRelative(m.created_at)}</span>
								{m.application_id && m.position_id && (
									<Link href={`/hiring/positions/${m.position_id}/applications/${m.application_id}`} className="text-primary-600 hover:underline">
										open
									</Link>
								)}
							</div>
							{m.error && <p className="text-2xs text-red-600">{m.error}</p>}
							<InboxRow m={m} />
						</li>
					))}
				</ul>
			</Card>
		</>
	);
}
