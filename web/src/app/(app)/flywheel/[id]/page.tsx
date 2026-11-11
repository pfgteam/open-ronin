// /flywheel/[id] — one program: the Cluster Tracker, team + lanes, intake
// gaps, facts, clusters (plan + pages), monthly seed videos, deliverables,
// timeline, settings. Tabs via ?tab=.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadAudit, loadAuditAnswers, loadDrafts, loadFlywheelConfig, loadFlywheelContracts, loadIntake, loadMyRoles, loadOnboarding, loadPortalStaff, loadProgram, loadProgramAgents, loadTeamPickList } from '@/lib/flywheel/server';
import VisibilityTab from './VisibilityTab';
import { DraftCard, RunAgentButton } from '../ProductionPanels';
import { DiscoverKeywordsButton, RosterPanel } from './RosterPanel';
import { GoogleStatusPanel, PortalUsersPanel, StaffApprovalsPanel, StaffNotesPanel } from '../PortalPanels';
import { loadAgents } from '@/lib/flywheel/production';
import { hasCapability } from '@/lib/permissions/capabilities';
import { aiConfigured } from '@/lib/flywheel/ai';
import type { IntakeQuestion } from '@/lib/flywheel/intake';
import { ExtractPanel, IntakePanel, OnboardingChecklist } from './OnboardingPanels';
import { CLUSTER_STATUS_LABELS, DELIVERABLE_STATUS_COLORS, DELIVERABLE_STATUS_LABELS, LANE_ROLES, MEMBER_ROLE_LABELS, PAGE_STATUS_LABELS, PLAN_STATUS_COLORS, PLAN_STATUS_LABELS, PROGRAM_STATUS_COLORS, PROGRAM_STATUS_LABELS, TEAM_ROLES, VIDEO_STATUS_LABELS, clusterProgress, fmtCents, intakeGaps } from '@/lib/flywheel/shared';
import { formatDate, formatRelative } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';
import ProgramForm from '../ProgramForm';
import { ClusterPanel, DeliverableForm, FactsPanel, MembersPanel, NewClusterForm, NewVideoForm, StatusControls } from './Panels';
import ImportPanel from './ImportPanel';
import { loadImportState, serviceAccountEmail, sheetsConfigured } from '@/lib/flywheel/importServer';

export const dynamic = 'force-dynamic';

