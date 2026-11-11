// /admin/flywheel — Flywheel settings (manage_flywheel): package templates
// (scope of record, fees, SLA), the 8-channel citation template, the
// execution rules, senders, SLA days.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadFlywheelConfig } from '@/lib/flywheel/server';
import NotAppliedCard from '@/app/(app)/flywheel/NotAppliedCard';
import { ChannelsTab, PackagesTab, SettingsTab } from './Tabs';
import AiPanelTab, { type ConnView } from './AiPanelTab';
import AgentsTab from './AgentsTab';
import { loadAgents } from '@/lib/flywheel/production';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { loadConnection } from '@/lib/flywheel/audit';
import type { AiModelRow } from '@/lib/flywheel/shared';

export const metadata = { title: 'Flywheel · Admin' };
export const dynamic = 'force-dynamic';

type Tab = 'packages' | 'channels' | 'ai' | 'agents' | 'rules' | 'senders';
const TABS: { key: Tab; label: string }[] = [
	{ key: 'packages', label: 'Package templates' },
	{ key: 'channels', label: '8-channel template' },
	{ key: 'ai', label: 'AI panel (Nous)' },
	{ key: 'agents', label: 'Agents (Chris)' },
	{ key: 'rules', label: 'SLA & execution rules' },
	{ key: 'senders', label: 'Senders & metrics' },
];

export default async function AdminFlywheelPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadFlywheelConfig(supabase), hasCapability('manage_flywheel')]);
	if (config.notApplied) return <NotAppliedCard />;
	const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'packages';
	let conn: ConnView | null = null;
	let models: AiModelRow[] = [];
	if (tab === 'ai') {
		const c = canManage ? await loadConnection(createServiceRoleClient()) : null;
		conn = c ? { is_enabled: c.is_enabled, has_key: !!c.encrypted_api_key, base_url: c.base_url, monthly_cap_usd: c.monthly_cap_usd, spend_month: c.spend_month, spend_month_usd: c.spend_month_usd, judge_model: c.judge_model, max_tokens: c.max_tokens, concurrency: c.concurrency, last_models_sync_at: c.last_models_sync_at, last_ok_at: c.last_ok_at, last_error: c.last_error } : null;
		const { data } = await supabase.from('fw_ai_models').select('*').order('is_core', { ascending: false }).order('vendor').order('id');
		models = (data ?? []) as AiModelRow[];
	}
	return (
		<>
			<PageHeader
				title="Flywheel settings"
				description="Scope of record per package, the fixed 8-channel citation template, client SLA days, execution rules. Changes apply immediately."
				actions={
					<Link href="/flywheel">
						<Button variant="ghost" size="sm">
							Open Flywheel
						</Button>
					</Link>
				}
			/>
			{!canManage && <Callout tone="info" className="mb-4">Read-only: editing needs the manage_flywheel capability (admin/exec hold it).</Callout>}
			<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 mb-4 overflow-x-auto">
				{TABS.map((t) => (
					<Link key={t.key} href={`/admin/flywheel?tab=${t.key}`} className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${tab === t.key ? 'border-primary-600 text-primary-900 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
						{t.label}
					</Link>
				))}
			</div>
			{tab === 'packages' && <PackagesTab packages={config.packages} canManage={canManage} />}
			{tab === 'channels' && <ChannelsTab channels={config.channels} canManage={canManage} />}
			{tab === 'agents' && <AgentsTab agents={await loadAgents(supabase)} canManage={canManage} />}
			{tab === 'ai' && <AiPanelTab conn={conn} models={models} canManage={canManage} encReady={!!process.env.GHL_TOKEN_ENC_KEY} />}
			{tab === 'rules' && (
				<div className="space-y-4">
					<SettingsTab settingKey="sla" title="Client SLA days" value={config.settings.sla} canManage={canManage} hint="plan_approval_business_days 3 · content_approval_business_days 2 · citation_wave_hours 72 (SOP §7). The program's auto-approve toggle uses these as defaults." />
					<SettingsTab settingKey="execution_rules" title="Execution rules (every asset)" value={config.settings.execution_rules} canManage={canManage} hint="F4 checks each draft against these: verbatim keyword, brand URL, full brand name, one fact, non-promotional on Reddit / Quora, varied phrasing, cross-links." />
					<SettingsTab settingKey="video_checklist" title="Monthly recording checklist" value={config.settings.video_checklist} canManage={canManage} hint="Copied onto every new fw_videos row." />
					<SettingsTab settingKey="intake_script" title="Conversational intake script" value={config.settings.intake_script} canManage={canManage} hint="One question per step: key (maps to the program field), ask, type text | url | email | long | list | multi, required, min, options. Internal run + the client portal share it." />
					<SettingsTab settingKey="audit" title="AI visibility audit" value={config.settings.audit} canManage={canManage} hint="core_families (one per family flagged core on sync), panel_exclude_patterns, panel_max, prompts_locked (10), answer_system (what every panel model is asked), judge_system (the scorer), reaudit_days (90)." />
					<SettingsTab settingKey="prompt_rules" title="Prompt library · shared rules" value={config.settings.prompt_rules} canManage={canManage} hint="Prepended to every agent run: rules_md (answer-first Quick Answer, question H2s, FAQ for schema, no fabricated facts → [INSERT EPISODE DETAIL], quotes under 15 words, output = SEO title + meta + anchor texts) and banned_phrases. Per-client voice / brand-facts / CTA blocks live on each program's Settings tab; the base article prompt and the channel variants (Medium listicle, Quora answer, …) under Agents." />
				</div>
			)}
			{tab === 'senders' && (
				<div className="space-y-4">
					<SettingsTab settingKey="senders" title="Senders" value={config.settings.senders} canManage={canManage} hint="Friday recap + monthly report go out from this address through Resend (F6)." />
					<SettingsTab settingKey="metrics" title="Metrics" value={config.settings.metrics} canManage={canManage} hint="primary metric + list. Chris 9/23: page authority / traffic > prompt matching; keep configurable." />
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Module access</h2>
						<p className="text-xs text-slate-600 dark:text-slate-400">
							Every role sees Flywheel (the matrix row seeded by 0136) — change it in <Link href="/admin/roles" className="text-primary-600 hover:underline">Admin → Roles</Link>. Settings + deletes need <Badge>manage_flywheel</Badge> (<Link href="/admin/capabilities" className="text-primary-600 hover:underline">Capabilities</Link>).
						</p>
					</Card>
				</div>
			)}
		</>
	);
}
