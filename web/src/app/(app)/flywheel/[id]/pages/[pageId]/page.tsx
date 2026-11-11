// /flywheel/[id]/pages/[pageId] — one on-site page: the editor (keyword,
// chapter, body, quick answer, links), the status ladder, the 8-row
// citation checklist and the Citation Ledger rows for this page.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadPage } from '@/lib/flywheel/server';
import { PAGE_KIND_LABELS, PAGE_STATUS_COLORS, PAGE_STATUS_LABELS, pageChecklist } from '@/lib/flywheel/shared';
import { formatDate } from '@/lib/format';
import NotAppliedCard from '../../../NotAppliedCard';
import { CitationLedger, PageEditor } from './PagePanels';
import { DraftCard, DraftCitationsButton, RunAgentButton } from '../../../ProductionPanels';
import { loadAgents } from '@/lib/flywheel/production';
import { loadDrafts, loadMyRoles } from '@/lib/flywheel/server';
import { aiConfigured } from '@/lib/flywheel/ai';
import { hasCapability } from '@/lib/permissions/capabilities';

export const dynamic = 'force-dynamic';

export default async function PageDetail({ params }: { params: Promise<{ id: string; pageId: string }> }) {
	const { id, pageId } = await params;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const bundle = await loadPage(supabase, pageId);
	if (!bundle || bundle.page.program_id !== id) notFound();
	const { page, citations, facts } = bundle;
	const { data: people } = await supabase.from('profiles').select('id, first_name, last_name').eq('is_active', true).order('first_name');
	const checklist = pageChecklist(config.channels, citations);
	const overdue = page.live_at && !page.citation_wave_done_at && page.citation_wave_due_at && new Date(page.citation_wave_due_at) < new Date();
	const brandCheck = await supabase.from('fw_programs').select('brand_name, primary_url').eq('id', id).maybeSingle();
	const prog = (brandCheck.data as { brand_name: string | null; primary_url: string | null } | null) ?? null;
	const [agents, myRolesMap, canManage, pageDrafts] = await Promise.all([loadAgents(supabase), loadMyRoles(supabase, profile.id), profile.role === 'admin' || profile.role === 'exec' ? Promise.resolve(true) : hasCapability('manage_flywheel'), loadDrafts(supabase, id, { limit: 40 })]);
	const pageAgent = agents.find((a) => a.output_kind === 'page' && a.is_active) ?? null;
	const citIds = new Set(citations.map((c) => c.id));
	const mine = pageDrafts.filter((d) => d.target_id === pageId || citIds.has(d.target_id));
	const aiOn = aiConfigured();

	return (
		<>
			<PageHeader
				title={`Page ${page.number}: ${page.keyword}`}
				description={`${PAGE_KIND_LABELS[page.kind]} · ${page.word_target_min}–${page.word_target_max} words · chapter ${page.chapter_index ?? '—'}`}
				actions={
					<div className="flex items-center gap-2">
						<Badge color={PAGE_STATUS_COLORS[page.status]}>{PAGE_STATUS_LABELS[page.status]}</Badge>
						<Link href={`/flywheel/${id}?tab=clusters&cluster=${page.cluster_id}`}>
							<Button variant="ghost" size="sm">
								Back to cluster
							</Button>
						</Link>
					</div>
				}
			/>
			{overdue && <Callout tone="error" className="mb-4">Citation wave past 72 h: page went live {formatDate(page.live_at!)}, wave was due {formatDate(page.citation_wave_due_at!)}. Prioritise the 8-channel order so no channel is skipped.</Callout>}
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-4">
					<Card>
						<div className="flex flex-wrap items-center gap-2">
							{pageAgent && <RunAgentButton programId={id} targetId={page.id} agent={pageAgent} aiOn={aiOn} notes />}
							<DraftCitationsButton programId={id} pageId={page.id} aiOn={aiOn} planned={citations.filter((c) => c.status === 'planned' && !c.draft_md).length} />
							<span className="text-2xs text-slate-500">Drafts go to lane review → verification before anything is applied.</span>
						</div>
					</Card>
					<PageEditor page={page} programId={id} />
					{mine.length > 0 && (
						<div className="space-y-2">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Drafts for this page</h2>
							{mine.map((d) => (
								<DraftCard key={d.id} draft={d} programId={id} myRoles={myRolesMap.get(id) ?? []} canManage={canManage} />
							))}
						</div>
					)}
				</div>
				<div className="space-y-4">
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Page rules</h2>
						<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-4">
							<li>Meta title and H1 lead with the verbatim keyword</li>
							<li>Quick Answer block at the top (liftable verbatim)</li>
							<li>FAQ schema{page.kind === 'question' ? ' with the target question as H1' : ''}</li>
							<li>Embedded seed-video chapter</li>
							<li>{page.kind === 'pillar' ? '3 internal links to a core service / product page' : '2 internal links'}</li>
							<li>Brand name in full + URL in plain text{prog?.brand_name ? ` (${prog.brand_name})` : ''}</li>
						</ul>
					</Card>
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Citation checklist (8 channels)</h2>
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{checklist.map((row) => (
								<li key={row.channel.key} className="py-1.5 flex items-center justify-between text-xs">
									<span className="text-slate-700 dark:text-slate-300">
										{row.channel.label}
										{row.channel.non_promotional && <span className="ml-1 text-2xs text-slate-500">(non-promo)</span>}
									</span>
									<span className={row.done ? 'text-green-600 dark:text-green-400 font-medium' : 'text-slate-500'}>
										{row.shipped} / {row.target_min}
										{row.target_max > row.target_min ? `–${row.target_max}` : ''}
									</span>
								</li>
							))}
						</ul>
						<p className="text-2xs text-slate-500 mt-2">
							Target {page.target_citations ?? 20} per page · {citations.filter((c) => c.status === 'posted' || c.status === 'live').length} shipped
							{page.citation_wave_done_at ? ` · wave done ${formatDate(page.citation_wave_done_at)}` : page.citation_wave_due_at ? ` · due ${formatDate(page.citation_wave_due_at)}` : ''}
						</p>
					</Card>
				</div>
			</div>
			<div className="mt-4">
				<CitationLedger programId={id} page={page} citations={citations} channels={config.channels} facts={facts} people={((people ?? []) as { id: string; first_name: string | null; last_name: string | null }[]).map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' ') }))} />
			</div>
		</>
	);
}
