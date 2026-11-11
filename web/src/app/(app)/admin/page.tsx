// /admin — Admin overview hub. Quick links to every admin module.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import {
	Bot,
	Users,
	Shield,
	Plug,
	Workflow,
	Palette,
	UserSearch,
	UserCog,
	Activity,
	FileSearch,
	DollarSign,
	Fingerprint,
	HeartPulse,
	Contact as ContactIcon,
	Target as TargetIcon,
	Tags,
	Paintbrush,
	Gauge,
	SlidersHorizontal,
	Cpu,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Admin' };

export const dynamic = 'force-dynamic';

const TILES = [
	// Sheet "Alex draft (original)" row 124, Platform › Admin Overview:
	// "Design System settings, AI spend limits, Connections" on screen; "the
	// panel for settings/tools in every area not on the menus".
	{
		href: '/admin/design-system',
		icon: Paintbrush,
		title: 'Design System settings',
		description: 'Fonts, colour tokens, buttons, radius, identity',
	},
	{
		href: '/admin/providers',
		icon: Gauge,
		title: 'AI spend limits',
		description: 'Daily caps and today’s spend per AI provider',
	},
	{
		href: '/admin/settings',
		icon: SlidersHorizontal,
		title: 'Module settings',
		description: 'Every tool’s settings page in one index',
	},
	{
		href: '/admin/work-engine',
		icon: Cpu,
		title: 'Work Engine',
		description: 'One queue for every job and approval',
	},
	{
		href: '/admin/users',
		icon: Users,
		title: 'Users',
		description: 'Invite, deactivate, change roles',
	},
	{
		href: '/admin/people-managers',
		icon: UserCog,
		title: 'People Managers',
		description: 'Who can see compensation, PAP and HR notes',
	},
	{
		href: '/admin/roles',
		icon: Shield,
		title: 'Roles & Permissions',
		description: 'Role definitions and access controls',
	},
	{
		href: '/admin/identities',
		icon: Fingerprint,
		title: 'Spine Identities',
		description: 'Agent identities, MCP tokens, scope ceilings, hygiene flags',
	},
	{
		href: '/admin/bots',
		icon: Bot,
		title: 'Bots',
		description: 'Hermes profiles: model, tools, terminal, telemetry, agent — hermes setup from the UI',
	},
	{
		href: '/admin/tags',
		icon: Tags,
		title: 'Departments & Sub-Teams',
		description: 'The Work taxonomy — add, rename, re-parent, no deploy needed',
	},
	{
		href: '/admin/billing',
		icon: DollarSign,
		title: 'Billing & Finance',
		description: 'MRR, outstanding AR, payment risk',
	},
	{
		href: '/admin/audit',
		icon: FileSearch,
		title: 'Audit Log',
		description: 'Every write across the platform',
	},
	{
		href: '/admin/health-factors',
		icon: HeartPulse,
		title: 'Health Factors',
		description: 'Tune factor weights per package · Engagement sub-section',
	},
	{
		href: '/contacts',
		icon: ContactIcon,
		title: 'Contacts',
		description: 'Unified directory with role types · GHL bridge',
	},
	{
		href: '/prospects',
		icon: TargetIcon,
		title: 'Prospects',
		description: 'Revenue Engine: pipelines, deals, people, brands · settings at /admin/prospects',
	},
	{
		href: '/admin/integrations',
		icon: Plug,
		title: 'Connections',
		description: 'Airtable, Supabase, Google, Resend status',
	},
	{
		href: '/admin/automations',
		icon: Workflow,
		title: 'Automations',
		description: 'Connections + cron schedules — inventory under Tools',
	},
	{
		href: '/admin/brand',
		icon: Palette,
		title: 'Brand',
		description: 'Logo, colors, theme defaults',
	},
	{
		// Settings for the scraper (budget cap, presets, cost per 1,000). The
		// tool itself runs from Tools -> Lead Scraper. The old /admin/media-scraper
		// stub redirects here.
		href: '/admin/lead-scraper',
		icon: UserSearch,
		title: 'Scraper settings',
		description: 'Budget cap, presets, spend — tool lives under Tools',
	},
	{
		href: '/admin/airtable-test',
		icon: Activity,
		title: 'Airtable diagnostic',
		description: 'End-to-end connectivity test',
	},
];

export default async function AdminOverviewPage() {
	const supabase = await createClient();
	const [{ count: userCount }, { count: sourceCount }, { count: auditCount }] =
		await Promise.all([
			supabase.from('profiles').select('*', { count: 'exact', head: true }),
			supabase.from('sheet_sources').select('*', { count: 'exact', head: true }),
			supabase
				.from('audit_log')
				.select('*', { count: 'exact', head: true })
				.gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
		]);

	return (
		<>
			<PageHeader title="Admin" description="Platform configuration, integrations, and audit" />

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
				<MiniStat label="Users" value={String(userCount ?? 0)} />
				<MiniStat label="Sheet sources" value={String(sourceCount ?? 0)} />
				<MiniStat label="Audit events (7d)" value={String(auditCount ?? 0)} />
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{TILES.map(({ href, icon: Icon, title, description }) => (
					<Link
						key={href}
						href={href}
						className="block p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
					>
						<div className="flex items-start gap-3">
							<div className="w-8 h-8 rounded-md bg-primary-50 dark:bg-primary-950 flex items-center justify-center shrink-0">
								<Icon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
							</div>
							<div className="min-w-0">
								<p className="font-medium text-sm text-slate-900 dark:text-slate-100">
									{title}
								</p>
								<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
									{description}
								</p>
							</div>
						</div>
					</Link>
				))}
			</div>
		</>
	);
}

function MiniStat({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
			<p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
				{value}
			</p>
		</Card>
	);
}
