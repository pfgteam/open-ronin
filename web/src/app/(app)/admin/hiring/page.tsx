// /admin/hiring — Hiring module settings (manage_hiring): the pay ladder,
// brand About Us / Remuneration blocks, the application consent text, the
// board catalog and the careers page (0129).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadBoards, loadCareersSettings, loadCatalogs, loadDiscQuestions, loadHiringConfig, loadMessageTemplates, loadOnboardingTemplates, loadScorecardQuestions } from '@/lib/hiring/server';
import NotAppliedCard from '@/app/(app)/hiring/NotAppliedCard';
import { BrandsTab, ConsentTab, PayLadderTab } from './Tabs';
import { BoardsTab, CareersTab } from './H2Tabs';
import ScoringTab from './ScoringTab';
import InterviewsTab from './InterviewsTab';
import OnboardingTab from './OnboardingTab';
import { adaptersFor } from '@/lib/providers/registry';

export const metadata = { title: 'Hiring · Admin' };
export const dynamic = 'force-dynamic';

type Tab = 'pay' | 'brands' | 'consent' | 'boards' | 'careers' | 'scoring' | 'interviews' | 'onboarding';
const TABS: { key: Tab; label: string }[] = [
	{ key: 'pay', label: 'Pay ladder' },
	{ key: 'brands', label: 'Brands' },
	{ key: 'boards', label: 'Job boards' },
	{ key: 'careers', label: 'Careers page' },
	{ key: 'scoring', label: 'Scoring & enrichment' },
	{ key: 'interviews', label: 'Interviews & templates' },
	{ key: 'onboarding', label: 'Onboarding' },
	{ key: 'consent', label: 'Consent & senders' },
];

export default async function AdminHiringPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage, catalogs] = await Promise.all([loadHiringConfig(supabase), hasCapability('manage_hiring'), loadCatalogs(supabase)]);
	if (config.notApplied) return <NotAppliedCard />;
	const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'pay';
	const boards = tab === 'boards' ? await loadBoards(supabase) : [];
	const careers = tab === 'careers' ? await loadCareersSettings(supabase) : null;
	const [questions, templates] = tab === 'interviews' ? await Promise.all([loadScorecardQuestions(supabase), loadMessageTemplates(supabase)]) : [[], []];
	const [onbTemplates, discQ] = tab === 'onboarding' ? await Promise.all([loadOnboardingTemplates(supabase), loadDiscQuestions(supabase)]) : [[], []];
	const referral = (config.settings.referral_bonus ?? {}) as { enabled?: boolean; amount_cents?: number; paid_after_days?: number; note?: string | null };
	return (
		<>
			<PageHeader
				title="Hiring settings"
				description="Pay ladder (V2 Pay System), brand blurbs for postings, job boards, the careers page, applicant consent. Changes apply immediately."
				actions={
					<Link href="/hiring">
						<Button variant="ghost" size="sm">
							Open Hiring
						</Button>
					</Link>
				}
			/>
			<div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
				{TABS.map((t) => (
					<Link key={t.key} href={`/admin/hiring?tab=${t.key}`} className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${tab === t.key ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
						{t.label}
					</Link>
				))}
			</div>
			{tab === 'pay' && <PayLadderTab config={config} canManage={canManage} tracks={catalogs.tracks} />}
			{tab === 'brands' && <BrandsTab config={config} canManage={canManage} />}
			{tab === 'boards' && <BoardsTab boards={boards} canManage={canManage} />}
			{tab === 'careers' && careers && <CareersTab careers={careers} referral={{ enabled: !!referral.enabled, amount_cents: referral.amount_cents ?? 0, paid_after_days: referral.paid_after_days ?? 90, note: referral.note ?? null }} canManage={canManage} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'} />}
			{tab === 'consent' && <ConsentTab config={config} canManage={canManage} />}
			{tab === 'interviews' && <InterviewsTab questions={questions} templates={templates} canManage={canManage} />}
			{tab === 'onboarding' && <OnboardingTab templates={onbTemplates} discCount={discQ.length} />}
			{tab === 'scoring' && <ScoringTab scoring={config.settings.scoring ?? {}} enrich={config.settings.enrichment ?? {}} canManage={canManage} apifyReady={!!process.env.APIFY_TOKEN} textReady={adaptersFor('generate_text').some((a) => a.isConfigured())} transcribeReady={adaptersFor('transcribe').some((a) => a.isConfigured())} />}
		</>
	);
}
