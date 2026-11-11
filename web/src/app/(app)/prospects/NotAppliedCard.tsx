// Shown on every /prospects page while 0121 is not applied. The migration is
// applied in production (2026-10-02); this stays for local DBs and for the
// not-applied convention every module in the app follows. Plain words first;
// the migration name sits behind "Technical detail" for whoever sets it up.

import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';

export default function NotAppliedCard() {
	return (
		<>
			<PageHeader title="Prospects" />
			<Callout tone="warning">
				Prospects isn&apos;t set up on this environment yet. Ask an admin.
				<details className="mt-1 text-xs">
					<summary className="cursor-pointer">Technical detail</summary>
					Migration <code>0121_revenue_engine_p1.sql</code> is not applied in this database.
				</details>
			</Callout>
		</>
	);
}
