// Capability gate for /media/lead-scraper.
//
// The page used to live under /admin, where ModuleGate's `admin` check was the
// gate. It moved here so a grantee can use the scraper WITHOUT being handed
// billing, roles and tags along with it — but /media is open to every role in
// the matrix, so the module gate above no longer restricts this page at all.
// The capability is the only gate now, and it has to be checked here, in the
// layout, rather than in the page body: a layout wraps the export route and
// any page added under this path later, which a check inside page.tsx would
// silently miss.
//
// Server-side and RLS-backed. can_run_scrapers() (0055) enforces the same rule
// on every query, so this is the honest refusal, not the security boundary —
// without it a grantee-less user would get the page shell and empty tables,
// which reads as "the scraper is broken" rather than "you do not have access".

import Card from '@/components/ui/Card';
import { hasCapability } from '@/lib/permissions/capabilities';

export default async function Layout({ children }: { children: React.ReactNode }) {
	// Either scraper capability opens the route. Which TABS render inside is
	// decided per capability in page.tsx: an acquisitions-only grantee (0060)
	// sees only the Acquisitions mode, never the lead presets, and vice versa.
	const [leads, acquisitions] = await Promise.all([
		hasCapability('run_scrapers'),
		hasCapability('acquisitions'),
	]);
	const allowed = leads || acquisitions;

	if (!allowed) {
		return (
			<>
				<Card className="max-w-lg">
					<h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
						Lead Scraper
					</h1>
					<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
						You do not have access to the Lead Scraper. It queues scrapes and stores
						third-party contact details, so access is granted person by person rather
						than by role.
					</p>
					<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
						If you need it for your work, ask an admin — access is managed in Admin →
						Roles &amp; Permissions.
					</p>
				</Card>
			</>
		);
	}

	return <>{children}</>;
}
