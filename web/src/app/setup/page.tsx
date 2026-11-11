// /setup — the first-run wizard. Outside the (app) group on purpose: the app
// shell redirects here until org_settings.setup_completed_at is set, so this
// page must not sit behind that gate itself.
//
// Prefills from open-ronin.config.yaml when the install left one in the repo
// root (INSTALL.md Step 0), otherwise starts from a blank config.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuthProfile, getAuthUser, createClient } from '@/lib/supabase/server';
import { readConfigFile } from '@/lib/tenant/server';
import { blankConfig, parseOrgConfig } from '@/lib/tenant/config';
import SetupWizard from './SetupWizard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up Open Ronin' };

export default async function SetupPage() {
	const user = await getAuthUser();
	if (!user) redirect('/auth/login?redirect=/setup');
	const profile = await getAuthProfile();

	const supabase = await createClient();
	const { data: state } = await supabase.rpc('setup_state');
	const st = (state ?? {}) as { has_admin?: boolean; setup_completed?: boolean };
	const isAdmin = profile?.role === 'admin' || profile?.role === 'exec';

	if (st.setup_completed && !isAdmin) redirect('/');
	if (st.has_admin && !isAdmin) {
		return (
			<main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
				<div className="max-w-md text-center space-y-2">
					<h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Setup is in progress</h1>
					<p className="text-sm text-slate-600 dark:text-slate-400">An admin is still setting up this workspace. Check back once they finish.</p>
				</div>
			</main>
		);
	}

	const file = readConfigFile();
	const fromFile = file ? parseOrgConfig(file.text) : null;
	const initial = fromFile?.ok ? fromFile.config : blankConfig();
	if (!fromFile?.ok && !initial.team.first_admin?.email && user.email) {
		initial.team.first_admin = { name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null, email: user.email };
	}

	return (
		<main className="min-h-screen bg-slate-50 dark:bg-slate-900 py-10 px-4">
			<div className="max-w-3xl mx-auto">
				<div className="flex items-center gap-3 mb-6">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src="/logo-mark.svg" alt="" className="w-9 h-9" />
					<div>
						<h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Set up Open Ronin</h1>
						<p className="text-sm text-slate-500 dark:text-slate-400">
							{st.setup_completed ? 'Setup is done. You can re-apply a changed config here.' : 'Five short steps. You can change everything later in Admin.'}
						</p>
					</div>
					{st.setup_completed && (
						<Link href="/" className="ml-auto text-sm text-primary-700 dark:text-primary-400 hover:underline">
							Back to the app
						</Link>
					)}
				</div>
				<SetupWizard
					initial={initial}
					source={fromFile?.ok ? { kind: 'file', path: file!.path } : fromFile && !fromFile.ok ? { kind: 'invalid', path: file!.path, errors: fromFile.errors } : { kind: 'blank' }}
					willClaimAdmin={!st.has_admin}
					userEmail={user.email ?? ''}
				/>
			</div>
		</main>
	);
}
