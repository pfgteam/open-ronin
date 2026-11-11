'use client';

// "Who can sign in" line for the auth pages. Reads public.org_public_info()
// (anon-callable: org name, sign-in domains, support email; no secrets) so
// the text follows the setup wizard instead of being hardcoded.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface PublicOrg {
	org_name?: string;
	allowed_email_domains?: string[];
	support_email?: string | null;
	setup_completed?: boolean;
}

export function usePublicOrg(): PublicOrg | null {
	const [org, setOrg] = useState<PublicOrg | null>(null);
	useEffect(() => {
		let live = true;
		createClient()
			.rpc('org_public_info')
			.then(({ data }) => {
				if (live) setOrg((data ?? {}) as PublicOrg);
			});
		return () => {
			live = false;
		};
	}, []);
	return org;
}

export default function OrgDomainsNote({ prefix = 'Restricted to', help = true }: { prefix?: string; help?: boolean }) {
	const org = usePublicOrg();
	if (!org) return null;
	const domains = org.allowed_email_domains ?? [];
	return (
		<>
			{domains.length ? `${prefix} ${domains.map((d) => `@${d}`).join(', ')}` : org.setup_completed === false ? 'First sign-up sets up this workspace' : null}
			{help && org.support_email && (
				<>
					{' '}
					&middot;{' '}
					<a href={`mailto:${org.support_email}`} className="hover:underline">
						Get help
					</a>
				</>
			)}
		</>
	);
}
