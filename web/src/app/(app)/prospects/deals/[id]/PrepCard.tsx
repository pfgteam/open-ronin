'use client';

// Prep (spec 2026-10-20 §4.1): the first lines of the latest pre-call brief,
// with the full brief one click away on Calls.

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { BriefMarkdown } from '@/lib/revenue/briefMarkdown';
import { briefExcerpt } from '@/lib/revenue/dealPage';
import type { BriefRow } from '@/lib/revenue/server';
import { generateBrief } from '../../callActions';

export default function PrepCard({ dealId, brief, aiReady }: { dealId: string; brief: BriefRow | null; aiReady: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const [pending, start] = useTransition();
	const generate = () =>
		start(async () => {
			const r = await generateBrief({ deal_id: dealId });
			if (!r.ok) {
				toast({ message: r.error ?? 'Could not generate the brief.', variant: 'error' });
				return;
			}
			toast({ message: 'Brief generated', variant: 'success' });
			router.refresh();
		});
	return (
		<Card className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Prep</h2>
				<div className="flex items-center gap-2">
					{brief && <Link href={`/prospects/deals/${dealId}?tab=calls`} className="text-2xs text-primary-700 hover:underline dark:text-primary-300">Full brief →</Link>}
					<Button size="sm" variant="outline" loading={pending} disabled={!aiReady} onClick={generate}>
						<Sparkles className="h-3.5 w-3.5" /> {brief ? 'Regenerate' : 'Generate brief'}
					</Button>
				</div>
			</div>
			{brief ? (
				<>
					<BriefMarkdown md={briefExcerpt(brief.body_md)} />
					<p className="text-2xs text-slate-500">Generated {formatRelative(brief.created_at)}</p>
				</>
			) : (
				<p className="text-xs text-slate-500">No brief yet. {aiReady ? 'Generate one before the call.' : 'Briefs need a text provider (Admin → Providers).'}</p>
			)}
		</Card>
	);
}
