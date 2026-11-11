'use client';

// Inline status switch on a Proof Library row (draft / ready / hidden).

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { PROOF_STATUSES, type ItemKind, type ProofStatus } from '@/lib/proof/shared';
import { setProofStatus } from './actions';

export default function RowStatus({ kind, id, status }: { kind: ItemKind; id: string; status: ProofStatus }) {
	const [pending, start] = useTransition();
	const router = useRouter();
	const { toast } = useToast();
	return (
		<Select
			size="sm"
			aria-label="Status"
			value={status}
			disabled={pending}
			onChange={(e) => {
				const next = e.target.value as ProofStatus;
				start(async () => {
					const res = await setProofStatus(kind, id, next);
					if (!res.ok) toast({ message: res.error, variant: 'error' });
					else router.refresh();
				});
			}}
		>
			{PROOF_STATUSES.map((s) => (
				<option key={s} value={s}>
					{s}
				</option>
			))}
		</Select>
	);
}
