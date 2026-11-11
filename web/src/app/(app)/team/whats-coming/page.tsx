// /team/whats-coming: the single honest list of modules that exist on the
// roadmap but are not functional yet. These pages are hidden from the nav
// (honest nav rule: no dead ends) and this page replaces the dead links they
// used to occupy. Update it when a module ships or enters development.
//
// Two lists, on purpose. The first is the WIP build (WIP_BUILD_PLAN.md):
// each module leaves this list in the PR that ships it, as part of that
// module's done test. The second is everything that waits for the unified
// comms build; those stay here until that build lands.
//
// The six Social stubs deleted on September 9 are gone from this list; the
// Content Studio replaces them. Keep this list in sync with the `wip` flags
// in components/nav/navConfig.ts.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { Hourglass } from 'lucide-react';

interface UpcomingModule {
	name: string;
	summary: string;
}

interface UpcomingGroup {
	area: string;
	modules: UpcomingModule[];
}

interface UpcomingSection {
	title: string;
	note: string;
	groups: UpcomingGroup[];
}

const sections: UpcomingSection[] = [
	{
		title: 'In this build',
		note: 'Being built now, one module per pull request. A module disappears from this list the day its page goes live in the nav.',
		groups: [
			{
				area: 'Clients',
				modules: [
					{ name: 'Analytics', summary: 'Portfolio and per client placement trends, secured versus goal, payment timeliness.' },
				],
			},
			{
				area: 'Media',
				modules: [
					{ name: 'Pitch Ideation', summary: 'Angle workspace fed by the client keywords, message house and awareness days.' },
				],
			},
			{
				area: 'Data',
				modules: [
					{ name: 'Pipeline builder', summary: 'Visual pull/transform/push builder on top of the Data -> Pipeline inventory that already lists every running pipeline.' },
				],
			},
			{
				area: 'Admin',
				modules: [
					{ name: 'Native automation rules', summary: 'Rule builder (trigger, steps, run log) joining the Tools -> Automations inventory, which already lists Vercel cron and n8n.' },
					{ name: 'Media Scraper', summary: 'Shipped at Tools -> Media Scraper; the review queue goes live once migration 0102 is applied.' },
				],
			},
		],
	},
	{
		title: 'With the comms build',
		note: 'These depend on the unified communications layer (chat, portals, sequences) and arrive together when that build lands. Social Listening has no build scheduled yet and is listed here so it is not forgotten.',
		groups: [
			{
				area: 'Team',
				modules: [
					{ name: 'Chat', summary: 'Channels, DMs and the first in app agents.' },
				],
			},
			{
				area: 'Clients',
				modules: [
					{ name: 'Portals', summary: 'Client facing portal access.' },
					{ name: 'Reports', summary: 'Client facing report generation.' },
					{ name: 'Contacts', summary: 'The directory stays; the comms build adds conversations and history per contact.' },
					{ name: 'Prospects', summary: 'The pipeline stays; the comms build adds outreach and sequences.' },
					{ name: 'Social Listening', summary: 'Mentions and sentiment per client. Not scheduled in either build yet.' },
				],
			},
			{
				area: 'Media',
				modules: [
					{ name: 'Requests', summary: 'Inbound media request intake.' },
					{ name: 'Build Lists', summary: 'Targeted media list building.' },
					{ name: 'Autopitch', summary: 'Assisted pitch drafting and sending.' },
					{ name: 'Send Pitch', summary: 'Outbound pitch delivery and tracking.' },
					{ name: 'DM Strategy', summary: 'Outbound DM playbooks and tracking.' },
				],
			},
			{
				area: 'Data',
				modules: [
					{ name: 'Form routing', summary: 'Route form submissions (already collected by Data -> Forms) into Airtable, tables or notifications via Pipeline.' },
				],
			},
			{
				area: 'Admin',
				modules: [
					{ name: 'Connections', summary: 'Admin, Connections works today. The comms build adds the Slack, Discord and Meta bridges to it.' },
				],
			},
		],
	},
];

function countModules(section: UpcomingSection): number {
	return section.groups.reduce((n, g) => n + g.modules.length, 0);
}

export default function WhatsComingPage() {
	return (
		<>
			<PageHeader
				title="What's Coming"
				description="Modules on the roadmap that are not functional yet. They stay out of the navigation until they ship, so everything in the menus works. When a module goes live it appears in the nav and in the weekly release notes."
			/>

			<div className="space-y-8">
				{sections.map((section) => (
					<section key={section.title}>
						<div className="flex items-center gap-2 mb-3">
							<h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								{section.title}
							</h2>
							<span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
								{countModules(section)}
							</span>
							<div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/60" />
						</div>
						<p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-2xl">{section.note}</p>
						<div className="grid gap-4 md:grid-cols-2">
							{section.groups.map((group) => (
								<Card key={`${section.title}-${group.area}`}>
									<div className="flex items-center gap-2 mb-3">
										<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
											{group.area}
										</h3>
										<Badge color="default">{group.modules.length}</Badge>
									</div>
									<ul className="space-y-2.5">
										{group.modules.map((mod) => (
											<li key={mod.name} className="flex items-start gap-2.5">
												<Hourglass className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
												<div className="min-w-0">
													<p className="text-sm font-medium text-slate-800 dark:text-slate-200">
														{mod.name}
													</p>
													<p className="text-xs text-slate-500 dark:text-slate-400">{mod.summary}</p>
												</div>
											</li>
										))}
									</ul>
								</Card>
							))}
						</div>
					</section>
				))}
			</div>
		</>
	);
}
