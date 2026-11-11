// Shown on every /prospects/proof page while 0160 is not applied.

import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';

export default function ProofNotAppliedCard() {
	return (
		<>
			<PageHeader title="Proof Library" />
			<Callout tone="warning">
				The Proof Library isn&apos;t set up on this environment yet. Ask an admin.
				<details className="mt-1 text-xs">
					<summary className="cursor-pointer">Technical detail</summary>
					Migration <code>0160_proof_library.sql</code> is not applied in this database.
				</details>
			</Callout>
		</>
	);
}
