// /prospects/deals/[id] — one deal as a call workspace (spec 2026-10-20).
// A header shared by every tab (facts, stage with Undo, next action, Quality
// and Heat), then three tabs: Summary (Prep on the left; Log, Timeline and a
// collapsed Details on the right), Calls (brief, intel, calls) and Closing
// (contracts, presentation, documents). ?tab=edit swaps Summary for the form.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Callout from '@/components/ui/Callout';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadConfig, loadDeal, loadDealCalls, loadDealClosing, loadDealContext, loadGhlBaseUrl, loadStaff } from '@/lib/revenue/server';
import { ghlContactUrl } from '@/lib/revenue/ghlImport';
import { dealTab, headerFacts } from '@/lib/revenue/dealPage';
import { parsePage } from '@/lib/pagination';
import { slaState, stagesByPipeline } from '@/lib/revenue/shared';
import { activeSignatureProvider } from '@/lib/revenue/esign';
import { adaptersFor } from '@/lib/providers/registry';
import { zoomConfigured } from '@/lib/revenue/ai';
import { hasCapability } from '@/lib/permissions/capabilities';
import NotAppliedCard from '../../NotAppliedCard';
import DealHeader from './DealHeader';
import DealEditForm from './DealEditForm';
import PrepCard from './PrepCard';
import QualificationCard from './QualificationCard';
import CompanyCard from './CompanyCard';
import PeopleCard from './PeopleCard';
import TaskList from './TaskList';
import DealLogCard from './DealLogCard';
import Timeline from './Timeline';
import DetailsSection from './DetailsSection';
import ScoreCard from './ScoreCard';
import GhlCard from './GhlCard';
import { LaneHistory, SourceAndDates } from './DealFacts';
import CallsTab from './CallsTab';
import ClosingTab from './ClosingTab';

export const dynamic = 'force-dynamic';
// Scan AI (Company / People cards) can wait on a LinkedIn run from a server action.
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string; tl?: string }> }) {
	const { id } = await params;
	const sp = await searchParams;
	if (!UUID.test(id)) notFound();
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, deal, staff, canManage] = await Promise.all([loadConfig(supabase), loadDeal(supabase, id), loadStaff(supabase), hasCapability('manage_revenue')]);
	if (config.notApplied) return <NotAppliedCard />;
	if (!deal) notFound();
	const timelinePage = parsePage(sp.tl);
	const [ctx, callsCtx, closing, ghlBase] = await Promise.all([loadDealContext(supabase, deal, { timelinePage }),loadDealCalls(supabase, deal.id), loadDealClosing(supabase, deal.id), loadGhlBaseUrl(supabase)]);
	const pipeline = config.pipelines.find((p) => p.id === deal.pipeline_id) ?? null;
	const stages = stagesByPipeline(config.stages).get(deal.pipeline_id) ?? [];
	const stage = config.stages.find((s) => s.id === deal.stage_id) ?? null;
	const sla = stage ? slaState(stage, deal) : null;
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
	const who = (uid: string | null) => (uid ? staffMap[uid] ?? 'Someone' : 'System');
	const products = config.products.filter((p) => deal.product_ids.includes(p.id));
	const tab = dealTab(sp.tab);
	const esign = activeSignatureProvider();
	const aiReady = adaptersFor('generate_text').some((a) => a.isConfigured());
	const closingCount = closing.contracts.length + callsCtx.documents.length;
	const tabs: [string, string][] = [['summary', 'Summary'], ['calls', callsCtx.calls.length ? `Calls (${callsCtx.calls.length})` : 'Calls'], ['closing', closingCount ? `Closing (${closingCount})` : 'Closing']];
	const facts = headerFacts(deal, (uid) => (uid ? staffMap[uid] ?? null : null), ctx.person ? { title: ctx.person.title, email: ctx.person.email, phone: ctx.person.phone } : null);

	return (
		<>
			<DealHeader deal={deal} pipeline={pipeline} stage={stage} stages={stages} allStages={config.stages} pipelines={config.pipelines} sla={sla} facts={facts} tab={tab} />
			{sp.error && (
				<Callout tone="error" className="mb-4">
					{sp.error}
				</Callout>
			)}

			<div className="mb-4 flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
				{tabs.map(([k, label]) => (
					<Link
						key={k}
						href={k === 'summary' ? `/prospects/deals/${deal.id}` : `/prospects/deals/${deal.id}?tab=${k}`}
						aria-current={tab === k || (tab === 'edit' && k === 'summary') ? 'page' : undefined}
						className={
							tab === k || (tab === 'edit' && k === 'summary')
								? '-mb-px border-b-2 border-primary-600 px-3 py-2 text-sm font-semibold text-primary-700 dark:text-primary-300'
								: '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
						}
					>
						{label}
					</Link>
				))}
			</div>

			{tab === 'calls' && <CallsTab dealId={deal.id} personId={deal.primary_person_id} calls={callsCtx.calls} items={callsCtx.items} briefs={callsCtx.briefs} staff={staffMap} zoom={zoomConfigured()} aiReady={aiReady} brand={ctx.brand} person={ctx.person} />}
			{tab === 'closing' && <ClosingTab dealId={deal.id} dealTitle={deal.title} brandName={deal.brand_name} contracts={closing.contracts} presentations={closing.presentations} templates={closing.templates} products={config.products.filter((p) => p.is_active)} people={ctx.people.length ? ctx.people.map((l) => ({ person: l.person, role: l.role, is_primary: l.is_primary })) : ctx.person ? [{ person: ctx.person, role: 'decision_maker', is_primary: true }] : []} providerLabel={esign.label} providerIsManual={esign.id === 'manual'} canManage={canManage} aiReady={aiReady} documents={callsCtx.documents} staff={staffMap} />}

			{tab === 'edit' && <DealEditForm deal={deal} staff={staff} products={config.products} />}

			{tab === 'summary' && (
				<div className="grid gap-4 lg:grid-cols-2">
					{/* Mobile: logging comes first (spec §4). */}
					<div className="order-last space-y-4 lg:order-none">
						<PrepCard dealId={deal.id} brief={callsCtx.briefs[0] ?? null} aiReady={aiReady} />
						<QualificationCard deal={deal} />
						<CompanyCard dealId={deal.id} brand={ctx.brand} />
						<PeopleCard brandId={deal.brand_id} person={ctx.person} people={ctx.people} company={ctx.company} />
						<TaskList dealId={deal.id} personId={deal.primary_person_id} tasks={ctx.tasks} staff={staffMap} />
					</div>
					<div className="space-y-4">
						<DealLogCard dealId={deal.id} personId={deal.primary_person_id} nextAction={deal.next_action} nextActionAt={deal.next_action_at} dispositions={config.dispositions} />
						<Timeline
							activities={ctx.activities}
							total={ctx.activitiesTotal}
							page={timelinePage}
							hrefFor={(p) => `/prospects/deals/${deal.id}${p > 1 ? `?tl=${p}` : ''}#timeline`}
							dispositions={config.dispositions}
							touches30d={deal.touches_30d}
							who={who}
						/>
						<DetailsSection>
							<ScoreCard deal={deal} canEdit />
							<GhlCard deal={deal} canManage={canManage} ghlUrl={ghlContactUrl(ghlBase, deal.ghl_location_id, deal.ghl_contact_id)} />
							<LaneHistory history={ctx.history} stages={config.stages} pipelines={config.pipelines} who={who} />
							<SourceAndDates deal={deal} products={products} />
						</DetailsSection>
					</div>
				</div>
			)}
		</>
	);
}
