'use client';

// Calls tab on the deal page (0125): list of calls with brief / summary /
// next steps / follow-up draft / rubric score / action items; add a call
// (scheduled, Zoom meeting id, or a pasted transcript); generate the
// pre-call brief. Since spec 2026-10-20 the brief and the intel sit in the left
// column, the calls on the right, and each button has its own pending state.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { formatDate, formatRelative } from '@/lib/format';
import { BriefMarkdown } from '@/lib/revenue/briefMarkdown';
import type { ActionItemRow, BriefRow, CallRow } from '@/lib/revenue/server';
import type { BrandRow, PersonRow } from '@/lib/revenue/shared';
import { IntelTab } from './ProfileTabs';
import { usePendingKey } from './usePendingKey';
import { addCall, applySuggestedStage, decideActionItem, generateBrief, pullRecording, runCallAnalysis } from '../../callActions';

type Msg = { ok: boolean; text: string } | null;

export default function CallsTab({ dealId, personId, calls, items, briefs, staff, zoom, aiReady, brand, person }: { dealId: string; personId: string | null; calls: CallRow[]; items: ActionItemRow[]; briefs: BriefRow[]; staff: Record<string, string>; zoom: boolean; aiReady: boolean; brand: BrandRow | null; person: PersonRow | null }) {
	const router = useRouter();
	const [msg, setMsg] = useState<Msg>(null);
	const [showAdd, setShowAdd] = useState(false);
	const { isPending, run: runKey } = usePendingKey();
	const latestBrief = briefs[0] ?? null;
	const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
		runKey(key, async () => {
			setMsg(null);
			const r = await fn();
			setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error ?? 'Failed.' });
			router.refresh();
		});

	return (
		<div className="space-y-4">
			{!aiReady && <Callout tone="warning">No text provider configured: briefs and call analysis need ANTHROPIC_API_KEY or OPENAI_API_KEY (Admin → Providers). Calls and transcripts still save.</Callout>}
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}

			<div className="grid gap-4 lg:grid-cols-3">
			<div className="space-y-4 lg:col-span-1">
			{/* Brief */}
			<Card className="space-y-2">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pre-call brief</h2>
					<Button size="sm" variant="outline" loading={isPending('brief')} disabled={!aiReady} onClick={() => run('brief', () => generateBrief({ deal_id: dealId }), 'Brief generated.')}>
						<Sparkles className="w-3.5 h-3.5" /> {latestBrief ? 'Regenerate' : 'Generate brief'}
					</Button>
				</div>
				{latestBrief ? (
					<>
						<div className="text-2xs text-slate-500">
							{formatRelative(latestBrief.created_at)} · {latestBrief.analyzer ?? 'ai'}
							{latestBrief.for_user_id && staff[latestBrief.for_user_id] ? ` · for ${staff[latestBrief.for_user_id]}` : ''}
						</div>
						<BriefMarkdown md={latestBrief.body_md} />
					</>
				) : (
					<p className="text-xs text-slate-500">Who they are, the brand, fit and heat, prior touches, likely objections, the suggested package and questions to ask — generated before every booked call (cron, 24 h ahead) or on demand here.</p>
				)}
			</Card>

			<IntelTab brand={brand} person={person} />
			</div>
			<div className="space-y-4 lg:col-span-2">
			{/* Calls */}
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Calls</h2>
				<Button size="sm" variant={showAdd ? 'ghost' : 'primary'} onClick={() => setShowAdd(!showAdd)}>
					{showAdd ? 'Close' : '+ Add call'}
				</Button>
			</div>
			{showAdd && (
				<Card>
					<form
						className="grid sm:grid-cols-3 gap-3"
						action={(fd) =>
							runKey('add', async () => {
								setMsg(null);
								const r = await addCall(fd);
								setMsg(r.ok ? { ok: true, text: 'Call added.' } : { ok: false, text: r.error });
								if (r.ok) setShowAdd(false);
								router.refresh();
							})
						}
					>
						<input type="hidden" name="deal_id" value={dealId} />
						{personId && <input type="hidden" name="person_id" value={personId} />}
						<Select name="call_kind" label="Kind" defaultValue="discovery">
							<option value="triage">Triage (setter)</option>
							<option value="discovery">Discovery (call 1)</option>
							<option value="closing">Closing (call 2)</option>
							<option value="other">Other</option>
						</Select>
						<Select name="source" label="Source" defaultValue={zoom ? 'zoom' : 'manual'}>
							<option value="zoom">Zoom</option>
							<option value="ghl">GHL phone</option>
							<option value="manual">Manual</option>
							<option value="upload">Upload / paste</option>
						</Select>
						<Input name="external_id" label="Zoom meeting id / GHL call id" autoComplete="off" />
						<Input name="scheduled_at" label="Scheduled for" type="datetime-local" />
						<Input name="occurred_at" label="Happened at (if past)" type="datetime-local" />
						<Input name="recording_url" label="Recording link" autoComplete="off" />
						<Textarea name="transcript_md" label="Transcript (paste; analysis runs on it)" rows={5} className="sm:col-span-3" />
						<div className="sm:col-span-3">
							<Button type="submit" size="sm" loading={isPending('add')}>
								Save call
							</Button>
						</div>
					</form>
				</Card>
			)}
			{calls.length === 0 && <p className="text-xs text-slate-500">No calls yet. Zoom calls with a meeting id get their recording + transcript pulled automatically 30 minutes after the scheduled time; a pasted transcript is analyzed on the next cron tick or with the button.</p>}
			{calls.map((c) => {
				const myItems = items.filter((i) => i.call_id === c.id);
				const crit = (c.score_breakdown?.criteria ?? []) as { name: string; weight: number; score: number; note: string }[];
				return (
					<Card key={c.id} className="space-y-3">
						<div className="flex flex-wrap items-center gap-2">
							<Badge color={c.status === 'analyzed' ? 'success' : c.status === 'scheduled' ? 'primary' : c.status === 'no_show' ? 'danger' : 'default'}>{c.status}</Badge>
							<span className="text-sm font-medium text-slate-900 dark:text-slate-100 capitalize">{c.call_kind} call</span>
							<span className="text-xs text-slate-500">
								{c.source}
								{c.occurred_at ? ` · ${formatDate(c.occurred_at, 'MMM d, HH:mm')}` : c.scheduled_at ? ` · scheduled ${formatRelative(c.scheduled_at)}` : ''}
								{c.owner_id && staff[c.owner_id] ? ` · ${staff[c.owner_id]}` : ''}
								{c.duration_sec ? ` · ${Math.round(c.duration_sec / 60)} min` : ''}
							</span>
							{c.score != null && (
								<Badge color={c.score >= 80 ? 'success' : c.score >= 60 ? 'default' : 'warning'} className="ml-auto">
									{c.score}/100
								</Badge>
							)}
							<div className="flex items-center gap-1 ml-auto">
								{c.recording_url && (
									<a href={c.recording_url} target="_blank" rel="noreferrer" className="text-xs text-primary-700 dark:text-primary-300 underline">
										Recording
									</a>
								)}
								{c.source === 'zoom' && c.external_id && c.status === 'scheduled' && zoom && (
									<Button size="sm" variant="ghost" loading={isPending(`pull:${c.id}`)} onClick={() => run(`pull:${c.id}`, () => pullRecording({ call_id: c.id, deal_id: dealId }), 'Recording pulled.')}>
										Pull recording
									</Button>
								)}
								{(c.transcript_md || c.session_call_id) && (
									<Button size="sm" variant="outline" loading={isPending(`analyze:${c.id}`)} disabled={!aiReady} onClick={() => run(`analyze:${c.id}`, () => runCallAnalysis({ call_id: c.id, deal_id: dealId }), 'Analyzed.')}>
										<Sparkles className="w-3.5 h-3.5" /> {c.analyzed_at ? 'Re-analyze' : 'Analyze'}
									</Button>
								)}
							</div>
						</div>
						{c.summary_md && (
							<div className="grid lg:grid-cols-2 gap-3">
								<div>
									<div className="text-2xs uppercase tracking-wide text-slate-500 mb-1">Summary</div>
									<BriefMarkdown md={c.summary_md} />
								</div>
								<div>
									<div className="text-2xs uppercase tracking-wide text-slate-500 mb-1">Next steps</div>
									<BriefMarkdown md={c.next_steps_md ?? ''} />
									{c.suggested_stage_slug && (
										<div className="mt-2 flex items-center gap-2 text-xs">
											<span className="text-slate-500">Suggested stage:</span>
											<Badge>{c.suggested_stage_slug}</Badge>
											<Button size="sm" variant="ghost" loading={isPending(`apply:${c.id}`)} onClick={() => run(`apply:${c.id}`, () => applySuggestedStage({ call_id: c.id, deal_id: dealId }), 'Stage applied.')}>
												Apply
											</Button>
										</div>
									)}
								</div>
							</div>
						)}
						{myItems.length > 0 && (
							<div>
								<div className="text-2xs uppercase tracking-wide text-slate-500 mb-1">Action items</div>
								<ul className="space-y-1">
									{myItems.map((i) => (
										<li key={i.id} className="flex items-center gap-2 text-xs">
											<Badge color={i.status === 'accepted' ? 'success' : i.status === 'dismissed' ? 'default' : 'warning'}>{i.status}</Badge>
											<span className="text-slate-800 dark:text-slate-200">{i.title}</span>
											<span className="text-slate-500">
												{i.owner_id && staff[i.owner_id] ? staff[i.owner_id] : 'unassigned'}
												{i.due_at ? ` · due ${formatRelative(i.due_at)}` : ''}
											</span>
											{i.status === 'suggested' && (
												<span className="ml-auto flex gap-1">
													<Button size="sm" loading={isPending(`item:${i.id}`)} onClick={() => run(`item:${i.id}`, () => decideActionItem({ id: i.id, deal_id: dealId, decision: 'accept' }), 'Added to to-dos.')}>
														Accept
													</Button>
													<Button size="sm" variant="ghost" loading={isPending(`item:${i.id}`)} onClick={() => run(`item:${i.id}`, () => decideActionItem({ id: i.id, deal_id: dealId, decision: 'dismiss' }), 'Dismissed.')}>
														Dismiss
													</Button>
												</span>
											)}
										</li>
									))}
								</ul>
							</div>
						)}
						{c.follow_up_draft_md && (
							<details className="text-xs">
								<summary className="cursor-pointer text-primary-700 dark:text-primary-300">Follow-up draft</summary>
								<div className="mt-2 rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-3">
									<BriefMarkdown md={c.follow_up_draft_md} />
								</div>
							</details>
						)}
						{crit.length > 0 && (
							<details className="text-xs">
								<summary className="cursor-pointer text-primary-700 dark:text-primary-300">Rubric breakdown ({c.score_breakdown?.rubric ?? c.rubric_key})</summary>
								<table className="mt-2 w-full">
									<tbody>
										{crit.map((k) => (
											<tr key={k.name} className="border-b border-slate-100 dark:border-slate-700/60">
												<td className="py-1 pr-2 text-slate-800 dark:text-slate-200">{k.name}</td>
												<td className="py-1 pr-2 tabular-nums text-right">{k.score}/5</td>
												<td className="py-1 pr-2 tabular-nums text-right text-slate-500">w{k.weight}</td>
												<td className="py-1 text-slate-500">{k.note}</td>
											</tr>
										))}
									</tbody>
								</table>
							</details>
						)}
						{c.transcript_md && (
							<details className="text-xs">
								<summary className="cursor-pointer text-slate-500">Transcript</summary>
								<pre className="mt-2 whitespace-pre-wrap text-2xs text-slate-600 dark:text-slate-400 max-h-80 overflow-y-auto">{c.transcript_md.slice(0, 20000)}</pre>
							</details>
						)}
					</Card>
				);
			})}
			</div>
			</div>
		</div>
	);
}
