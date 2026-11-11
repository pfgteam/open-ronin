// /hiring/positions/[id]/applications/[appId] — one application: the
// candidate, integrity signals, every answer with its typing/paste meta,
// files (signed URLs), other applications by the same person, review panel.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadApplication, loadApplicationIntel, loadDocumentTemplates, loadHiringConfig, loadMessageTemplates, loadOffer, loadPipeline, loadPosition, loadScorecardQuestions, loadScorecardRules, loadStaff, loadStagesFor } from '@/lib/hiring/server';
import { activeSignatureProvider } from '@/lib/revenue/esign';
import { OWNER_ID } from '@/lib/permissions/constants';
import { aiConfigured } from '@/lib/hiring/ai';
import type { ApplicationConfig } from '@/lib/hiring/application';
import { formatDate, formatRelative } from '@/lib/format';
import NotAppliedCard from '../../../../NotAppliedCard';
import { APP_STATUS_LABELS } from '../Controls';
import { FileLink, ReviewPanel } from './Controls';
import { ScoreOneBar } from '../ScoreControls';
import { InterviewCard, InterviewForm, MessagePanel, PortalLinkButton, StageMover } from './Pipeline';
import OfferPanel from './OfferPanel';
import { hasCapability } from '@/lib/permissions/capabilities';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({ params }: { params: Promise<{ id: string; appId: string }> }) {
	const { id, appId } = await params;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadHiringConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const [position, data, staff, intel, pipeline, questions, rules, templates, canManage, offerData, docTemplates] = await Promise.all([loadPosition(supabase, id), loadApplication(supabase, appId), loadStaff(supabase), loadApplicationIntel(supabase, appId), loadPipeline(supabase, appId), loadScorecardQuestions(supabase), loadScorecardRules(supabase), loadMessageTemplates(supabase), hasCapability('manage_hiring'), loadOffer(supabase, appId), loadDocumentTemplates(supabase)]);
	if (!position || !data || data.app.position_id !== position.id) notFound();
	const stages = await loadStagesFor(supabase, { interview_config: position.interview_config });
	const canReview = canManage || position.hiring_manager_id === profile.id || position.recruiter_id === profile.id;
	const canSeeComp = profile.role === 'admin' || profile.role === 'exec' || position.hiring_manager_id === profile.id || canManage;
	const nextInterviewStage = stages.stages.find((s) => s.key === data.app.stage_key)?.interview_kind ? data.app.stage_key : (stages.stages.find((s) => s.interview_kind)?.key ?? null);
	const { app, answers, files, others } = data;
	const c = app.candidate;
	const name = new Map(staff.map((s) => [s.id, s.name]));
	const snapshot = app.config_snapshot as unknown as ApplicationConfig;
	const sections = Array.isArray(snapshot?.sections) ? snapshot.sections : [];
	const bySection = new Map<string, typeof answers>();
	for (const a of answers) bySection.set(a.section_key, [...(bySection.get(a.section_key) ?? []), a]);
	const flags: string[] = Array.isArray(app.integrity_notes) ? (app.integrity_notes as string[]) : [];
	if (app.ai_text_flags) flags.push(`${app.ai_text_flags} answer${app.ai_text_flags === 1 ? '' : 's'} read as AI-written (heuristic)`);
	const fmtValue = (v: unknown, type: string) => {
		if (v == null || v === '') return '—';
		if (type === 'boolean') return v === true ? 'Yes' : 'No';
		if (Array.isArray(v)) return v.join(', ');
		if (type === 'rating_1_5') return `${v} / 5`;
		return String(v);
	};

	return (
		<>
			<PageHeader
				title={c?.full_name ?? 'Candidate'}
				description={`${position.title} · applied ${formatRelative(app.submitted_at)} via ${app.source ?? 'direct'}${app.referrer_user_id ? ` (referred by ${name.get(app.referrer_user_id) ?? 'a team member'})` : ''}`}
				actions={
					<div className="flex items-center gap-2">
						<Badge color={app.status === 'rejected' ? 'danger' : app.status === 'hired' ? 'success' : 'primary'}>{APP_STATUS_LABELS[app.status] ?? app.status}</Badge>
						<Link href={`/hiring/positions/${position.id}/applications`}>
							<Button variant="ghost" size="sm">
								All applications
							</Button>
						</Link>
					</div>
				}
			/>
			<Card className="mb-4 space-y-2">
				<div className="flex items-center gap-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Stage</h2>
					<span className="text-2xs text-slate-500">click to move · owners and interviewers are set per role on the Stages tab</span>
				</div>
				<StageMover id={app.id} positionId={position.id} current={app.stage_key ?? stages.stages.find((s) => s.status_key === app.status)?.key ?? null} stages={stages} />
			</Card>
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-4">
					<Card className="space-y-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Contact</h2>
						<dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
							<Row k="Email" v={c?.email} />
							<Row k="Phone" v={c?.phone_e164 ?? c?.phone} />
							<Row k="Location" v={[c?.location_text, c?.country].filter(Boolean).join(', ') || null} />
							<Row k="Timezone" v={c?.timezone} />
							<Row k="LinkedIn" v={c?.linkedin_url} link />
							<Row k="Current" v={c?.current_title} />
							{c?.portfolio_urls?.length ? <Row k="Links" v={c.portfolio_urls.join(' · ')} /> : null}
							{c?.video_url && <Row k="Video" v={c.video_url} link />}
							<Row k="Consent" v={c?.consented_at ? `v${c.consent_version} · ${formatDate(c.consented_at)}` : '—'} />
						</dl>
						{files.length > 0 && (
							<div className="flex flex-wrap gap-2 pt-1">
								{files.map((f) => (
									<FileLink key={f.id} path={f.path} label={`${f.kind}${f.original_name ? ` · ${f.original_name}` : ''}${f.size_bytes ? ` (${Math.round(f.size_bytes / 1024)} KB)` : ''}`} />
								))}
							</div>
						)}
					</Card>

					<Card className="space-y-2">
						<div className="flex items-center gap-2">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Integrity</h2>
							{flags.length === 0 ? <Badge color="success">clean</Badge> : <Badge color="warning">{flags.length} flag{flags.length === 1 ? '' : 's'}</Badge>}
							{app.integrity_score != null && <Badge>{app.integrity_score}/100</Badge>}
						</div>
						<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
							{flags.map((f, i) => (
								<li key={i}>• {f}</li>
							))}
							<li>
								• {app.sessions_count} session{app.sessions_count === 1 ? '' : 's'} · {app.total_time_s != null ? `${Math.round(app.total_time_s / 60)} min total` : 'time unknown'} · typed {app.typed_chars} chars{app.pasted_chars ? ` · pasted ${app.pasted_chars}` : ''}
							</li>
						</ul>
						{app.honeypot_followup && (
							<div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-900 dark:text-amber-200">
								<span className="font-medium">Honeypot follow-up:</span> {app.honeypot_followup}
							</div>
						)}
					</Card>

					<Card className="space-y-3">
						<div className="flex items-center gap-2">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Interviews</h2>
							<span className="text-2xs text-slate-500">{pipeline.interviews.length} · culture fit → job fit → final panel + presentation</span>
						</div>
						{pipeline.interviews.map((iv) => (
							<InterviewCard key={iv.id} interview={iv} applicationId={app.id} positionId={position.id} stages={stages} people={staff} questions={questions} rules={rules} cards={pipeline.scorecards.filter((s) => s.interview_id === iv.id)} meId={profile.id} canReview={canReview} />
						))}
						{canReview && (
							<details className="rounded-md border border-dashed border-slate-300 dark:border-slate-600 p-3">
								<summary className="cursor-pointer text-sm text-slate-700 dark:text-slate-300">+ Schedule an interview</summary>
								<div className="mt-3">
									<InterviewForm applicationId={app.id} positionId={position.id} stages={stages} people={staff} interview={null} defaultStage={nextInterviewStage} />
								</div>
							</details>
						)}
					</Card>
					<MessagePanel applicationId={app.id} positionId={position.id} messages={pipeline.messages} templates={templates} interviews={pipeline.interviews} hasPhone={!!c?.phone_e164} />
					{c && (
						<OfferPanel
							applicationId={app.id}
							positionId={position.id}
							candidateId={c.id}
							candidateEmail={c.email}
							offer={offerData.offer}
							documents={offerData.documents}
							provisioning={offerData.provisioning}
							templates={docTemplates}
							people={staff}
							config={config}
							isOwner={profile.id === OWNER_ID || profile.role === 'admin'}
							canEdit={canReview}
							canSeeComp={canSeeComp}
							defaultManagerId={position.hiring_manager_id}
							defaultLevel={position.pay_level}
							defaultMultiplier={null}
							providerLabel={activeSignatureProvider().label}
							providerReady={activeSignatureProvider().id !== 'manual'}
						/>
					)}
					{(sections.length ? sections.map((s) => ({ key: s.key, title: s.title })) : [...bySection.keys()].map((k) => ({ key: k, title: k }))).map((s) => {
						const list = bySection.get(s.key) ?? [];
						if (!list.length) return null;
						return (
							<Card key={s.key} className="space-y-3">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.title}</h2>
								{list.map((a) => (
									<div key={a.id} className="space-y-1">
										<div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
											<span className="font-medium text-slate-700 dark:text-slate-300">{a.label ?? a.question_key}</span>
											{a.is_honeypot && <Badge color={Number(a.value) >= 3 ? 'danger' : 'default'}>honeypot</Badge>}
											{a.paste_events > 0 && <Badge color="warning">{a.pasted_chars} pasted / {a.paste_events} paste{a.paste_events === 1 ? '' : 's'}</Badge>}
											{a.blocked_paste_attempts > 0 && <Badge color="warning">{a.blocked_paste_attempts} blocked</Badge>}
											{a.time_used_s != null && <span>{a.time_used_s}s</span>}
											{a.ai_text_score != null && a.ai_text_score >= 0.7 && <Badge color="warning">AI-text {Math.round(a.ai_text_score * 100)}%</Badge>}
										</div>
										{a.question_type === 'file' || (a.question_type === 'video' && String(a.value ?? '').startsWith('sessions/')) ? (
											<FileLink path={String(a.value)} label={a.question_type === 'video' ? 'Play recording' : 'Open file'} />
										) : a.question_type === 'video' || a.question_type === 'url' ? (
											<a href={String(a.value)} target="_blank" rel="noreferrer" className="text-sm text-primary-600 hover:underline break-all">
												{String(a.value)}
											</a>
										) : (
											<p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{fmtValue(a.value, a.question_type)}</p>
										)}
									</div>
								))}
							</Card>
						);
					})}
				</div>
				<div className="space-y-4">
					<Card className="space-y-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Review</h2>
						<ReviewPanel id={app.id} positionId={position.id} status={app.status} notes={app.reviewer_notes_md} hidden={app.hidden} rejectedReason={app.rejected_reason} />
						{c && <PortalLinkButton candidateId={c.id} applicationId={app.id} positionId={position.id} />}
						{app.decided_at && (
							<p className="text-2xs text-slate-500">
								Decided {formatRelative(app.decided_at)} by {app.decided_by ? name.get(app.decided_by) ?? '—' : '—'}
							</p>
						)}
					</Card>
					<Card className="space-y-2">
						<div className="flex items-center gap-2">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI assessment</h2>
							{app.score_version > 0 && <Badge>v{app.score_version}</Badge>}
							{app.shortlist_rank != null && <Badge color="accent">#{app.shortlist_rank}</Badge>}
						</div>
						<ScoreOneBar id={app.id} positionId={position.id} scored={app.scored_at != null} aiReady={aiConfigured()} />
						{app.overall_score != null && (
							<>
								<div className="text-sm">
									Overall <span className="font-mono">{app.overall_score}</span>
									{app.previous_overall != null && app.previous_overall !== app.overall_score && <span className="text-2xs text-slate-500"> (was {app.previous_overall})</span>} · Merit <span className="font-mono">{app.merit_score ?? '—'}</span> · Integrity <span className="font-mono">{app.integrity_score ?? '—'}</span>
								</div>
								{app.summary_line && <p className="text-sm text-slate-700 dark:text-slate-300">{app.summary_line}</p>}
								{app.top_strength && <p className="text-xs text-green-700 dark:text-green-400">+ {app.top_strength}</p>}
								{app.biggest_concern && <p className="text-xs text-amber-700 dark:text-amber-400">− {app.biggest_concern}</p>}
								<Breakdown b={app.score_breakdown} />
							</>
						)}
						{app.overall_score == null && (
							<p className="text-2xs text-slate-500">
								{aiConfigured() ? 'Not scored yet. The cron scores once enrichment settles (or 30 min after submit); or score now.' : 'Not scored: AI scoring is not configured in this deployment. Add ANTHROPIC_API_KEY or OPENAI_API_KEY in Vercel and the cron scores every unscored application on its next 10-minute tick.'}
							</p>
						)}
					</Card>
					<Card className="space-y-1">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Enrichment</h2>
						<ul className="text-xs space-y-1">
							{intel.jobs.length === 0 && <li className="text-slate-500">No links, resume or video to enrich.</li>}
							{intel.jobs.map((j) => (
								<li key={j.id} className="flex items-start gap-2">
									<Badge color={j.status === 'done' ? 'success' : j.status === 'failed' ? 'danger' : j.status === 'skipped' ? 'default' : 'warning'}>{j.kind}</Badge>
									<span className="min-w-0 text-slate-600 dark:text-slate-400">
										<span className="break-all">{j.target.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</span>
										{j.status === 'done' && j.kind === 'link' && j.result?.review ? <span className="block text-2xs">{String((j.result.review as { what_it_is?: string }).what_it_is ?? '')} · quality {String((j.result.review as { quality?: number }).quality ?? '—')}/5</span> : null}
										{j.status === 'done' && j.kind === 'resume' ? <span className="block text-2xs">{Number(j.result?.chars ?? 0)} chars parsed{j.result?.parsed ? ` · ${String((j.result.parsed as { summary?: string }).summary ?? '').slice(0, 120)}` : ''}</span> : null}
										{j.status === 'done' && j.kind === 'video' ? <span className="block text-2xs">{j.result?.transcript ? `${Number(j.result.words ?? 0)} words transcribed` : String(j.result?.note ?? 'link recorded')}</span> : null}
										{(j.status === 'skipped' || j.status === 'failed') && j.error ? <span className="block text-2xs">{j.error.replace(/^skipped:\s*/, '')}</span> : null}
									</span>
								</li>
							))}
						</ul>
						{intel.runs.length > 1 && <p className="text-2xs text-slate-500 pt-1">Scoring history: {intel.runs.map((r) => `v${r.version} ${r.overall_score ?? '—'}`).join(' · ')}</p>}
					</Card>
					<Card className="space-y-1">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Timeline</h2>
						<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5 max-h-64 overflow-auto">
							{pipeline.events.length === 0 && <li className="text-slate-500">No events yet.</li>}
							{pipeline.events.map((e) => (
								<li key={e.id}>
									<span className="text-slate-500">{formatRelative(e.created_at)}</span> · {e.summary}
									{e.actor_id && <span className="text-slate-500"> · {name.get(e.actor_id) ?? ''}</span>}
								</li>
							))}
						</ul>
					</Card>
					{others.length > 0 && (
						<Card className="space-y-1">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Also applied to</h2>
							<ul className="text-xs text-slate-600 dark:text-slate-400">
								{others.map((o) => (
									<li key={o.id}>
										<Link href={`/hiring/positions/${o.position_id}/applications/${o.id}`} className="hover:underline">
											{o.position_title}
										</Link>{' '}
										· {APP_STATUS_LABELS[o.status] ?? o.status} · {formatRelative(o.submitted_at)}
									</li>
								))}
							</ul>
						</Card>
					)}
				</div>
			</div>
		</>
	);
}

function Row({ k, v, link }: { k: string; v: string | null | undefined; link?: boolean }) {
	return (
		<div className="flex justify-between gap-3">
			<dt className="text-slate-500">{k}</dt>
			<dd className="text-right text-slate-800 dark:text-slate-200 break-all">
				{v ? (
					link ? (
						<a href={v} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
							{v.replace(/^https?:\/\/(www\.)?/, '')}
						</a>
					) : (
						v
					)
				) : (
					'—'
				)}
			</dd>
		</div>
	);
}

function Breakdown({ b }: { b: Record<string, unknown> | null }) {
	if (!b) return null;
	const cats = (b.categories as { key: string; label: string; weight: number; score: number; evidence: string | null }[] | undefined) ?? [];
	const pen = (b.integrity as { signal: string; n: number; impact: number }[] | undefined) ?? [];
	const mism = (b.claim_mismatches as { claim: string; conflict: string; severity: string }[] | undefined) ?? [];
	const rec = b.recommendation as string | undefined;
	return (
		<details className="text-xs">
			<summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
				Breakdown{rec ? ` · recommendation: ${rec}` : ''}
			</summary>
			<div className="mt-2 space-y-2">
				{cats.length > 0 && (
					<ul className="space-y-1">
						{cats.map((c) => (
							<li key={c.key}>
								<div className="flex justify-between gap-2">
									<span className="text-slate-700 dark:text-slate-300">{c.label}</span>
									<span className="font-mono text-slate-600 dark:text-slate-400">
										{c.score} × {c.weight}%
									</span>
								</div>
								{c.evidence && <div className="text-2xs text-slate-500">{c.evidence}</div>}
							</li>
						))}
					</ul>
				)}
				{pen.length > 0 && (
					<div>
						<div className="text-2xs uppercase tracking-wide text-slate-500">Integrity penalties</div>
						<ul className="text-2xs text-amber-700 dark:text-amber-400">
							{pen.map((p) => (
								<li key={p.signal}>
									−{p.impact} · {p.signal.replace(/_/g, ' ')} ×{p.n}
								</li>
							))}
						</ul>
					</div>
				)}
				{mism.length > 0 && (
					<div>
						<div className="text-2xs uppercase tracking-wide text-slate-500">Claim mismatches</div>
						<ul className="text-2xs text-slate-600 dark:text-slate-400">
							{mism.map((m, i) => (
								<li key={i}>
									<span className="font-medium">{m.severity}</span>: {m.claim} ↔ {m.conflict}
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</details>
	);
}
