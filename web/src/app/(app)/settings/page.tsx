// /settings — Profile › Settings (sheet "Alex draft (original)", row 9).
// On screen, per the sheet: Light/Dark, Connections. Connections are the
// viewer's own accounts linked to Open Ronin (Google Calendar today, the same
// google_calendar_connections rows the calendar uses; RLS = own rows only).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import GoogleCalConnect from '../the-work/calendar/GoogleCalConnect';
import ThemeSetting from './ThemeSetting';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
	const user = await getAuthUser();
	if (!user) redirect('/auth/login?redirect=/settings');
	const supabase = await createClient();
	const { data: connections } = await supabase
		.from('google_calendar_connections')
		.select('id, google_account_email, last_synced_at, sync_status')
		.eq('user_id', user.id);

	return (
		<>
			<PageHeader title="Settings" />
			<div className="max-w-2xl space-y-4">
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Light/Dark</h2>
					<div className="mt-3">
						<ThemeSetting />
					</div>
				</Card>
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Connections</h2>
					{connections && connections.length > 0 ? (
						<ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
							{connections.map((c) => (
								<li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
									<span className="text-slate-700 dark:text-slate-300">
										Google Calendar · {c.google_account_email ?? 'connected'}
									</span>
									<span className="text-xs text-slate-500 dark:text-slate-400">
										{c.sync_status ?? 'connected'}
										{c.last_synced_at ? ` · synced ${new Date(c.last_synced_at).toLocaleString()}` : ''}
									</span>
								</li>
							))}
						</ul>
					) : (
						<div className="mt-3 flex items-center justify-between gap-3">
							<p className="text-sm text-slate-600 dark:text-slate-400">Google Calendar is not connected.</p>
							<GoogleCalConnect />
						</div>
					)}
					<p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
						Sync and disconnect live on the <Link href="/the-work/calendar" className="text-primary-700 hover:underline dark:text-primary-300">calendar</Link>.
					</p>
				</Card>
			</div>
		</>
	);
}
