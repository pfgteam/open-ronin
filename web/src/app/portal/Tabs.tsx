'use client';

// Portal tab bodies (F5). Client-safe: no staff imports.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { GoogleConnView, PortalApproval, PortalBilling, PortalFile, PortalMediaOpp, PortalNote, PortalOverview, PortalSession, PortalVisibility } from '@/lib/flywheel/portal';
import { addFact, decideApproval, selectGoogleAssets, setAutoApprove, submitNote, updateBrandStory } from './actions';

type Res = { ok: true } | { ok: false; error: string };

function Box({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
	return (
		<section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-panel ${className}`}>
			{title && <h2 className="text-base font-semibold text-slate-900 mb-2">{title}</h2>}
			{children}
		</section>
	);
}
function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'primary' }) {
	const c = { slate: 'bg-slate-100 text-slate-700', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', primary: 'bg-primary-100 text-primary-800' }[tone];
	return <span className={`inline-block rounded-full px-2 py-0.5 text-2xs font-medium ${c}`}>{children}</span>;
}
function Form({ action, children, success = 'Saved.', className = '' }: { action: (fd: FormData) => Promise<Res>; children: React.ReactNode; success?: string; className?: string }) {
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	return (
		<form className={className} action={(fd) => start(async () => { setMsg(null); const r = await action(fd); setMsg(r.ok ? { ok: true, text: success } : { ok: false, text: r.error }); })}>
			{msg && <div className={`mb-2 rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}
			<fieldset disabled={pending} className="contents">
				{children}
			</fieldset>
		</form>
	);
}
const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const btn = 'inline-flex items-center rounded-md bg-primary-700 text-white text-sm font-medium px-3 py-1.5 hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';
const btnGhost = 'inline-flex items-center rounded-md border border-slate-300 bg-white text-slate-800 text-sm font-medium px-3 py-1.5 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const STATUS_LABEL: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', in_review: 'In review', awaiting_client: 'Waiting on you', approved: 'Approved', delivered: 'Delivered', skipped: 'Skipped', pending: 'Waiting on you', changes_requested: 'Changes requested', auto_approved: 'Approved (automatically)', withdrawn: 'Withdrawn' };
const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function HomeTab({ session, overview, approvals, events, settings }: { session: PortalSession; overview: PortalOverview | null; approvals: PortalApproval[]; events: { id: number; kind: string; summary: string; created_at: string; actor_label: string | null }[]; settings: { book_call_url: string } }) {
	const recent = (overview?.deliverables ?? []).slice(0, 8);
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="lg:col-span-2 space-y-4">
				<Box>
					<h2 className="text-lg font-semibold text-slate-900">Welcome back, {session.display_name.split(' ')[0]}.</h2>
					<p className="text-sm text-slate-600 mt-1">This is your Open Ronin portal: every package you have with us, what we delivered, what we need from you, and your numbers. Nothing here is a login to remember — the link we email you is the key.</p>
				</Box>
				{approvals.length > 0 && (
					<Box title={`Waiting on you (${approvals.length})`} className="border-amber-200">
						<ul className="divide-y divide-slate-200">
							{approvals.map((a) => (
								<li key={a.id} className="py-2 flex items-center justify-between gap-3 text-sm">
									<span>
										<span className="font-medium text-slate-900">{a.title}</span>
										<span className="text-slate-500"> · {a.kind}</span>
										{a.due_at && <span className="text-2xs text-amber-700 ml-2">auto-approves {d(a.due_at)}</span>}
									</span>
									<Link href={`/portal?tab=approvals&approval=${a.id}`} className={btn}>
										Review
									</Link>
								</li>
							))}
						</ul>
					</Box>
				)}
				<Box title="Recent deliverables">
					{recent.length === 0 ? (
						<p className="text-sm text-slate-500">Nothing delivered yet — onboarding is under way.</p>
					) : (
						<ul className="divide-y divide-slate-200 text-sm">
							{recent.map((r) => (
								<li key={r.id} className="py-2 flex items-center justify-between gap-3">
									<span>
										<span className="text-slate-900">{r.title}</span>
										<span className="text-slate-500"> · {r.package_key} · {r.kind}</span>
									</span>
									<Pill tone={r.status === 'delivered' || r.status === 'approved' ? 'green' : r.status === 'awaiting_client' ? 'amber' : 'slate'}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
								</li>
							))}
						</ul>
					)}
				</Box>
			</div>
			<div className="space-y-4">
				<Box title="Your packages">
					<ul className="space-y-1 text-sm">
						{(overview?.programs ?? []).map((p) => (
							<li key={p.id} className="flex items-center justify-between">
								<span className="text-slate-900">{p.label ?? p.package_key}</span>
								<Pill tone={p.status === 'active' ? 'green' : 'primary'}>{p.status}</Pill>
							</li>
						))}
					</ul>
					<Link href="/portal?tab=packages" className="text-sm text-primary-700 underline mt-2 inline-block">
						Deliverables by package
					</Link>
				</Box>
				<Box title="Latest">
					<ul className="space-y-1.5 text-xs text-slate-700">
						{events.map((e) => (
							<li key={e.id}>
								<span className="text-slate-400">{d(e.created_at)}</span> · {e.summary}
							</li>
						))}
						{events.length === 0 && <li className="text-slate-500">No updates yet.</li>}
					</ul>
				</Box>
				{settings.book_call_url && (
					<a href={settings.book_call_url} target="_blank" rel="noreferrer" className={`${btn} w-full justify-center`}>
						Book a call
					</a>
				)}
			</div>
		</div>
	);
}

