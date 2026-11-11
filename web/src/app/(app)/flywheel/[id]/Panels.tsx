'use client';

// Program page panels (F1): status controls, team / lanes, facts, cluster
// (plan + page tracker), new cluster / video / deliverable forms.

import Link from 'next/link';
import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { CITATION_STATUS_LABELS, CLUSTER_STATUSES, CLUSTER_STATUS_LABELS, DELIVERABLE_STATUSES, DELIVERABLE_STATUS_LABELS, MEMBER_ROLE_LABELS, MEMBER_ROLE_OWNS, PAGE_STATUS_COLORS, PAGE_STATUS_LABELS, PLAN_STATUSES, PLAN_STATUS_COLORS, PLAN_STATUS_LABELS, PROGRAM_STATUSES, PROGRAM_STATUS_LABELS, SHIPPED_CITATION, clusterProgress, type ChannelRow, type CitationRow, type ClusterRow, type FactRow, type MemberRole, type MemberRow, type PageRow, type ProgramRow, type VideoRow } from '@/lib/flywheel/shared';
import ActionForm from '../ActionForm';
import { saveCluster, saveDeliverable, saveFact, saveVideo, scaffoldCluster, setMember, setProgramStatus } from '../actions';

export function StatusControls({ program }: { program: ProgramRow }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Status</h2>
			<ActionForm action={setProgramStatus} success="Status updated." className="flex flex-wrap gap-1.5">
				<input type="hidden" name="id" value={program.id} />
				{PROGRAM_STATUSES.filter((s) => s !== program.status).map((s) => (
					<Button key={s} type="submit" name="status" value={s} size="sm" variant={s === 'closed' ? 'ghost' : 'outline'}>
						{PROGRAM_STATUS_LABELS[s]}
					</Button>
				))}
			</ActionForm>
			<p className="text-2xs text-slate-500 mt-2">Kickoff {program.kickoff_on ?? '—'} · first set live {program.first_set_live_on ?? '—'}{program.paused_on ? ` · paused ${program.paused_on}` : ''}{program.closed_on ? ` · closed ${program.closed_on}` : ''}</p>
		</Card>
	);
}

export function MembersPanel({ programId, members, people, roles, title }: { programId: string; members: MemberRow[]; people: { id: string; name: string }[]; roles: readonly MemberRole[]; title: string }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h2>
			<ul className="space-y-1.5 mb-3">
				{roles.map((role) => {
					const holders = members.filter((m) => m.role === role);
					return (
						<li key={role} className="text-xs" title={MEMBER_ROLE_OWNS[role]}>
							<span className="font-medium text-slate-800 dark:text-slate-200">{MEMBER_ROLE_LABELS[role]}:</span>{' '}
							{holders.length === 0 ? (
								<span className="text-amber-600 dark:text-amber-400">unassigned</span>
							) : (
								holders.map((h) => (
									<span key={h.user_id} className="inline-flex items-center gap-1 mr-2 text-slate-700 dark:text-slate-300">
										{h.name}
										<ActionForm action={setMember} success={null} className="inline">
											<input type="hidden" name="program_id" value={programId} />
											<input type="hidden" name="user_id" value={h.user_id} />
											<input type="hidden" name="role" value={role} />
											<input type="hidden" name="remove" value="on" />
											<button type="submit" className="text-slate-400 hover:text-red-600" aria-label={`Remove ${h.name}`}>
												×
											</button>
										</ActionForm>
									</span>
								))
							)}
						</li>
					);
				})}
			</ul>
			<ActionForm action={setMember} success="Added." className="grid grid-cols-2 gap-1.5" resetOnSuccess>
				<input type="hidden" name="program_id" value={programId} />
				<Select name="user_id" size="sm" required defaultValue="">
					<option value="">Person</option>
					{people.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</Select>
				<Select name="role" size="sm" defaultValue={roles[0]}>
					{roles.map((r) => (
						<option key={r} value={r}>
							{MEMBER_ROLE_LABELS[r]}
						</option>
					))}
				</Select>
				<Button type="submit" size="sm" variant="outline" className="col-span-2">
					Add
				</Button>
			</ActionForm>
		</Card>
	);
}

