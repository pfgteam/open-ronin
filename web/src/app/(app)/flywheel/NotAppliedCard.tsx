// Shown on every /flywheel page while 0136 is not applied (local DBs).

import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';

export default function NotAppliedCard() {
	return (
		<>
			<PageHeader title="Flywheel" description="Delivery system" />
			<Callout tone="warning">
				The Flywheel tables are not in this database yet. Apply migration <code>0136_flywheel_f1_foundations.sql</code>.
			</Callout>
		</>
	);
}
