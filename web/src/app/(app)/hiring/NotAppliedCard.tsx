// Shown on every /hiring page while 0128 is not applied (local DBs); the
// not-applied convention every module in the app follows.

import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';

export default function NotAppliedCard() {
	return (
		<>
			<PageHeader title="Hiring" description="Talent Engine" />
			<Callout tone="warning">
				The Hiring tables are not in this database yet. Apply migration <code>0128_hiring_h1_foundations.sql</code>.
			</Callout>
		</>
	);
}