export function FactsPanel({ programId, facts, min, max }: { programId: string; facts: FactRow[]; min: number; max: number }) {
	const live = facts.filter((f) => f.status !== 'retired');
	return (
		<Card>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Verifiable facts</h2>
				<Badge color={live.length >= min ? 'success' : 'warning'}>
					{live.length} / {min}–{max}
				</Badge>
			</div>
			<p className="text-xs text-slate-500 mb-2">Every citation rotates one of these in (SOP Step 9). Founding details, customer counts, differentiators, proprietary methods, third-party validations.</p>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700 mb-3">
				{facts.map((f) => (
					<li key={f.id} className="py-1.5 flex items-start justify-between gap-2 text-xs">
						<div className="min-w-0">
							<span className={f.status === 'retired' ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}>{f.fact}</span>
							{f.source_url && (
								<a href={f.source_url} target="_blank" rel="noreferrer" className="ml-1 text-primary-600 hover:underline">
									source
								</a>
							)}
							<span className="ml-2 text-2xs text-slate-500">used {f.use_count}×</span>
						</div>
						<ActionForm action={saveFact} success={null} className="flex gap-1 shrink-0">
							<input type="hidden" name="program_id" value={programId} />
							<input type="hidden" name="id" value={f.id} />
							{f.status === 'proposed' && (
								<Button type="submit" name="status" value="verified" size="sm" variant="outline">
									Verify
								</Button>
							)}
							{f.status === 'verified' && <Badge color="success">verified</Badge>}
							{f.status !== 'retired' && (
								<Button type="submit" name="remove" value="on" size="sm" variant="ghost">
									Retire
								</Button>
							)}
						</ActionForm>
					</li>
				))}
			</ul>
			<ActionForm action={saveFact} success="Fact added." className="grid gap-1.5 md:grid-cols-[1fr_200px_auto]" resetOnSuccess>
				<input type="hidden" name="program_id" value={programId} />
				<Input name="fact" placeholder="A specific, checkable fact" required maxLength={600} />
				<Input name="source_url" placeholder="Source URL (optional)" />
				<Button type="submit" size="sm" variant="outline">
					Add
				</Button>
			</ActionForm>
		</Card>
	);
}

export function NewClusterForm({ programId, nextNumber }: { programId: string; nextNumber: number }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Scaffold cluster {nextNumber}</h2>
			<p className="text-xs text-slate-500 mb-2">Creates the 90-day cluster with 10 pages (4 pillar + 6 AEO question) from the package scope; page 1 takes the anchor keyword. Edit keywords on each page.</p>
			<ActionForm action={scaffoldCluster} success="Cluster scaffolded." className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
				<input type="hidden" name="program_id" value={programId} />
				<Input name="anchor_keyword" placeholder="Anchor keyword (locked live on the discovery call)" />
				<Input name="starts_on" type="date" />
				<Button type="submit" size="sm">
					Scaffold
				</Button>
			</ActionForm>
		</Card>
	);
}