export function PackagesTab({ overview }: { overview: PortalOverview | null }) {
	const groups = new Map<string, PortalOverview['deliverables']>();
	for (const dlv of overview?.deliverables ?? []) groups.set(dlv.package_key, [...(groups.get(dlv.package_key) ?? []), dlv]);
	const keys = Array.from(new Set([...(overview?.programs ?? []).map((p) => p.package_key), ...groups.keys()]));
	return (
		<div className="space-y-4">
			{keys.length === 0 && <Box><p className="text-sm text-slate-500">No packages on file yet.</p></Box>}
			{keys.map((k) => (
				<Box key={k} title={k === 'flywheel' ? 'AEO Flywheel' : k === 'pr' ? 'PR / Media' : k === 'smm' ? 'Social' : k}>
					{k === 'pr' && (
						<p className="text-xs text-slate-500 mb-2">
							Placements live on the <Link href="/portal?tab=media" className="underline">Media</Link> tab.
						</p>
					)}
					{(groups.get(k) ?? []).length === 0 ? (
						<p className="text-sm text-slate-500">Nothing tracked yet.</p>
					) : (
						<table className="w-full text-sm">
							<tbody className="divide-y divide-slate-200">
								{(groups.get(k) ?? []).map((r) => (
									<tr key={r.id}>
										<td className="py-1.5 pr-3 text-slate-500 whitespace-nowrap">{r.period_month ? r.period_month.slice(0, 7) : ''}</td>
										<td className="py-1.5 pr-3 text-slate-900">{r.title}</td>
										<td className="py-1.5 pr-3 text-slate-500">{r.kind}</td>
										<td className="py-1.5 text-right"><Pill tone={r.status === 'delivered' || r.status === 'approved' ? 'green' : r.status === 'awaiting_client' ? 'amber' : 'slate'}>{STATUS_LABEL[r.status] ?? r.status}</Pill></td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</Box>
			))}
		</div>
	);
}

export function ApprovalsTab({ session, approvals, openId, openBody, programs }: { session: PortalSession; approvals: PortalApproval[]; openId: string | null; openBody: { title: string; body_md: string | null; loom_url: string | null } | null; programs: PortalOverview['programs'] }) {
	const pending = approvals.filter((a) => a.status === 'pending');
	const done = approvals.filter((a) => a.status !== 'pending');
	const open = openId ? approvals.find((a) => a.id === openId) : null;
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="lg:col-span-2 space-y-4">
				{open && open.status === 'pending' && (
					<Box title={open.title} className="border-amber-200">
						{open.due_at && <p className="text-xs text-amber-700 mb-2">If we don&apos;t hear back, this is approved automatically on {d(open.due_at)} (your auto-approve setting).</p>}
						{openBody?.loom_url && (
							<a href={openBody.loom_url} target="_blank" rel="noreferrer" className="text-sm text-primary-700 underline">
								Watch the walkthrough
							</a>
						)}
						<div className="mt-2 max-h-[480px] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800">{openBody?.body_md ?? open.summary_md ?? '(no preview)'}</div>
						<Form action={decideApproval} success="Thank you — recorded." className="mt-3 space-y-2">
							<input type="hidden" name="client" value={session.client_id} />
							<input type="hidden" name="approval_id" value={open.id} />
							<textarea name="comment" rows={3} className={input} placeholder="Comments (required if you ask for changes)" />
							<div className="flex gap-2">
								<button type="submit" name="decision" value="approved" className={btn}>
									Approve
								</button>
								<button type="submit" name="decision" value="changes_requested" className={btnGhost}>
									Request changes
								</button>
							</div>
						</Form>
					</Box>
				)}
				<Box title={`Waiting on you (${pending.length})`}>
					{pending.length === 0 ? (
						<p className="text-sm text-slate-500">Nothing right now.</p>
					) : (
						<ul className="divide-y divide-slate-200 text-sm">
							{pending.map((a) => (
								<li key={a.id} className="py-2 flex items-center justify-between gap-3">
									<span>
										<span className="font-medium text-slate-900">{a.title}</span> <span className="text-slate-500">· sent {d(a.requested_at)}</span>
									</span>
									<Link href={`/portal?tab=approvals&approval=${a.id}`} className={a.id === openId ? btnGhost : btn}>
										{a.id === openId ? 'Open' : 'Review'}
									</Link>
								</li>
							))}
						</ul>
					)}
				</Box>
				<Box title="History">
					<ul className="divide-y divide-slate-200 text-sm">
						{done.map((a) => (
							<li key={a.id} className="py-2 flex items-center justify-between gap-3">
								<span>
									<span className="text-slate-900">{a.title}</span>
									{a.client_comment && <span className="block text-xs text-slate-500">“{a.client_comment}”</span>}
								</span>
								<span className="text-right">
									<Pill tone={a.status === 'changes_requested' ? 'amber' : 'green'}>{STATUS_LABEL[a.status] ?? a.status}</Pill>
									<span className="block text-2xs text-slate-500">{d(a.decided_at)}</span>
								</span>
							</li>
						))}
						{done.length === 0 && <li className="py-2 text-slate-500">No decisions yet.</li>}
					</ul>
				</Box>
			</div>
			<div className="space-y-4">
				{programs.map((p) => (
					<Box key={p.id} title={`Auto-approve · ${p.label ?? p.package_key}`}>
						<p className="text-xs text-slate-500 mb-2">When on, anything we send you is approved automatically after the window below if we don&apos;t hear back. You can turn it off any time.</p>
						<Form action={setAutoApprove} success="Setting saved." className="space-y-2 text-sm">
							<input type="hidden" name="client" value={session.client_id} />
							<input type="hidden" name="program_id" value={p.id} />
							<label className="flex items-center justify-between gap-2">
								<span className="flex items-center gap-2">
									<input type="checkbox" name="plans" defaultChecked={p.auto_approve?.plans?.enabled} /> Plans
								</span>
								<span className="flex items-center gap-1 text-xs">
									after <input type="number" name="plans_days" min={1} max={10} defaultValue={p.auto_approve?.plans?.business_days ?? 3} className="w-14 rounded-md border border-slate-300 px-1 py-0.5" /> business days
								</span>
							</label>
							<label className="flex items-center justify-between gap-2">
								<span className="flex items-center gap-2">
									<input type="checkbox" name="content" defaultChecked={p.auto_approve?.content?.enabled} /> Content (pages)
								</span>
								<span className="flex items-center gap-1 text-xs">
									after <input type="number" name="content_days" min={1} max={10} defaultValue={p.auto_approve?.content?.business_days ?? 2} className="w-14 rounded-md border border-slate-300 px-1 py-0.5" /> business days
								</span>
							</label>
							<button type="submit" className={btnGhost}>
								Save
							</button>
						</Form>
					</Box>
				))}
			</div>
		</div>
	);
}

type Trackers = NonNullable<Awaited<ReturnType<typeof import('@/lib/flywheel/portal').loadPortalTrackers>>>;

function ProgramPicker({ programs, programId, tab }: { programs: PortalOverview['programs']; programId: string | null; tab: string }) {
	if (programs.length < 2) return null;
	return (
		<div className="flex gap-2 text-xs mb-3">
			{programs.map((p) => (
				<Link key={p.id} href={`/portal?tab=${tab}&program=${p.id}`} className={p.id === programId ? 'font-semibold text-slate-900' : 'text-primary-700 underline'}>
					{p.label ?? p.package_key}
				</Link>
			))}
		</div>
	);
}

export function TrackersTab({ trackers, programs, programId }: { trackers: Trackers | null; programs: PortalOverview['programs']; programId: string | null }) {
	const [openPage, setOpenPage] = useState<string | null>(null);
	if (!trackers) return <Box><p className="text-sm text-slate-500">No Flywheel program yet.</p></Box>;
	return (
		<div className="space-y-4">
			<ProgramPicker programs={programs} programId={programId} tab="trackers" />
			<Box title="Cluster tracker">
				{trackers.clusters.length === 0 ? (
					<p className="text-sm text-slate-500">Cluster 1 is being planned.</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
								<th className="py-1 pr-3">Cluster</th>
								<th className="py-1 pr-3">Anchor keyword</th>
								<th className="py-1 pr-3">Plan</th>
								<th className="py-1 pr-3">Window</th>
								<th className="py-1 pr-3">Pages live</th>
								<th className="py-1">Citations</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200">
							{trackers.clusters.map((c) => {
								const pages = trackers.pages.filter((p) => p.cluster_id === c.id);
								const shipped = pages.reduce((s, p) => s + p.citations_shipped, 0);
								const target = pages.reduce((s, p) => s + (p.target_citations ?? 20), 0);
								return (
									<tr key={c.id}>
										<td className="py-1.5 pr-3 text-slate-900">#{c.number}</td>
										<td className="py-1.5 pr-3 text-slate-700">{c.anchor_keyword ?? '—'}</td>
										<td className="py-1.5 pr-3"><Pill tone={c.plan_status === 'approved' ? 'green' : c.plan_status === 'awaiting_client' ? 'amber' : 'slate'}>{STATUS_LABEL[c.plan_status] ?? c.plan_status.replace('_', ' ')}</Pill></td>
										<td className="py-1.5 pr-3 text-slate-500">{c.starts_on ? `${d(c.starts_on)} → ${d(c.ends_on)}` : '—'}</td>
										<td className="py-1.5 pr-3 text-slate-700">{pages.filter((p) => p.status === 'live').length}/{pages.length}</td>
										<td className="py-1.5 text-slate-700">{shipped}/{target}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</Box>
			<Box title="Page tracker">
				<ul className="divide-y divide-slate-200 text-sm">
					{trackers.pages.map((p) => (
						<li key={p.id} className="py-2">
							<button type="button" className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpenPage(openPage === p.id ? null : p.id)}>
								<span>
									<span className="text-slate-500">{p.number}.</span> <span className="text-slate-900">{p.title ?? p.keyword}</span>
									<span className="text-2xs text-slate-500 ml-2">{p.kind === 'pillar' ? 'pillar' : 'question'} · “{p.keyword}”</span>
								</span>
								<span className="flex items-center gap-2">
									<span className="text-2xs text-slate-500">{p.citations_shipped}/{p.target_citations ?? 20} citations</span>
									{p.live_url ? (
										<a href={p.live_url} target="_blank" rel="noreferrer" className="text-primary-700 underline text-xs">
											live
										</a>
									) : (
										<Pill tone={p.status === 'approved' ? 'green' : p.status === 'awaiting_client' ? 'amber' : 'slate'}>{STATUS_LABEL[p.status] ?? p.status.replace('_', ' ')}</Pill>
									)}
								</span>
							</button>
							{openPage === p.id && p.body_md && <div className="mt-2 max-h-80 overflow-y-auto rounded-md bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-700">{p.quick_answer_md ? `Quick answer: ${p.quick_answer_md}\n\n` : ''}{p.body_md}</div>}
						</li>
					))}
					{trackers.pages.length === 0 && <li className="py-2 text-slate-500">No pages yet.</li>}
				</ul>
			</Box>
			<Box title="Citation ledger">
				{trackers.citations.length === 0 ? (
					<p className="text-sm text-slate-500">Citations start once the first page is live.</p>
				) : (
					<table className="w-full text-xs">
						<thead>
							<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
								<th className="py-1 pr-2">Date</th>
								<th className="py-1 pr-2">Channel</th>
								<th className="py-1 pr-2">Piece</th>
								<th className="py-1 pr-2">Keyword</th>
								<th className="py-1">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200">
							{trackers.citations.map((c) => (
								<tr key={c.id}>
									<td className="py-1 pr-2 text-slate-500 whitespace-nowrap">{c.posted_on ? d(c.posted_on) : '—'}</td>
									<td className="py-1 pr-2 text-slate-700">{c.channel}</td>
									<td className="py-1 pr-2 text-slate-900">{c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.title ?? c.url}</a> : (c.title ?? '—')}</td>
									<td className="py-1 pr-2 text-slate-500">{c.keyword ?? ''}</td>
									<td className="py-1"><Pill tone={c.status === 'live' || c.status === 'posted' ? 'green' : 'slate'}>{c.status}</Pill></td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Box>
			{trackers.facts.length > 0 && (
				<Box title="Your verifiable facts">
					<ul className="list-disc pl-5 text-sm text-slate-700 space-y-0.5">
						{trackers.facts.map((f) => (
							<li key={f.id}>
								{f.fact} {f.status === 'verified' && <Pill tone="green">verified</Pill>}
							</li>
						))}
					</ul>
				</Box>
			)}
		</div>
	);
}

export function VisibilityTab({ vis, programs, programId }: { vis: PortalVisibility | null; programs: PortalOverview['programs']; programId: string | null }) {
	if (!vis || !vis.latest) {
		return (
			<div className="space-y-4">
				<ProgramPicker programs={programs} programId={programId} tab="visibility" />
				<Box><p className="text-sm text-slate-500">Your AI visibility baseline runs once the prompts are locked at kickoff. Results appear here, then monthly.</p></Box>
			</div>
		);
	}
	const l = vis.latest;
	return (
		<div className="space-y-4">
			<ProgramPicker programs={programs} programId={programId} tab="visibility" />
			<Box title={`AI visibility · ${l.kind} · ${l.period_month.slice(0, 7)}`}>
				<p className="text-xs text-slate-500 mb-3">How often AI answer engines name you for the buyer questions we locked at kickoff, across {l.models} models (the core five weighted separately). Same prompts, same models, every month.</p>
				<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 text-sm">
					<Stat label="Named in answers" v={pct(l.presence_rate)} />
					<Stat label="Core 5 models" v={pct(l.core_presence_rate)} />
					<Stat label="Average position" v={l.avg_position != null ? `#${l.avg_position}` : '—'} />
					<Stat label="Share of voice" v={pct(l.sov)} />
					<Stat label="Things AI gets wrong" v={String(l.misinfo_count)} />
				</div>
			</Box>
			{vis.report_md && (
				<Box title="This month's read">
					<div className="text-sm text-slate-800 whitespace-pre-wrap">{vis.report_md}</div>
				</Box>
			)}
			{vis.trend.length > 1 && (
				<Box title="Trend">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
								<th className="py-1 pr-3">Month</th>
								<th className="py-1 pr-3">Named</th>
								<th className="py-1 pr-3">Core 5</th>
								<th className="py-1">Share of voice</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200">
							{vis.trend.map((t, i) => (
								<tr key={i}>
									<td className="py-1 pr-3 text-slate-700">{t.period_month.slice(0, 7)} · {t.kind}</td>
									<td className="py-1 pr-3 text-slate-900">{pct(t.presence_rate)}</td>
									<td className="py-1 pr-3 text-slate-700">{pct(t.core_presence_rate)}</td>
									<td className="py-1 text-slate-700">{pct(t.sov)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</Box>
			)}
			<Box title="By question">
				<ul className="divide-y divide-slate-200 text-sm">
					{vis.per_prompt.map((p, i) => (
						<li key={i} className="py-1.5 flex items-center justify-between gap-3">
							<span className="text-slate-800">{p.prompt}</span>
							<span className="text-slate-600 whitespace-nowrap">
								{p.present}/{p.models} · core {p.core_present}/{p.core_models}
							</span>
						</li>
					))}
				</ul>
			</Box>
		</div>
	);
}

export function MediaTab({ opps }: { opps: PortalMediaOpp[] }) {
	const live = opps.filter((o) => o.live_link);
	const secured = opps.filter((o) => !o.live_link && o.date_secured);
	const pitched = opps.filter((o) => !o.live_link && !o.date_secured);
	const section = (title: string, list: PortalMediaOpp[]) => (
		<Box title={`${title} (${list.length})`}>
			{list.length === 0 ? (
				<p className="text-sm text-slate-500">None yet.</p>
			) : (
				<ul className="divide-y divide-slate-200 text-sm">
					{list.map((o) => (
						<li key={o.id} className="py-1.5 flex items-center justify-between gap-3">
							<span>
								<span className="text-slate-900">{o.outlet_name ?? o.title ?? 'Outlet'}</span>
								{o.title && o.outlet_name && <span className="text-slate-500"> · {o.title}</span>}
								{o.media_tier && <span className="text-2xs text-slate-500 ml-2">{o.media_tier}</span>}
							</span>
							<span className="text-xs text-slate-500 whitespace-nowrap">
								{o.live_link ? (
									<a href={o.live_link} target="_blank" rel="noreferrer" className="text-primary-700 underline">
										read it
									</a>
								) : (
									d(o.date_secured)
								)}
								{o.reach ? ` · ${o.reach.toLocaleString()} reach` : ''}
							</span>
						</li>
					))}
				</ul>
			)}
		</Box>
	);
	return (
		<div className="space-y-4">
			{section('Live coverage', live)}
			{section('Secured, publishing soon', secured)}
			{section('Pitched', pitched)}
		</div>
	);
}

export function ReportsTab({ reports }: { reports: { id: string; kind: string; period_from: string; period_to: string; subject: string | null; body_md: string | null; status: string; sent_at: string | null }[] }) {
	const [open, setOpen] = useState<string | null>(null);
	return (
		<Box title="Reports">
			{reports.length === 0 ? (
				<p className="text-sm text-slate-500">Your Friday recaps and monthly reports appear here once sent.</p>
			) : (
				<ul className="divide-y divide-slate-200 text-sm">
					{reports.map((r) => (
						<li key={r.id} className="py-2">
							<button type="button" className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
								<span>
									<span className="text-slate-900">{r.subject ?? `${r.kind} · ${r.period_from} → ${r.period_to}`}</span>
									<span className="text-2xs text-slate-500 ml-2">{r.kind.replace('_', ' ')}</span>
								</span>
								<span className="text-xs text-slate-500">{d(r.sent_at)}</span>
							</button>
							{open === r.id && <div className="mt-2 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800">{r.body_md}</div>}
						</li>
					))}
				</ul>
			)}
		</Box>
	);
}

export function CallsTab({ calls, bookUrl }: { calls: { id: string; call_type: string; occurred_at: string; duration_minutes: number | null; recording_url: string | null }[]; bookUrl: string }) {
	return (
		<div className="space-y-4">
			{bookUrl && (
				<Box>
					<a href={bookUrl} target="_blank" rel="noreferrer" className={btn}>
						Book a call with your strategist
					</a>
				</Box>
			)}
			<Box title="Call history">
				{calls.length === 0 ? (
					<p className="text-sm text-slate-500">No calls on record yet.</p>
				) : (
					<ul className="divide-y divide-slate-200 text-sm">
						{calls.map((c) => (
							<li key={c.id} className="py-1.5 flex items-center justify-between gap-3">
								<span className="text-slate-900">
									{c.call_type.replace('_', ' ')} <span className="text-slate-500">· {d(c.occurred_at)}{c.duration_minutes ? ` · ${c.duration_minutes} min` : ''}</span>
								</span>
								{c.recording_url && (
									<a href={c.recording_url} target="_blank" rel="noreferrer" className="text-primary-700 underline text-xs">
										recording
									</a>
								)}
							</li>
						))}
					</ul>
				)}
			</Box>
		</div>
	);
}

export function GiveTab({ session, notes, programs }: { session: PortalSession; notes: PortalNote[]; programs: PortalOverview['programs'] }) {
	const [kind, setKind] = useState<string>('request');
	const fw = programs.find((p) => p.package_key === 'flywheel') ?? programs[0] ?? null;
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="lg:col-span-2 space-y-4">
				<Box title="Send us something">
					<p className="text-xs text-slate-500 mb-2">A request or to-do, an idea or news angle, a media contact you already have, a product you want shipped to someone, or a question. Your strategist is notified.</p>
					<Form action={submitNote} success="Sent — thank you." className="space-y-2">
						<input type="hidden" name="client" value={session.client_id} />
						{fw && <input type="hidden" name="program_id" value={fw.id} />}
						<select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
							<option value="request">Request / to-do</option>
							<option value="idea">Idea center: news or angle</option>
							<option value="news">News / launch coming up</option>
							<option value="media_contact">A media contact I have</option>
							<option value="product_request">Product request (send product to someone)</option>
							<option value="question">Question</option>
						</select>
						<input name="title" required maxLength={240} className={input} placeholder="One line" />
						<textarea name="body_md" rows={4} className={input} placeholder="Details (optional)" />
						{kind === 'media_contact' && (
							<div className="grid gap-2 sm:grid-cols-3">
								<input name="contact_name" className={input} placeholder="Name" />
								<input name="contact_outlet" className={input} placeholder="Outlet / show" />
								<input name="contact_email" className={input} placeholder="Email" />
							</div>
						)}
						{kind === 'product_request' && (
							<div className="grid gap-2 sm:grid-cols-4">
								<input name="product" className={input} placeholder="Product" />
								<input name="qty" className={input} placeholder="Qty" />
								<input name="address" className={input} placeholder="Ship to" />
								<input name="by_date" type="date" className={input} />
							</div>
						)}
						<button type="submit" className={btn}>
							Send
						</button>
					</Form>
				</Box>
				<Box title="What you've sent">
					<ul className="divide-y divide-slate-200 text-sm">
						{notes.map((n) => (
							<li key={n.id} className="py-2">
								<div className="flex items-center justify-between gap-3">
									<span>
										<span className="text-slate-900">{n.title}</span>
										<span className="text-2xs text-slate-500 ml-2">{n.kind.replace('_', ' ')} · {d(n.created_at)}</span>
									</span>
									<Pill tone={n.status === 'done' ? 'green' : n.status === 'declined' ? 'red' : n.status === 'open' ? 'slate' : 'primary'}>{n.status.replace('_', ' ')}</Pill>
								</div>
								{n.reply_md && <p className="mt-1 text-xs text-slate-700 border-l-2 border-primary-300 pl-2">{n.reply_md}</p>}
							</li>
						))}
						{notes.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
					</ul>
				</Box>
			</div>
			<div className="space-y-4">
				{fw && (
					<>
						<Box title="Brand story">
							<Form action={updateBrandStory} success="Saved." className="space-y-2 text-sm">
								<input type="hidden" name="client" value={session.client_id} />
								<input type="hidden" name="program_id" value={fw.id} />
								<label className="block text-xs text-slate-600">Who is your ideal customer, in your words?</label>
								<textarea name="icp_md" rows={4} className={input} defaultValue={''} placeholder="(leave blank to keep what's on file)" />
								<label className="block text-xs text-slate-600">News, launches, seasonal angles</label>
								<textarea name="angles_md" rows={3} className={input} placeholder="(appended to what's on file)" />
								<div className="grid grid-cols-2 gap-2">
									<input name="sme_name" className={input} placeholder="On-camera expert (name)" />
									<input name="sme_email" type="email" className={input} placeholder="Their email" />
								</div>
								<button type="submit" className={btnGhost}>
									Save
								</button>
							</Form>
						</Box>
						<Box title="Add a verifiable fact">
							<p className="text-xs text-slate-500 mb-2">Founding year, customer counts, awards, certifications, proprietary methods — anything checkable a competitor cannot claim. We rotate these into every piece.</p>
							<Form action={addFact} success="Added — we'll verify it." className="space-y-2">
								<input type="hidden" name="client" value={session.client_id} />
								<input type="hidden" name="program_id" value={fw.id} />
								<input name="fact" required maxLength={600} className={input} placeholder="The fact" />
								<input name="source_url" className={input} placeholder="Where we can verify it (optional)" />
								<button type="submit" className={btnGhost}>
									Add fact
								</button>
							</Form>
						</Box>
					</>
				)}
			</div>
		</div>
	);
}

export function LibraryTab({ files }: { files: PortalFile[] }) {
	return (
		<div className="space-y-4">
			<Box title="Upload to your content library">
				<p className="text-xs text-slate-500 mb-2">Logos, brand guides, product photos, past articles, anything we should work from. Up to 50 MB per file.</p>
				<UploadForm kind="library" />
			</Box>
			<Box title="Files">
				{files.length === 0 ? (
					<p className="text-sm text-slate-500">Nothing uploaded yet.</p>
				) : (
					<ul className="divide-y divide-slate-200 text-sm">
						{files.map((f) => (
							<li key={f.id} className="py-1.5 flex items-center justify-between gap-3">
								<span>
									{f.url ? (
										<a href={f.url} target="_blank" rel="noreferrer" className="text-primary-700 underline">
											{f.original_name}
										</a>
									) : (
										<span className="text-slate-900">{f.original_name}</span>
									)}
									<span className="text-2xs text-slate-500 ml-2">
										{f.kind} · {d(f.created_at)} · {f.uploaded_by_label?.replace('client:', '') ?? 'Main'}
									</span>
								</span>
								<span className="text-2xs text-slate-500">{f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB` : ''}</span>
							</li>
						))}
					</ul>
				)}
			</Box>
		</div>
	);
}

export function RecordingTab({ videos, files, programId }: { videos: Trackers['videos']; files: PortalFile[]; programId: string | null }) {
	const next = videos.find((v) => !['edited', 'published'].includes(v.status)) ?? videos[0] ?? null;
	return (
		<div className="space-y-4">
			<Box title="Monthly seed-video recording">
				<p className="text-sm text-slate-600">Once a month we record a 15–20 minute seed video with your on-camera expert: ten chapters, each titled with a keyword, read from the script we approve together. Everything that month atomizes from it — pages, Shorts, articles.</p>
			</Box>
			{next && (
				<Box title={`${next.title ?? 'Recording'} · ${next.month.slice(0, 7)}`}>
					<p className="text-xs text-slate-500 mb-2">{next.shoot_at ? `Shoot: ${new Date(next.shoot_at).toLocaleString()}` : 'Shoot not scheduled yet.'}{next.youtube_url ? ' · ' : ''}{next.youtube_url && <a href={next.youtube_url} target="_blank" rel="noreferrer" className="text-primary-700 underline">on YouTube</a>}</p>
					<ul className="text-sm space-y-1">
						{next.checklist.map((c) => (
							<li key={c.key} className={c.done ? 'line-through text-slate-400' : 'text-slate-800'}>
								{c.done ? '✓' : '○'} {c.label}
							</li>
						))}
					</ul>
					{next.chapters.length > 0 && (
						<>
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-3 mb-1">Chapters</h3>
							<ol className="list-decimal pl-5 text-sm text-slate-800">
								{next.chapters.map((c) => (
									<li key={c.index}>{c.title}</li>
								))}
							</ol>
						</>
					)}
					{next.script_md && (
						<details className="mt-3">
							<summary className="cursor-pointer text-sm text-primary-700">Read the approved script</summary>
							<div className="mt-2 max-h-96 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800">{next.script_md}</div>
						</details>
					)}
					<div className="mt-3">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Upload your recording</h3>
						<UploadForm kind="recording" videoId={next.id} programId={programId} />
					</div>
				</Box>
			)}
			<Box title="Recordings on file">
				<ul className="divide-y divide-slate-200 text-sm">
					{files.map((f) => (
						<li key={f.id} className="py-1.5 flex items-center justify-between gap-3">
							<span className="text-slate-900">{f.original_name}</span>
							<span className="text-2xs text-slate-500">{d(f.created_at)}</span>
						</li>
					))}
					{files.length === 0 && <li className="py-2 text-slate-500">None yet.</li>}
				</ul>
			</Box>
		</div>
	);
}

function UploadForm({ kind, videoId, programId }: { kind: 'library' | 'recording'; videoId?: string | null; programId?: string | null }) {
	const [msg, setMsg] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<form
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setMsg(null);
				const fd = new FormData(e.currentTarget);
				const r = await fetch('/api/portal/upload', { method: 'POST', body: fd });
				const j = (await r.json().catch(() => ({}))) as { error?: string };
				setMsg(r.ok ? 'Uploaded.' : (j.error ?? 'Upload failed.'));
				setBusy(false);
				if (r.ok) window.location.reload();
			}}
			className="flex flex-wrap items-center gap-2"
		>
			<input type="hidden" name="kind" value={kind} />
			{videoId && <input type="hidden" name="video_id" value={videoId} />}
			{programId && <input type="hidden" name="program_id" value={programId} />}
			<input type="file" name="file" required className="text-sm" accept={kind === 'recording' ? 'video/*,audio/*' : undefined} />
			<input name="note" className={`${input} w-56`} placeholder="Note (optional)" />
			<button type="submit" disabled={busy} className={btn}>
				{busy ? 'Uploading…' : 'Upload'}
			</button>
			{msg && <span className="text-xs text-slate-600">{msg}</span>}
		</form>
	);
}

export function BillingTab({ billing, bookUrl, supportEmail }: { billing: PortalBilling; bookUrl: string; supportEmail: string }) {
	const money = (c: number | null | undefined) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
	return (
		<div className="space-y-4">
			<Box title="Your agreements">
				<table className="w-full text-sm">
					<tbody className="divide-y divide-slate-200">
						{billing.contracts.map((c) => (
							<tr key={c.id}>
								<td className="py-1.5 pr-3 text-slate-900">{c.package ?? 'Package'}</td>
								<td className="py-1.5 pr-3 text-slate-700">{money(c.per_month_cents)}/mo{c.setup_fee_cents ? ` · setup ${money(c.setup_fee_cents)}` : ''}</td>
								<td className="py-1.5 pr-3 text-slate-500">{c.starts_on ? `from ${d(c.starts_on)}` : ''}{c.billing_starts_on ? ` · monthly from ${d(c.billing_starts_on)}` : ''}</td>
								<td className="py-1.5 text-right"><Pill tone={c.status === 'active' ? 'green' : 'slate'}>{c.status}</Pill></td>
							</tr>
						))}
						{billing.contracts.length === 0 && (
							<tr>
								<td className="py-2 text-slate-500">No agreements on file.</td>
							</tr>
						)}
					</tbody>
				</table>
			</Box>
			<Box title="Signed contracts">
				<ul className="divide-y divide-slate-200 text-sm">
					{billing.signed.map((s) => (
						<li key={s.id} className="py-1.5 flex items-center justify-between gap-3">
							<span className="text-slate-900">
								{s.title} <span className="text-slate-500">· signed {d(s.signed_at)}</span>
							</span>
							{s.pdf_url && (
								<a href={s.pdf_url} target="_blank" rel="noreferrer" className="text-primary-700 underline text-xs">
									PDF
								</a>
							)}
						</li>
					))}
					{billing.signed.length === 0 && <li className="py-2 text-slate-500">None in the portal yet.</li>}
				</ul>
			</Box>
			<Box title="Invoices & payments">
				{billing.payments.length === 0 ? (
					<p className="text-sm text-slate-500">No invoices on record.</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
								<th className="py-1 pr-3">Due</th>
								<th className="py-1 pr-3">Type</th>
								<th className="py-1 pr-3">Paid</th>
								<th className="py-1">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200">
							{billing.payments.map((p) => (
								<tr key={p.id}>
									<td className="py-1 pr-3 text-slate-700">{d(p.due_on)}</td>
									<td className="py-1 pr-3 text-slate-500">{p.type ?? ''}</td>
									<td className="py-1 pr-3 text-slate-700">{p.paid_on ? d(p.paid_on) : '—'}</td>
									<td className="py-1"><Pill tone={p.status === 'Paid' ? 'green' : p.paid_on ? 'green' : 'amber'}>{p.status ?? (p.paid_on ? 'Paid' : 'Open')}</Pill></td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<p className="text-xs text-slate-500 mt-3">
					Billing question? <a href={`mailto:${supportEmail}`} className="underline">{supportEmail}</a>
					{bookUrl && (
						<>
							{' '}
							· <a href={bookUrl} target="_blank" rel="noreferrer" className="underline">book a call</a>
						</>
					)}
				</p>
			</Box>
		</div>
	);
}

export function ConnectionsTab({ conn, assets, metrics, configured, orgAccount, justConnected, error }: { conn: GoogleConnView | null; assets: { ga4: { id: string; name: string }[]; sc: { url: string }[]; gbp: { id: string; name: string }[]; error?: string } | null; metrics: Awaited<ReturnType<typeof import('@/lib/flywheel/portal').loadGoogleMetrics>> | null; configured: boolean; orgAccount: string; justConnected: boolean; error: string | null }) {
	const connected = conn?.status === 'connected';
	return (
		<div className="space-y-4">
			<Box title="Google Analytics, Search Console & Business Profile">
				<p className="text-sm text-slate-600 mb-3">Connect with a real Google sign-in so we can read rankings and traffic for your Flywheel pages. We never ask for passwords; you can disconnect any time.</p>
				{justConnected && <div className="mb-3 rounded-md border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">Connected. Pick the property, site and location below.</div>}
				{error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
				{!configured ? (
					<p className="text-sm text-amber-700">Google sign-in is not configured on our side yet. Until it is, you can invite <strong>{orgAccount || 'our Google account'}</strong> as a viewer on Analytics, Search Console and Business Profile instead.</p>
				) : connected ? (
					<div className="text-sm text-slate-700 space-y-1">
						<p>
							Connected as <strong>{conn?.google_email}</strong> on {d(conn?.connected_at)}.{conn?.last_pull_at ? ` Last pull ${d(conn.last_pull_at)}.` : ''}
						</p>
						{conn?.last_error && <p className="text-red-700 text-xs">{conn.last_error}</p>}
						<form action="/api/portal/google/disconnect" method="post">
							<button type="submit" className={btnGhost}>
								Disconnect
							</button>
						</form>
					</div>
				) : (
					<a href="/api/portal/google/start" className={btn}>
						Connect Google
					</a>
				)}
				{orgAccount && configured && (
					<p className="text-xs text-slate-500 mt-3">
						Prefer not to connect? Invite <strong>{orgAccount}</strong> as a viewer on each property and tell your strategist.
					</p>
				)}
			</Box>
			{connected && assets && (
				<Box title="Which property, site and location?">
					{assets.error && <p className="text-xs text-red-700 mb-2">{assets.error}</p>}
					<Form action={selectGoogleAssets} success="Saved and pulled the first 28 days." className="space-y-2 text-sm">
						<label className="block">
							<span className="text-xs text-slate-600">Analytics (GA4) property</span>
							<select name="ga4" defaultValue={conn?.ga4_property_id ?? ''} className={input}>
								<option value="">—</option>
								{assets.ga4.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</label>
						<label className="block">
							<span className="text-xs text-slate-600">Search Console site</span>
							<select name="sc" defaultValue={conn?.sc_site_url ?? ''} className={input}>
								<option value="">—</option>
								{assets.sc.map((s) => (
									<option key={s.url} value={s.url}>
										{s.url}
									</option>
								))}
							</select>
						</label>
						<label className="block">
							<span className="text-xs text-slate-600">Business Profile location</span>
							<select name="gbp" defaultValue={''} className={input}>
								<option value="">—</option>
								{assets.gbp.map((g) => (
									<option key={g.id} value={g.id}>
										{g.name}
									</option>
								))}
							</select>
						</label>
						<button type="submit" className={btn}>
							Save
						</button>
					</Form>
				</Box>
			)}
			{metrics?.period && (
				<Box title={`Last 28 days (${metrics.period.from} → ${metrics.period.to})`}>
					{metrics.ga4_total && (
						<div className="grid gap-3 sm:grid-cols-3 text-sm mb-3">
							<Stat label="Sessions" v={String(metrics.ga4_total.sessions ?? 0)} />
							<Stat label="Users" v={String(metrics.ga4_total.users ?? 0)} />
							<Stat label="Engaged sessions" v={String(metrics.ga4_total.engaged ?? 0)} />
						</div>
					)}
					{metrics.sc_queries.length > 0 && (
						<>
							<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Top search queries</h3>
							<table className="w-full text-xs">
								<tbody className="divide-y divide-slate-200">
									{metrics.sc_queries.map((q) => (
										<tr key={q.key}>
											<td className="py-1 pr-2 text-slate-800">{q.key}</td>
											<td className="py-1 pr-2 text-slate-600">{q.metrics.clicks} clicks</td>
											<td className="py-1 pr-2 text-slate-600">{q.metrics.impressions} impr.</td>
											<td className="py-1 text-slate-600">#{Number(q.metrics.position).toFixed(1)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</>
					)}
				</Box>
			)}
		</div>
	);
}

function Stat({ label, v }: { label: string; v: string }) {
	return (
		<div>
			<p className="text-2xs uppercase tracking-wide text-slate-500">{label}</p>
			<p className="text-lg font-semibold text-slate-900">{v}</p>
		</div>
	);
}
function pct(v: number | null): string {
	return v == null ? '—' : `${v}%`;
}
