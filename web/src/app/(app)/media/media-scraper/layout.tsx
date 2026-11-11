// Capability gate for /media/media-scraper (0102).
//
// Same shape as ../lead-scraper/layout.tsx and for the same reason: /media is
// open to every role, so the module gate above restricts nothing here. The
// gate is the review_media_records capability (admin/exec hold it implicitly,
// run_scrapers grantees pass it too — can_review_media_records() in SQL is
// the boundary, this is the honest refusal).

import Card from '@/components/ui/Card';
import { hasCapability } from '@/lib/permissions/capabilities';

export default async function Layout({ children }: { children: React.ReactNode }) {
	const [media, leads] = await Promise.all([hasCapability('review_media_records'), hasCapability('run_scrapers')]);
	if (!media && !leads) {
		return (
			<Card className="max-w-lg">
				<h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Media Scraper</h1>
				<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
					You do not have access to the Media Scraper. It queues journalist and outlet scrapes and
					approves them into Contacts, so access is granted person by person rather than by role.
				</p>
				<p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
					If you need it for your work, ask an admin — access is managed in Admin → Capabilities
					(&quot;Run and review the Media Scraper&quot;).
				</p>
			</Card>
		);
	}
	return <>{children}</>;
}