export function ClusterPanel({ programId, cluster, pages, citations, videos, channels, expanded }: { programId: string; cluster: ClusterRow; pages: PageRow[]; citations: CitationRow[]; videos: VideoRow[]; channels: ChannelRow[]; expanded: boolean }) {
	const [open, setOpen] = useState(expanded);
	const prog = clusterProgress(cluster, pages, citations);
	const perChannel = channels.filter((c) => c.is_active && c.per_page_min > 0).length;
	return (
		<Card>
			<button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-left">
				<div>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						Cluster {cluster.number}
						{cluster.anchor_keyword ? ` · ${cluster.anchor_keyword}` : ''}
					</h2>
					<p className="text-2xs text-slate-500">
						{cluster.starts_on ? `${cluster.starts_on} → ${cluster.ends_on}` : 'not started'} · day {prog.day ?? '—'} · pages live {prog.pages_live}/{prog.pages_total} · citations {prog.citations_shipped}/{prog.citations_target}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge color={PLAN_STATUS_COLORS[cluster.plan_status]}>plan: {PLAN_STATUS_LABELS[cluster.plan_status]}</Badge>
					<Badge color={cluster.status === 'live' ? 'success' : 'default'}>{CLUSTER_STATUS_LABELS[cluster.status]}</Badge>
					{prog.behind && <Badge color="danger">Behind</Badge>}
				</div>
			</button>
			{open && (
				<div className="mt-4 space-y-4">
					<ActionForm action={saveCluster} success="Cluster saved." className="grid gap-2 md:grid-cols-6">
						<input type="hidden" name="id" value={cluster.id} />
						<input type="hidden" name="program_id" value={programId} />
						<div className="md:col-span-2">
							<Input label="Anchor keyword" name="anchor_keyword" defaultValue={cluster.anchor_keyword ?? ''} />
						</div>
						<Input label="Starts" name="starts_on" type="date" defaultValue={cluster.starts_on ?? ''} />
						<Input label="Ends" name="ends_on" type="date" defaultValue={cluster.ends_on ?? ''} />
						<Input label="Re-audit due" name="reaudit_due_on" type="date" defaultValue={cluster.reaudit_due_on ?? ''} />
						<Select label="Status" name="status" defaultValue={cluster.status}>
							{CLUSTER_STATUSES.map((s) => (
								<option key={s} value={s}>
									{CLUSTER_STATUS_LABELS[s]}
								</option>
							))}
						</Select>
						<div className="md:col-span-4">
							<Textarea label="Keyword Cluster Strategy Plan (markdown; F4 drafts it from the audit)" name="plan_md" rows={6} defaultValue={cluster.plan_md ?? ''} />
						</div>
						<div className="md:col-span-2 space-y-2">
							<Input label="Loom walkthrough URL" name="plan_loom_url" defaultValue={cluster.plan_loom_url ?? ''} />
							<Select label="Plan status" name="plan_status" defaultValue={cluster.plan_status}>
								{PLAN_STATUSES.map((s) => (
									<option key={s} value={s}>
										{PLAN_STATUS_LABELS[s]}
									</option>
								))}
							</Select>
							<p className="text-2xs text-slate-500">
								{cluster.plan_sent_at ? `Sent to client ${cluster.plan_sent_at.slice(0, 10)}` : 'Not sent'}
								{cluster.plan_auto_approve_at ? ` · silent approval ${cluster.plan_auto_approve_at.slice(0, 10)}` : ''}
								{cluster.plan_approved_at ? ` · approved ${cluster.plan_approved_at.slice(0, 10)} (${cluster.plan_approved_by ?? ''})` : ''}
							</p>
						</div>
						<div className="md:col-span-6">
							<Button type="submit" size="sm">
								Save cluster
							</Button>
						</div>
					</ActionForm>

					<div>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Page Tracker</h3>
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
									<th className="py-1 pr-2">#</th>
									<th className="py-1 pr-2">Kind</th>
									<th className="py-1 pr-2">Keyword / title</th>
									<th className="py-1 pr-2">Chapter</th>
									<th className="py-1 pr-2">Words</th>
									<th className="py-1 pr-2">Status</th>
									<th className="py-1 pr-2">Live</th>
									<th className="py-1">Citations</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{pages.map((p) => {
									const mine = citations.filter((c) => c.page_id === p.id);
									const shipped = mine.filter((c) => SHIPPED_CITATION.includes(c.status)).length;
									const chs = new Set(mine.filter((c) => SHIPPED_CITATION.includes(c.status)).map((c) => c.channel_key)).size;
									const overdue = p.live_at && !p.citation_wave_done_at && p.citation_wave_due_at && new Date(p.citation_wave_due_at) < new Date();
									const vid = videos.find((v) => v.id === p.video_id);
									return (
										<tr key={p.id}>
											<td className="py-1.5 pr-2 text-slate-500">{p.number}</td>
											<td className="py-1.5 pr-2 text-slate-600 dark:text-slate-400">{p.kind}</td>
											<td className="py-1.5 pr-2">
												<Link href={`/flywheel/${programId}/pages/${p.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
													{p.keyword}
												</Link>
												{p.title && <div className="text-2xs text-slate-500">{p.title}</div>}
											</td>
											<td className="py-1.5 pr-2 text-slate-600 dark:text-slate-400">{p.chapter_index ?? '—'}{vid ? ` (${vid.month.slice(0, 7)})` : ''}</td>
											<td className="py-1.5 pr-2 text-slate-600 dark:text-slate-400">{p.word_target_min}–{p.word_target_max}</td>
											<td className="py-1.5 pr-2"><Badge color={PAGE_STATUS_COLORS[p.status]}>{PAGE_STATUS_LABELS[p.status]}</Badge></td>
											<td className="py-1.5 pr-2 text-slate-600 dark:text-slate-400">{p.live_url ? <a href={p.live_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">link</a> : '—'}</td>
											<td className="py-1.5">
												<span className={overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-600 dark:text-slate-400'}>
													{shipped}/{p.target_citations ?? 20} · {chs}/{perChannel} ch{overdue ? ' · >72 h' : ''}
												</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						<p className="text-2xs text-slate-500 mt-1">Citation statuses: {Object.values(CITATION_STATUS_LABELS).slice(0, 8).join(' → ')}.</p>
					</div>
				</div>
			)}
		</Card>
	);
}

export function NewVideoForm({ programId, clusters }: { programId: string; clusters: ClusterRow[] }) {
	const now = new Date();
	const def = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Plan a monthly recording</h2>
			<ActionForm action={saveVideo} success="Recording planned." className="grid gap-2 md:grid-cols-[160px_1fr_200px_auto]">
				<input type="hidden" name="program_id" value={programId} />
				<Input name="month" type="month" defaultValue={def} required />
				<Input name="title" placeholder="Working title" />
				<Select name="cluster_id" defaultValue={clusters.find((c) => c.status !== 'closed')?.id ?? ''}>
					<option value="">No cluster</option>
					{clusters.map((c) => (
						<option key={c.id} value={c.id}>
							Cluster {c.number}
						</option>
					))}
				</Select>
				<Button type="submit" size="sm">
					Plan
				</Button>
			</ActionForm>
		</Card>
	);
}

export function DeliverableForm({ clientId, programId, packageKey, kinds }: { clientId: string; programId: string | null; packageKey: string; kinds: string[] }) {
	return (
		<ActionForm action={saveDeliverable} success="Deliverable added." className="grid gap-2 md:grid-cols-[140px_1fr_160px_140px_auto_auto]" resetOnSuccess>
			<input type="hidden" name="client_id" value={clientId} />
			{programId && <input type="hidden" name="program_id" value={programId} />}
			<input type="hidden" name="package_key" value={packageKey} />
			<Select name="kind" size="sm" defaultValue={kinds[0] ?? 'custom'}>
				{[...kinds, 'custom'].map((k) => (
					<option key={k} value={k}>
						{k}
					</option>
				))}
			</Select>
			<Input name="title" placeholder="Title" required />
			<Select name="status" size="sm" defaultValue="planned">
				{DELIVERABLE_STATUSES.map((s) => (
					<option key={s} value={s}>
						{DELIVERABLE_STATUS_LABELS[s]}
					</option>
				))}
			</Select>
			<Input name="due_on" type="date" />
			<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
				<Checkbox name="visible_to_client" defaultChecked /> client sees
			</label>
			<Button type="submit" size="sm" variant="outline">
				Add
			</Button>
		</ActionForm>
	);
}