type Tab = 'overview' | 'onboarding' | 'visibility' | 'clusters' | 'drafts' | 'portal' | 'videos' | 'deliverables' | 'import' | 'timeline' | 'settings';
const TABS: { key: Tab; label: string }[] = [
	{ key: 'overview', label: 'Overview' },
	{ key: 'onboarding', label: 'Onboarding' },
	{ key: 'visibility', label: 'AI visibility' },
	{ key: 'clusters', label: 'Clusters & pages' },
	{ key: 'drafts', label: 'Drafts' },
	{ key: 'portal', label: 'Client portal' },
	{ key: 'videos', label: 'Seed videos' },
	{ key: 'deliverables', label: 'Deliverables' },
	{ key: 'import', label: 'Import' },
	{ key: 'timeline', label: 'Timeline' },
	{ key: 'settings', label: 'Settings' },
];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const supabase = await createClient();
	const b = await loadProgram(supabase, id).catch(() => null);
	return { title: b ? `${b.client_name} · Flywheel` : 'Flywheel' };
}

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; cluster?: string; run?: string }> }) {
	const { id } = await params;
	const sp = await searchParams;
	if (id === 'new') redirect('/flywheel/new');
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const bundle = await loadProgram(supabase, id);
	if (!bundle) notFound();
	const { program, client_name, members, clusters, pages, citations, facts, videos, deliverables, events } = bundle;
	const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'overview';
	const pkg = config.packages.find((p) => p.key === program.package_key);
	const gaps = intakeGaps(program, facts.filter((f) => f.status !== 'retired').length);
	const open = clusters.find((c) => c.status !== 'closed') ?? clusters[clusters.length - 1] ?? null;
	const progress = open ? clusterProgress(open, pages.filter((p) => p.cluster_id === open.id), citations.filter((c) => c.cluster_id === open.id)) : null;
	const people = tab === 'overview' || tab === 'settings' || tab === 'onboarding' || tab === 'drafts' ? await loadTeamPickList(supabase) : [];
	const [onboarding, intake] = tab === 'onboarding' ? await Promise.all([loadOnboarding(supabase, program), loadIntake(supabase, id)]) : [null, null];
	const audit = tab === 'visibility' ? await loadAudit(supabase, id) : null;
	const pickedRun = tab === 'visibility' && sp.run && audit?.runs.some((r) => r.id === sp.run) ? sp.run : null;
	const answers = pickedRun ? await loadAuditAnswers(supabase, pickedRun) : [];
	const contracts = tab === 'settings' ? await loadFlywheelContracts(supabase) : [];
	const [agents, myRolesMap, canManage] = tab === 'drafts' || tab === 'clusters' || tab === 'visibility' || tab === 'overview' || tab === 'onboarding' ? await Promise.all([loadAgents(supabase), loadMyRoles(supabase, profile.id), profile.role === 'admin' || profile.role === 'exec' ? Promise.resolve(true) : hasCapability('manage_flywheel')]) : [[], new Map(), false];
	const drafts = tab === 'drafts' ? await loadDrafts(supabase, id) : [];
	const myRoles = myRolesMap.get(id) ?? [];
	const agentOf = (kind: string) => agents.find((a) => a.output_kind === kind && a.is_active) ?? null;
	const aiOn = aiConfigured();
	const roster = tab === 'overview' ? await loadProgramAgents(supabase, id) : [];
	const portal = tab === 'portal' ? await loadPortalStaff(supabase, program.client_id, id) : null;
	const importState = tab === 'import' ? await loadImportState(supabase, id) : null;

	return (
		<>
			<PageHeader
				title={client_name}
				description={`${pkg?.label ?? program.package_key}${program.label ? ` · ${program.label}` : ''}${program.is_internal_pilot ? ' · internal pilot' : ''} · setup ${fmtCents(program.setup_fee_cents)} · ${fmtCents(program.monthly_fee_cents)}/mo${program.first_set_live_on ? ` from ${formatDate(program.first_set_live_on)}` : ' (billing not started)'}`}
				actions={
					<div className="flex items-center gap-2">
						<Badge color={PROGRAM_STATUS_COLORS[program.status]}>{PROGRAM_STATUS_LABELS[program.status]}</Badge>
						<Link href={`/clients/${program.client_id}/packages`}>
							<Button variant="ghost" size="sm">
								Client page
							</Button>
						</Link>
						<Link href="/flywheel">
							<Button variant="ghost" size="sm">
								All programs
							</Button>
						</Link>
					</div>
				}
			/>

			<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 mb-4 overflow-x-auto">
				{TABS.map((t) => (
					<Link key={t.key} href={`/flywheel/${id}?tab=${t.key}`} className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${tab === t.key ? 'border-primary-600 text-primary-900 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
						{t.label}
					</Link>
				))}
			</div>

			{tab === 'overview' && (
				<div className="grid gap-4 lg:grid-cols-3">
					<div className="lg:col-span-2 space-y-4">
						{gaps.length > 0 && (
							<Callout tone="warning">
								Intake incomplete: {gaps.join(', ')}. The SOP says do not schedule the audit or the shoot until every item is confirmed. <Link href={`/flywheel/${id}?tab=settings`} className="underline">Fill in</Link>.
							</Callout>
						)}
						<Card>
							<div className="flex items-center justify-between mb-2">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cluster Tracker</h2>
								<Link href={`/flywheel/${id}?tab=clusters`} className="text-xs text-primary-600 hover:underline">
									Open clusters
								</Link>
							</div>
							{!open || !progress ? (
								<p className="text-sm text-slate-500">No cluster yet. Scaffold cluster 1 (10 pages from the package scope) on the Clusters tab.</p>
							) : (
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
									<Kv k="Cluster" v={`#${open.number} ${open.anchor_keyword ?? ''}`} />
									<Kv k="Plan" v={<Badge color={PLAN_STATUS_COLORS[open.plan_status]}>{PLAN_STATUS_LABELS[open.plan_status]}</Badge>} />
									<Kv k="Day" v={progress.day != null ? `${progress.day} / ${progress.days_total} (${progress.pct_time}%)` : 'not started'} />
									<Kv k="Re-audit due" v={open.reaudit_due_on ? formatDate(open.reaudit_due_on) : '—'} />
									<Kv k="Pages live" v={`${progress.pages_live} / ${progress.pages_total} (${progress.pct_pages}%)`} />
									<Kv k="Pages approved" v={`${progress.pages_approved} / ${progress.pages_total}`} />
									<Kv k="Citations shipped" v={`${progress.citations_shipped} / ${progress.citations_target} (${progress.pct_citations}%)`} />
									<Kv k="Waves past 72 h" v={progress.waves_overdue ? <Badge color="danger">{progress.waves_overdue}</Badge> : '0'} />
								</div>
							)}
							{progress?.behind && <Callout tone="error" className="mt-3">Behind plan: delivery lags elapsed time by more than 15 points or a citation wave is past 72 h. F7 turns this into a health factor + bells.</Callout>}
						</Card>
						<Card>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Scope of record</h2>
							{pkg?.scope?.per_month ? (
								<div className="grid gap-2 sm:grid-cols-3 text-xs text-slate-600 dark:text-slate-400">
									<div><span className="font-medium text-slate-800 dark:text-slate-200">Per month:</span> {pkg.scope.per_month.pages_min}–{pkg.scope.per_month.pages_max} pages, {pkg.scope.per_month.citations_min}–{pkg.scope.per_month.citations_max} citations, AI re-scan, report + {pkg.scope.per_month.report_call_minutes}-min call</div>
									<div><span className="font-medium text-slate-800 dark:text-slate-200">Per 90-day cluster:</span> {pkg.scope.per_cluster?.seed_videos} seed video (monthly recording), {pkg.scope.per_cluster?.pages} pages, {pkg.scope.per_cluster?.citations_min}–{pkg.scope.per_cluster?.citations_max} citations, full re-audit</div>
									<div><span className="font-medium text-slate-800 dark:text-slate-200">Client owes:</span> plan approval in {pkg.sla?.plan_business_days} business days, content in {pkg.sla?.content_business_days}, SME 60 min, 30-min monthly call, news + angles</div>
								</div>
							) : (
								<p className="text-xs text-slate-500">{pkg?.description}</p>
							)}
						</Card>
						<FactsPanel programId={id} facts={facts} min={pkg?.scope?.facts_min ?? 6} max={pkg?.scope?.facts_max ?? 10} />
					</div>
					<div className="space-y-4">
						<StatusControls program={program} />
						<RosterPanel programId={id} agents={agents} roster={roster} />
						<MembersPanel programId={id} members={members} people={people} roles={TEAM_ROLES} title="Delivery team" />
						<MembersPanel programId={id} members={members} people={people} roles={LANE_ROLES} title="Approval lanes" />
						<Card>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Client</h2>
							<dl className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
								<div><dt className="inline font-medium text-slate-800 dark:text-slate-200">Brand:</dt> <dd className="inline">{program.brand_name ?? '—'}</dd></div>
								<div><dt className="inline font-medium text-slate-800 dark:text-slate-200">URL:</dt> <dd className="inline">{program.primary_url ? <a href={program.primary_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{program.primary_url}</a> : '—'}</dd></div>
								<div><dt className="inline font-medium text-slate-800 dark:text-slate-200">Competitors:</dt> <dd className="inline">{program.competitors.join(', ') || '—'}</dd></div>
								<div><dt className="inline font-medium text-slate-800 dark:text-slate-200">Keywords:</dt> <dd className="inline">{program.keywords.join(', ') || '—'}</dd></div>
								<div><dt className="inline font-medium text-slate-800 dark:text-slate-200">SME:</dt> <dd className="inline">{program.sme_name ?? '—'}{program.sme_email ? ` · ${program.sme_email}` : ''}</dd></div>
								<div><dt className="inline font-medium text-slate-800 dark:text-slate-200">Auto-approve:</dt> <dd className="inline">plans {program.auto_approve.plans.enabled ? `on (${program.auto_approve.plans.business_days} d)` : 'off'} · content {program.auto_approve.content.enabled ? `on (${program.auto_approve.content.business_days} d)` : 'off'}</dd></div>
							</dl>
						</Card>
					</div>
				</div>
			)}

			{tab === 'onboarding' && onboarding && intake && (
				<div className="grid gap-4 lg:grid-cols-3">
					<div className="lg:col-span-2 space-y-4">
						<OnboardingChecklist program={program} onboarding={onboarding} people={people} />
					</div>
					<div className="space-y-4">
						<IntakePanel program={program} sessions={intake.sessions} script={((config.settings.intake_script ?? []) as IntakeQuestion[])} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'} />
						<ExtractPanel program={program} extracts={intake.extracts} calls={intake.calls} aiOn={aiOn} />
						<Card>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Keyword discovery from the site</h2>
							<p className="text-xs text-slate-500 mb-2">Crawls the home page + top linked pages, counts the strongest terms (titles / headings weighted), and the keyword scout ranks them into hypotheses. Lands as a draft; apply adds them to the program.</p>
							<DiscoverKeywordsButton programId={id} aiOn={aiOn} hasUrl={!!program.primary_url} />
						</Card>
						{(program.keyword_hypotheses.length > 0 || program.angles_md) && (
							<Card>
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">From the intake</h2>
								{program.keyword_hypotheses.length > 0 && (
									<ul className="text-xs text-slate-700 dark:text-slate-300 list-disc pl-4 space-y-0.5 mb-2">
										{program.keyword_hypotheses.slice(0, 20).map((h, i) => (
											<li key={i}>
												<span className="font-medium">{h.keyword}</span>
												{h.why ? ` — ${h.why}` : ''}
											</li>
										))}
									</ul>
								)}
								{program.angles_md && <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{program.angles_md}</p>}
							</Card>
						)}
					</div>
				</div>
			)}

			{tab === 'visibility' && audit && (
				<>
					{audit.latest && agentOf('visibility_report') && (
						<div className="mb-3">
							<RunAgentButton programId={id} targetId={audit.latest.id} agent={agentOf('visibility_report')!} aiOn={aiOn} label={`AI: ${agentOf('visibility_report')!.persona ?? 'Ava'} writes the client report for the latest run`} />
						</div>
					)}
					<VisibilityTab program={program} bundle={audit} clusters={clusters} answers={answers} pickedRun={pickedRun} lockedTarget={Number((pkg?.scope?.audit?.prompts ?? 10))} aiOn={aiOn} />
				</>
			)}

			{tab === 'clusters' && (
				<div className="space-y-4">
					<NewClusterForm programId={id} nextNumber={(clusters[clusters.length - 1]?.number ?? 0) + 1} />
					{clusters.length === 0 && <p className="text-sm text-slate-500">No clusters yet.</p>}
					{[...clusters].reverse().map((c) => (
						<div key={c.id} className="space-y-2">
							<ClusterPanel programId={id} cluster={c} pages={pages.filter((p) => p.cluster_id === c.id)} citations={citations.filter((x) => x.cluster_id === c.id)} videos={videos} channels={config.channels} expanded={sp.cluster ? sp.cluster === c.id : c.id === open?.id} />
							{c.status !== 'closed' && (agentOf('keyword_research') || agentOf('plan')) && (
								<div className="flex flex-wrap gap-2 pl-1">
									{agentOf('keyword_research') && <RunAgentButton programId={id} targetId={c.id} agent={agentOf('keyword_research')!} aiOn={aiOn} />}
									{agentOf('plan') && <RunAgentButton programId={id} targetId={c.id} agent={agentOf('plan')!} aiOn={aiOn} notes />}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			{tab === 'portal' && portal && (
				<div className="grid gap-4 lg:grid-cols-3">
					<div className="lg:col-span-2 space-y-4">
						<PortalUsersPanel clientId={program.client_id} programId={id} users={portal.users} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'} contacts={portal.contacts} />
						<StaffApprovalsPanel programId={id} approvals={portal.approvals} />
						<StaffNotesPanel notes={portal.notes} programId={id} />
					</div>
					<div className="space-y-4">
						<GoogleStatusPanel clientId={program.client_id} programId={id} conn={portal.conn} />
						<Card>
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">What the client sees</h2>
							<ul className="text-xs text-slate-600 dark:text-slate-400 list-disc pl-4 space-y-0.5">
								<li>Packages tab: every deliverable marked “client sees”</li>
								<li>Approvals: plans / pages set to “awaiting client”, with their auto-approve toggle</li>
								<li>Trackers: clusters, pages (body only once sent), citation ledger, facts</li>
								<li>AI visibility: done runs + the approved Ava report</li>
								<li>Media, reports, calls, billing (contracts, payments, signed PDFs)</li>
								<li>Requests & ideas, library uploads, recording checklist + upload, Google connections</li>
								<li>Never: internal notes, team names beyond the strategist, costs, drafts before “awaiting client”</li>
							</ul>
						</Card>
					</div>
				</div>
			)}

			{tab === 'drafts' && (
				<div className="space-y-3">
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Drafts</h2>
						<p className="text-xs text-slate-500">
							Every AI or hand-written asset passes: draft → lane review ({MEMBER_ROLE_LABELS.lane_flywheel.replace('Approval lane: ', '')} / writers / pubs / SMM) → verification (Gabi) → approved → applied to its page / citation / plan / script. Agents: {agents.filter((a) => a.is_active).map((a) => `${a.persona ?? a.label}${a.is_placeholder ? ' (placeholder)' : ''}`).join(', ')}. Run them from the cluster, page and video pages; the <Link href="/flywheel/inbox" className="text-primary-600 hover:underline">review inbox</Link> collects what is waiting on you.
						</p>
					</Card>
					{drafts.length === 0 ? (
						<p className="text-sm text-slate-500">No drafts yet.</p>
					) : (
						drafts.map((d) => <DraftCard key={d.id} draft={d} programId={id} myRoles={myRoles} canManage={canManage} people={people} />)
					)}
				</div>
			)}

			{tab === 'videos' && (
				<div className="space-y-4">
					<Callout tone="info">Alex&apos;s decision: the seed video is a monthly recording (replaces the SOP&apos;s once per cluster). One row per month; the checklist is the SOP&apos;s Day 14–21 production steps.</Callout>
					<NewVideoForm programId={id} clusters={clusters} />
					{videos.length === 0 ? (
						<p className="text-sm text-slate-500">No recordings planned yet.</p>
					) : (
						<Card>
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{videos.map((v) => {
									const done = v.checklist.filter((c) => c.done).length;
									return (
										<li key={v.id} className="py-2 flex items-center justify-between gap-3 text-sm">
											<div className="min-w-0">
												<Link href={`/flywheel/${id}/videos/${v.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
													{formatDate(v.month).replace(/^\d+ /, '')} · {v.title ?? 'Seed video'}
												</Link>
												<div className="text-2xs text-slate-500">
													{v.chapters.length} chapters · checklist {done}/{v.checklist.length}{v.shoot_at ? ` · shoot ${formatDate(v.shoot_at)}` : ''}{v.youtube_url ? ' · on YouTube' : ''}
												</div>
											</div>
											<Badge color={v.status === 'published' ? 'success' : v.status === 'planned' ? 'default' : 'primary'}>{VIDEO_STATUS_LABELS[v.status]}</Badge>
										</li>
									);
								})}
							</ul>
						</Card>
					)}
				</div>
			)}

			{tab === 'deliverables' && (
				<div className="space-y-4">
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Deliverables</h2>
						<p className="text-xs text-slate-500 mb-3">Pages, plans and recordings mirror here automatically. Add manual rows for audits, reports, calls and the technical foundation (F3/F6 automate those).</p>
						<DeliverableForm clientId={program.client_id} programId={id} packageKey={program.package_key} kinds={pkg?.deliverable_kinds ?? ['custom']} />
					</Card>
					<Card>
						{deliverables.length === 0 ? (
							<p className="text-sm text-slate-500">Nothing yet.</p>
						) : (
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
										<th className="py-1.5 pr-3">Month</th>
										<th className="py-1.5 pr-3">Kind</th>
										<th className="py-1.5 pr-3">Title</th>
										<th className="py-1.5 pr-3">Status</th>
										<th className="py-1.5 pr-3">Due</th>
										<th className="py-1.5">Delivered</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
									{deliverables.map((d) => (
										<tr key={d.id}>
											<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{d.period_month ? d.period_month.slice(0, 7) : '—'}</td>
											<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{d.kind}</td>
											<td className="py-1.5 pr-3 text-slate-900 dark:text-slate-100">{d.href ? <Link href={d.href} className="hover:underline">{d.title}</Link> : d.title}{!d.visible_to_client && <span className="ml-1 text-2xs text-slate-500">(internal)</span>}</td>
											<td className="py-1.5 pr-3"><Badge color={DELIVERABLE_STATUS_COLORS[d.status]}>{DELIVERABLE_STATUS_LABELS[d.status]}</Badge></td>
											<td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{d.due_on ? formatDate(d.due_on) : '—'}</td>
											<td className="py-1.5 text-slate-600 dark:text-slate-400">{d.delivered_at ? formatDate(d.delivered_at) : '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</Card>
				</div>
			)}

			{tab === 'timeline' && (
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Timeline</h2>
					{events.length === 0 ? (
						<p className="text-sm text-slate-500">Nothing yet.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{events.map((e) => (
								<li key={e.id} className="py-1.5 text-xs flex items-start justify-between gap-3">
									<span className="text-slate-700 dark:text-slate-300">
										<span className="font-mono text-slate-500 mr-2">{e.kind}</span>
										{e.summary}
										{e.client_visible && <span className="ml-1 text-2xs text-slate-500">(client sees)</span>}
									</span>
									<span className="text-slate-500 whitespace-nowrap" title={e.created_at}>
										{formatRelative(e.created_at)}
									</span>
								</li>
							))}
						</ul>
					)}
				</Card>
			)}

			{tab === 'import' && importState && (
				<ImportPanel
					programId={id}
					trackerSheetUrl={program.tracker_sheet_url}
					sheetsConfigured={sheetsConfigured()}
					serviceAccountEmail={serviceAccountEmail()}
					batches={importState.batches}
					review={importState.review}
					imported={importState.imported}
					clusters={clusters.map((c) => ({ id: c.id, number: c.number, anchor_keyword: c.anchor_keyword }))}
				/>
			)}
			{tab === 'settings' && (
				<Card>
					<ProgramForm program={program} packages={config.packages} contracts={contracts} clients={[{ id: program.client_id, name: client_name }]} />
				</Card>
			)}
			{tab === 'clusters' && clusters.length > 0 && (
				<p className="mt-4 text-2xs text-slate-500">
					Cluster statuses: {Object.values(CLUSTER_STATUS_LABELS).join(' → ')}. Page statuses: {Object.values(PAGE_STATUS_LABELS).join(' → ')}.
				</p>
			)}
		</>
	);
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div>
			<p className="text-2xs uppercase tracking-wide text-slate-500">{k}</p>
			<div className="text-sm text-slate-900 dark:text-slate-100">{v}</div>
		</div>
	);
}
