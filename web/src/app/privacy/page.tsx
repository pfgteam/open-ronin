// Public privacy policy (no auth; listed in PUBLIC_ROUTES in
// lib/supabase/middleware.ts). A template: the organisation name and contact
// come from org_settings. Have your own counsel review it before you rely on it.

import Link from 'next/link';
import { getOrgSettings } from '@/lib/tenant/server';

export const metadata = { title: 'Privacy policy' };
export const revalidate = 600;

export default async function PrivacyPage() {
	const org = await getOrgSettings();
	const name = org.org_name;
	const contact = org.support_email ?? org.owner_email;
	return (
		<main className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4">
			<article className="prose prose-slate dark:prose-invert max-w-2xl mx-auto">
				<h1>Privacy policy</h1>
				<p>
					This workspace is run by <strong>{name}</strong> on Open Ronin, an internal operations platform. This page explains what data the workspace
					holds and why.
				</p>
				<h2>Who uses it</h2>
				<p>
					Accounts are limited to {name} staff (by email domain) and, where {name} turns it on, client portal users invited by {name}.
				</p>
				<h2>What we store</h2>
				<ul>
					<li>Account data: name, work email, role, profile details you add.</li>
					<li>Work data: projects, tasks, comments, files and the client records {name} manages.</li>
					<li>Messages and call notes from channels {name} connects (for example email, calendar or chat), only for the accounts that connect them.</li>
					<li>Technical logs needed to keep the service secure and working.</li>
				</ul>
				<h2>How it is used</h2>
				<p>
					Only to run {name}&apos;s work: planning, delivery, reporting and communication with clients. Data is not sold. AI features, when enabled,
					send the minimum needed text to the configured AI provider under spend limits set by an admin.
				</p>
				<h2>Where it lives</h2>
				<p>
					In the database and file storage {name} chose when installing Open Ronin, and with the integration providers {name} connected. Each provider
					handles data under its own terms.
				</p>
				<h2>Your choices</h2>
				<p>
					Ask {name} to see, correct, export or delete your data
					{contact ? (
						<>
							{' '}
							at <a href={`mailto:${contact}`}>{contact}</a>
						</>
					) : null}
					. Disconnecting an integration stops new data from it.
				</p>
				<p>
					<Link href="/terms">Terms of service</Link>
				</p>
			</article>
		</main>
	);
}
