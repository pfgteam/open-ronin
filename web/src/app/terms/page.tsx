// Public terms of service (no auth; listed in PUBLIC_ROUTES in
// lib/supabase/middleware.ts). A template: the organisation name and contact
// come from org_settings. Have your own counsel review it before you rely on it.

import Link from 'next/link';
import { getOrgSettings } from '@/lib/tenant/server';

export const metadata = { title: 'Terms of service' };
export const revalidate = 600;

export default async function TermsPage() {
	const org = await getOrgSettings();
	const name = org.org_name;
	const contact = org.support_email ?? org.owner_email;
	const domains = org.allowed_email_domains;
	return (
		<main className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4">
			<article className="prose prose-slate dark:prose-invert max-w-2xl mx-auto">
				<h1>Terms of service</h1>
				<p>
					This workspace is operated by <strong>{name}</strong> using Open Ronin, open-source software released into the public domain (Unlicense).
				</p>
				<h2>Access</h2>
				<p>
					Access is for {name} staff
					{domains.length ? <> with an {domains.map((d) => `@${d}`).join(' or ')} address</> : null} and for people {name} invites, such as client
					portal users. Keep your sign-in private and tell {name} if you think it was used by someone else.
				</p>
				<h2>Acceptable use</h2>
				<p>Use the workspace for {name}&apos;s work only. Do not upload anything you have no right to share, and do not try to reach data your role does not grant.</p>
				<h2>Your content</h2>
				<p>Content you add stays {name}&apos;s and its clients&apos;, under {name}&apos;s agreements with them.</p>
				<h2>No warranty</h2>
				<p>The software is provided as is, without warranty of any kind. {name} may change or end the service at any time.</p>
				<h2>Contact</h2>
				<p>
					{contact ? (
						<>
							Questions: <a href={`mailto:${contact}`}>{contact}</a>.{' '}
						</>
					) : null}
					See also the <Link href="/privacy">privacy policy</Link>.
				</p>
			</article>
		</main>
	);
}
