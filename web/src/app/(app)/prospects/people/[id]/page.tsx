// /prospects/people/[id] — one person: channels, the brands/companies they
// sit on with a role, their deals, timeline, to-dos. Edit inline.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import AddProspectButton from '../../AddProspectButton';
import ScanAiButton from '../../ScanAiButton';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Pagination from '@/components/ui/Pagination';
import { TIMELINE_PAGE_SIZE, parsePage } from '@/lib/pagination';
import PageHeader from '@/components/ui/PageHeader';
import { formatDate, formatRelative } from '@/lib/format';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadConfig, loadGhlBaseUrl, loadPerson, loadStaff } from '@/lib/revenue/server';
import { ghlContactUrl } from '@/lib/revenue/ghlImport';
import { ACTIVITY_KIND_LABELS, PERSON_ROLE_LABELS, formatCents, scoreLabel } from '@/lib/revenue/shared';
import { hasCapability } from '@/lib/permissions/capabilities';
import NotAppliedCard from '../../NotAppliedCard';
import LinkPeopleCard from '../../LinkPeopleCard';
import PersonEditForm from './PersonEditForm';
import TaskList from '../../deals/[id]/TaskList';

export const dynamic = 'force-dynamic';
// Scan AI can wait on a LinkedIn run (~45 s) from a server action on this page.
export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string; tl?: string }> }) {
	const { id } = await params;
	const sp = await searchParams;
	if (!UUID.test(id)) notFound();
	const timelinePage = parsePage(sp.tl);
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, data, staff, ghlBase, ghlLoc, canManage] = await Promise.all([
		loadConfig(supabase),
		loadPerson(supabase, id, { timelinePage }),
		loadStaff(supabase),
		loadGhlBaseUrl(supabase),
		supabase.from('rev_people').select('ghl_location_id').eq('id', id).maybeSingle(),
		hasCapability('manage_revenue'),
	]);
	if (config.notApplied) return <NotAppliedCard />;
	if (!data) notFound();
	const { person, links, deals, activities, activitiesTotal, tasks } = data;
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
	const stageById = new Map(config.stages.map((s) => [s.id, s]));
	const pipelineById = new Map(config.pipelines.map((p) => [p.id, p]));
	const edit = sp.tab === 'edit';
	const ghlUrl = ghlContactUrl(ghlBase, (ghlLoc.data as { ghl_location_id: string | null } | null)?.ghl_location_id, person.ghl_contact_id);

	return (
		<>
			<PageHeader
				title={
					<span className="inline-flex items-center gap-2">
						{person.display_name}
						{person.do_not_contact && <Badge color="danger">do not contact</Badge>}
					</span>
				}
				description={[person.title, links.map((l) => l.brand?.name ?? l.company?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Prospect'}
				actions={
					<>
						<Link href="/prospects/contacts">
							<Button variant="ghost" size="sm">
								All contacts
							</Button>
						</Link>
						<ScanAiButton target="person" id={person.id} />
						<Link href={`/prospects/people/${person.id}${edit ? '' : '?tab=edit'}`}>
							<Button variant="outline" size="sm">
								{edit ? 'Cancel' : 'Edit'}
							</Button>
						</Link>
					</>
				}
			/>
			{sp.error && (
				<Callout tone="error" className="mb-4">
					{sp.error}
				</Callout>
			)}
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-4">
					{edit ? (
						<PersonEditForm person={person} />
					) : (
						<>
							<Card className="space-y-3">
								<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Deals</h2>
								{deals.length === 0 ? (
									<p className="text-xs text-slate-500">
										No deals yet.{' '}
										<AddProspectButton person={person.id} className="text-primary-700 dark:text-primary-300 underline">
											Add prospect
										</AddProspectButton>
									</p>
								) : (
									<ul className="divide-y divide-slate-200 dark:divide-slate-700">
										{deals.map((d) => {
											const st = stageById.get(d.stage_id);
											const pl = pipelineById.get(d.pipeline_id);
											const v = (d.est_mrr_cents ?? 0) + (d.est_one_time_cents ?? 0);
											return (
												<li key={d.id} className="py-2 flex items-center gap-3 text-sm">
													<Link href={`/prospects/deals/${d.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline min-w-0 truncate">
														{d.title}
													</Link>
													<Badge color={d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'default'}>{st?.name ?? d.status}</Badge>
													<span className="text-xs text-slate-500">{pl?.name}</span>
													<span className="ml-auto text-xs font-mono text-slate-600 dark:text-slate-400">{scoreLabel(d.quality_score, d.heat_score)}</span>
													{v > 0 && <span className="text-xs tabular-nums text-slate-600 dark:text-slate-400">{formatCents(v)}</span>}
												</li>
											);
										})}
									</ul>
								)}
							</Card>
							<Card padding="none" id="timeline" className="scroll-mt-4">
								<div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
									<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Timeline</h2>
									<span className="text-2xs text-slate-500">{activitiesTotal.toLocaleString()} activit{activitiesTotal === 1 ? 'y' : 'ies'}</span>
								</div>
								{activities.length === 0 ? (
									<p className="px-4 py-6 text-sm text-slate-500">Nothing logged yet.</p>
								) : (
									<ul className="divide-y divide-slate-200 dark:divide-slate-700">
										{activities.map((a) => (
											<li key={a.id} className="px-4 py-3 flex gap-3">
												<div className="w-20 shrink-0 text-2xs text-slate-500 pt-0.5">
													<div>{formatRelative(a.occurred_at)}</div>
													<div className="text-slate-400">{formatDate(a.occurred_at, 'MMM d, HH:mm')}</div>
												</div>
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2 text-xs">
														<Badge color={a.is_positive ? 'success' : a.kind === 'stage_change' ? 'primary' : 'default'}>{ACTIVITY_KIND_LABELS[a.kind]}</Badge>
														{a.channel && <span className="text-slate-500">{a.channel}</span>}
														<span className="ml-auto text-slate-500">{a.actor_kind === 'human' ? (a.actor_id ? staffMap[a.actor_id] ?? 'Someone' : 'Someone') : a.actor_kind}</span>
													</div>
													{a.subject && <div className="text-sm text-slate-900 dark:text-slate-100 mt-1">{a.subject}</div>}
													{a.body_md && <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 whitespace-pre-wrap">{a.body_md}</div>}
													{a.deal_id && (
														<Link href={`/prospects/deals/${a.deal_id}`} className="text-2xs text-primary-700 dark:text-primary-300 hover:underline">
															open deal
														</Link>
													)}
												</div>
											</li>
										))}
									</ul>
								)}
								{activitiesTotal > TIMELINE_PAGE_SIZE && (
									<Pagination page={timelinePage} size={TIMELINE_PAGE_SIZE} total={activitiesTotal} hrefFor={(p) => `/prospects/people/${person.id}${p > 1 ? `?tl=${p}` : ''}#timeline`} />
								)}
							</Card>
						</>
					)}
				</div>
				<div className="space-y-4">
					<Card className="space-y-1.5 text-xs">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Channels</h2>
						<Row label="Email">{person.email ?? '—'}</Row>
						{person.emails.length > 0 && <Row label="Also">{person.emails.join(', ')}</Row>}
						<Row label="Phone">{person.phone ?? '—'}</Row>
						{person.phones.length > 0 && <Row label="Also">{person.phones.join(', ')}</Row>}
						<Row label="LinkedIn">
							{person.linkedin_url ? (
								<a href={person.linkedin_url} target="_blank" rel="noreferrer" className="text-primary-700 dark:text-primary-300 underline break-all">
									{person.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
								</a>
							) : (
								'—'
							)}
						</Row>
						<Row label="Instagram">{person.instagram ?? '—'}</Row>
						<Row label="Facebook">{person.facebook ?? '—'}</Row>
						<Row label="TikTok">{person.tiktok ?? '—'}</Row>
						<Row label="X">{person.x_handle ?? '—'}</Row>
						<Row label="Website">{person.website ?? '—'}</Row>
						<Row label="Location">{person.location ?? '—'}</Row>
						{person.ghl_contact_id && (
							<Row label="GHL">
								{ghlUrl ? (
									<a href={ghlUrl} target="_blank" rel="noreferrer" className="text-primary-700 underline dark:text-primary-300">
										Open in GHL
									</a>
								) : (
									'Linked'
								)}
							</Row>
						)}
						<Row label="Added">{formatDate(person.created_at)}</Row>
					</Card>
					<LinkPeopleCard
						mode="person"
						anchorId={person.id}
						canRemove={canManage}
						links={links.map((l) => ({
							id: l.id,
							person_id: person.id,
							brand_id: l.brand?.id ?? null,
							label: l.brand?.name ?? l.company?.name ?? 'Company',
							href: l.brand ? `/prospects/brands/${l.brand.id}` : null,
							sub: [PERSON_ROLE_LABELS[l.role], l.company && l.brand ? l.company.name : null].filter(Boolean).join(' · ') || null,
							is_primary: l.is_primary,
						}))}
					/>
					{person.notes_md && (
						<Card className="text-sm">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Notes</h2>
							<p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap text-xs">{person.notes_md}</p>
						</Card>
					)}
					<TaskList dealId={null} personId={person.id} tasks={tasks} staff={staffMap} />
				</div>
			</div>
		</>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-3">
			<span className="w-16 shrink-0 text-slate-500">{label}</span>
			<span className="text-slate-700 dark:text-slate-300 min-w-0 break-words">{children}</span>
		</div>
	);
}
