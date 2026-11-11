'use client';

// The Log card on the deal page (spec 2026-10-20 §4.3): the shared log form in
// its extended mode, always open next to the timeline.

import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import LogForm from '@/components/prospects/LogForm';
import type { LogKind } from '@/lib/revenue/logPayload';
import type { DispositionRow } from '@/lib/revenue/shared';

const DEAL_KINDS: readonly LogKind[] = ['call', 'email', 'sms', 'dm', 'meeting', 'note'];

export default function DealLogCard({ dealId, personId, nextAction, nextActionAt, dispositions }: { dealId: string; personId: string | null; nextAction: string | null; nextActionAt: string | null; dispositions: DispositionRow[] }) {
	const router = useRouter();
	const { toast } = useToast();
	return (
		<Card className="space-y-3">
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Log</h2>
			<LogForm
				dealId={dealId}
				personId={personId}
				originalNext={nextAction}
				originalNextAt={nextActionAt}
				dispositions={dispositions}
				kinds={DEAL_KINDS}
				extended
				onDone={() => {
					toast({ message: 'Logged', variant: 'success' });
					router.refresh();
				}}
			/>
		</Card>
	);
}
