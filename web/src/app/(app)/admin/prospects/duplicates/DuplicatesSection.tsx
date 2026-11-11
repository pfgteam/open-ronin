'use client';

// Duplicates queue (spec 2026-10-19 §11). Merging deletes a person, so both
// directions go through ConfirmAction naming who stays and what moves.
// "Not a duplicate" is immediate. Every decision needs manage_revenue
// (enforced in decideDuplicate).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { decideDuplicate } from '@/app/(app)/prospects/actions';
import type { PersonRow } from '@/lib/revenue/shared';
import ConfirmAction from '@/components/ui/ConfirmAction';
import SettingsSection from '../_ui/SettingsSection';

type Side = { person: PersonRow; deals: number; activities: number } | null;
export type Candidate = { id: string; matchOn: string; confidence: number; keepId: string; dropId: string; keep: Side; drop: Side };

const MATCH_LABEL: Record<string, string> = { name: 'Same name', email: 'Same email', phone: 'Same phone', linkedin: 'Same LinkedIn' };

function SideView({ s, label }: { s: Side; label: string }) {
	if (!s) return <div className="text-xs text-slate-500">{label}: no longer exists</div>;
	const p = s.person;
	return (
		<div className="min-w-0 space-y-0.5 text-sm">
			<p className="text-2xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
			<Link href={`/prospects/people/${p.id}`} className="font-semibold text-slate-900 hover:underline dark:text-slate-100">{p.display_name}</Link>
			<p className="truncate text-xs text-slate-600 dark:text-slate-400">{[p.title, p.email, p.phone].filter(Boolean).join(' · ') || 'No channels'}</p>
			<p className="text-xs tabular-nums text-slate-500">{s.deals} deal{s.deals === 1 ? '' : 's'} · {s.activities} activit{s.activities === 1 ? 'y' : 'ies'}</p>
		</div>
	);
}

function decision(c: Candidate, kind: 'merge' | 'merge_swap' | 'dismiss') {
	const fd = new FormData();
	fd.set('id', c.id);
	fd.set('decision', kind);
	fd.set('keep_id', c.keepId);
	fd.set('drop_id', c.dropId);
	return decideDuplicate(fd);
}

export default function DuplicatesSection({ candidates, total, page, size, canManage, error }: { candidates: Candidate[]; total: number; page: number; size: number; canManage: boolean; error: string | null }) {
	const router = useRouter();
	const { toast } = useToast();
	const [pending, start] = useTransition();
	return (
		<SettingsSection title="Duplicates" description={`${total.toLocaleString()} open · people an intake matched only by name; nothing merges without someone deciding`} padded={false}>
			{error && <Callout tone="error" className="m-4">{error}</Callout>}
			{!canManage && total > 0 && <Callout tone="info" className="m-4">You can review the queue; deciding needs the Configure the Revenue Engine capability.</Callout>}
			{candidates.length === 0 ? (
				<p className="px-4 py-6 text-sm text-slate-500">The queue is empty.</p>
			) : (
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{candidates.map((c) => {
						const both = !!c.keep && !!c.drop;
						const keepName = c.keep?.person.display_name ?? 'the existing person';
						const dropName = c.drop?.person.display_name ?? 'the new person';
						return (
							<li key={c.id} className="space-y-3 px-4 py-3">
								<p className="text-xs text-slate-500">{MATCH_LABEL[c.matchOn] ?? 'Possible match'} · {Math.round(c.confidence * 100)}% confidence</p>
								<div className="grid gap-4 sm:grid-cols-2">
									<SideView s={c.keep} label="Existing" />
									<SideView s={c.drop} label="New" />
								</div>
								{canManage && (
									<div className="flex flex-wrap gap-2">
										<ConfirmAction size="sm" variant="primary" disabled={!both} label="Merge new into existing…" title={`Keep ${keepName}?`} confirmLabel="Merge"
											impact={<p>{dropName}&apos;s deals, activities, tasks and brand links move to <b>{keepName}</b>, their channels are folded in, and {dropName} is deleted. This cannot be undone.</p>}
											onConfirm={async () => { const r = await decision(c, 'merge'); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: `Merged into ${keepName}` } : r; }} />
										<ConfirmAction size="sm" variant="secondary" disabled={!both} label="Merge existing into new…" title={`Keep ${dropName}?`} confirmLabel="Merge"
											impact={<p>{keepName}&apos;s deals, activities, tasks and brand links move to <b>{dropName}</b>, their channels are folded in, and {keepName} is deleted. This cannot be undone.</p>}
											onConfirm={async () => { const r = await decision(c, 'merge_swap'); if (r.ok) router.refresh(); return r.ok ? { ok: true, message: `Merged into ${dropName}` } : r; }} />
										<Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => {
											const r = await decision(c, 'dismiss');
											toast(r.ok ? { message: 'Marked as not a duplicate', variant: 'success' } : { message: r.error, variant: 'error' });
											if (r.ok) router.refresh();
										})}>Not a duplicate</Button>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{total > size && <Pagination page={page} size={size} total={total} hrefFor={(p) => `/admin/prospects/duplicates?page=${p}`} />}
		</SettingsSection>
	);
}
