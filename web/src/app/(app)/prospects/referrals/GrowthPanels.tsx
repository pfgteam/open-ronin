'use client';

// Panels for /prospects/referrals: codes (mint link), referrals + payouts,
// feedback requests (mint link), reviews (status / collect).

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { formatDate, formatRelative } from '@/lib/format';
import type { FeedbackRow, PayoutRow, ReferralCodeRow, ReferralRow, ReviewRow } from '@/lib/revenue/server';
import { formatCents, type StaffOption } from '@/lib/revenue/shared';
import { createReferralCode, markPayout, mintFeedbackLink, saveReview } from '../growthActions';

type Msg = { ok: boolean; text: string } | null;

export default function GrowthPanels({ codes, referrals, payouts, feedback, reviews, staff, viewerId, canManage }: { codes: ReferralCodeRow[]; referrals: ReferralRow[]; payouts: PayoutRow[]; feedback: FeedbackRow[]; reviews: ReviewRow[]; staff: Record<string, string>; staffList: StaffOption[]; viewerId: string; canManage: boolean }) {
	const router = useRouter();
	const [msg, setMsg] = useState<Msg>(null);
	const [pending, start] = useTransition();
	const run = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, ok: (r: Record<string, unknown>) => string) =>
		start(async () => {
			setMsg(null);
			const r = await fn();
			setMsg(r.ok ? { ok: true, text: ok(r) } : { ok: false, text: r.error ?? 'Failed.' });
			router.refresh();
		});
	const payoutsByRef = new Map<string, PayoutRow[]>();
	for (const p of payouts) payoutsByRef.set(p.referral_id, [...(payoutsByRef.get(p.referral_id) ?? []), p]);

	return (
		<div className="space-y-4">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}

			{/* codes */}
			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Referral links</h2>
				<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
					{codes.map((c) => (
						<div key={c.code} className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs">
							<div className="flex items-center gap-2">
								<code className="font-semibold text-slate-900 dark:text-slate-100">{c.code}</code>
								<Badge color={c.kind === 'client' ? 'success' : c.kind === 'staff' ? 'default' : 'accent'}>{c.kind.replace('_', ' ')}</Badge>
								<span className="ml-auto text-slate-500">{c.uses} use{c.uses === 1 ? '' : 's'}</span>
							</div>
							<div className="text-slate-600 dark:text-slate-400 truncate">{c.referrer_name ?? c.referrer_email ?? '—'}</div>
							<div className="text-2xs text-slate-500 truncate">/refer/{c.code}</div>
						</div>
					))}
					{codes.length === 0 && <p className="text-xs text-slate-500">No referral links yet.</p>}
				</div>
				<form
					className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700"
					action={(fd) => run(() => createReferralCode(fd), (r) => `Link: ${r.url}`)}
				>
					<Input name="referrer_name" label="Referrer name" className="w-44" placeholder="Affiliate / client / person" />
					<Input name="referrer_email" label="Email" type="email" className="w-56" />
					<Select name="kind" label="Kind" size="sm" className="w-32" defaultValue="non_client">
						<option value="non_client">Non-client</option>
						<option value="client">Client</option>
						<option value="staff">Staff</option>
					</Select>
					<Input name="code" label="Code (optional)" className="w-32" placeholder="AMY2026" />
					<Button type="submit" size="sm" loading={pending}>
						Mint link
					</Button>
				</form>
			</Card>

			{/* referrals + payouts */}
			<Card padding="none" className="overflow-hidden">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">Referrals and commissions</div>
				{referrals.length === 0 ? (
					<p className="px-4 py-6 text-sm text-slate-500">No referrals yet. A lead that arrives through /refer/&lt;code&gt;, or a deal with a code attached, shows here.</p>
				) : (
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{referrals.map((r) => {
							const ps = payoutsByRef.get(r.id) ?? [];
							return (
								<li key={r.id} className="px-4 py-3 text-xs space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<Badge color={r.status === 'closed' ? 'success' : r.status === 'lost' ? 'danger' : r.status === 'call_reached' ? 'warning' : 'default'}>{r.status.replace('_', ' ')}</Badge>
										<span className="font-medium text-slate-900 dark:text-slate-100">{r.referrer_name ?? r.code ?? 'referrer'}</span>
										<span className="text-slate-500">→</span>
										{r.deal_id ? (
											<Link href={`/prospects/deals/${r.deal_id}`} className="text-primary-700 dark:text-primary-300 hover:underline">
												{r.deal_title ?? 'deal'}
											</Link>
										) : (
											<span>{r.deal_title ?? '—'}</span>
										)}
										<span className="text-slate-500 ml-auto">{formatRelative(r.created_at)}</span>
									</div>
									{ps.length > 0 && (
										<div className="flex flex-wrap gap-1.5">
											{ps.map((p) => (
												<span key={p.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-1.5 py-0.5">
													<Badge color={p.status === 'paid' ? 'success' : p.status === 'void' ? 'default' : 'warning'}>{p.status}</Badge>
													<span className="tabular-nums">{formatCents(p.amount_cents)}</span>
													<span className="text-slate-500">{p.kind === 'intro_bonus' ? 'intro' : p.period_month ? formatDate(p.period_month, 'MMM yyyy') : p.kind}</span>
													{canManage && p.status === 'due' && (
														<button type="button" className="text-primary-700 dark:text-primary-300 underline" onClick={() => run(() => markPayout({ id: p.id, status: 'paid' }), () => 'Marked paid.')}>
															pay
														</button>
													)}
												</span>
											))}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				{/* feedback */}
				<Card padding="none" className="overflow-hidden">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">Feedback</div>
					{feedback.length === 0 ? (
						<p className="px-4 py-6 text-sm text-slate-500">Feedback requests appear after a call is recorded and when a contract is signed.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{feedback.slice(0, 40).map((f) => {
								const mine = f.subject_user_id === viewerId;
								return (
									<li key={f.id} className="px-4 py-2 text-xs flex flex-wrap items-center gap-2">
										<Badge>{f.kind}</Badge>
										<span className="text-slate-700 dark:text-slate-300">{f.subject_user_id ? staff[f.subject_user_id] ?? '—' : f.deal_title ?? '—'}</span>
										{f.submitted_at ? (
											<>
												<Badge color={(f.rating ?? 0) >= 4 ? 'success' : (f.rating ?? 0) >= 3 ? 'default' : 'danger'}>{f.rating ?? '—'}/5</Badge>
												{(mine || canManage) && f.comment && <span className="text-slate-600 dark:text-slate-400 truncate max-w-xs">“{f.comment}”</span>}
												<span className="ml-auto text-slate-500">{formatRelative(f.submitted_at)}</span>
											</>
										) : (
											<>
												<span className="text-slate-500">requested {f.requested_at ? formatRelative(f.requested_at) : ''}</span>
												<Button size="sm" variant="ghost" className="ml-auto" loading={pending} onClick={() => run(() => mintFeedbackLink({ id: f.id }), (r) => `Feedback link: ${r.url}`)}>
													Get link
												</Button>
											</>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</Card>

				{/* reviews */}
				<Card padding="none" className="overflow-hidden">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">Reviews</div>
					{reviews.length === 0 ? (
						<p className="px-4 py-6 text-sm text-slate-500">A review request is filed when a contract is signed; add first-placement / 90-day ones from the client.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{reviews.slice(0, 40).map((r) => (
								<li key={r.id} className="px-4 py-2 text-xs">
									<form className="flex flex-wrap items-center gap-2" action={(fd) => run(() => saveReview(fd), () => 'Review saved.')}>
										<input type="hidden" name="id" value={r.id} />
										<Badge color={r.status === 'collected' ? 'success' : r.status === 'declined' || r.status === 'void' ? 'danger' : 'default'}>{r.status}</Badge>
										<span className="text-slate-700 dark:text-slate-300">{r.client_name ?? r.deal_title ?? '—'}</span>
										<Badge>{r.milestone.replace('_', ' ')}</Badge>
										{r.status === 'collected' ? (
											<span className="text-slate-600 dark:text-slate-400">
												{r.platform} {r.rating ? `· ${r.rating}/5` : ''} {r.quote ? `· “${r.quote.slice(0, 80)}”` : ''}
											</span>
										) : (
											<>
												<select name="status" defaultValue="collected" className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-xs" aria-label="Status">
													<option value="collected">Collected</option>
													<option value="reminded">Reminded</option>
													<option value="declined">Declined</option>
												</select>
												<input name="platform" placeholder="google" className="w-20 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-xs" aria-label="Platform" />
												<input name="rating" type="number" min={1} max={5} placeholder="5" className="w-12 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-xs" aria-label="Rating" />
												<input name="url" placeholder="https://" className="w-36 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-xs" aria-label="URL" />
												<Button type="submit" size="sm" variant="ghost" loading={pending}>
													Save
												</Button>
											</>
										)}
									</form>
								</li>
							))}
						</ul>
					)}
				</Card>
			</div>
		</div>
	);
}
