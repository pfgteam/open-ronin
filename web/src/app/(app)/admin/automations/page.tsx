// /admin/automations — settings for the Automations tool (Alex,
// 2026-09-14: settings under Admin, the tool under Tools). Connections
// (n8n), the cron secret's presence, and the schedule table as deployed;
// the working inventory with last runs is Tools -> Automations.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { cronEntries } from '@/lib/dev/cron';

export const metadata = { title: 'Automations settings' };
export const dynamic = 'force-dynamic';

function present(name: string) {
	return !!process.env[name];
}

export default function AutomationsAdminPage() {
	const crons = cronEntries();
	const envs = [
		{ name: 'CRON_SECRET', purpose: 'Gates every /api/cron/* route; without it every tick is refused (fails closed).' },
		{ name: 'N8N_API_URL', purpose: 'n8n base URL, so Tools → Automations lists its workflows.' },
		{ name: 'N8N_API_KEY', purpose: 'n8n API key; enable/disable/run need its permission.' },
	];
	return (
		<>
			<PageHeader
				title="Automations"
				description="Connections and schedules behind the automations inventory. The inventory itself (last run, status, links) is under Tools → Automations."
				actions={<Link href="/social/automations" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Open the tool →</Link>}
			/>
			<div className="space-y-4">
				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Connections</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">Set in Vercel (docs/ENV.md). Presence only — values are never shown.</p>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<tbody>
							{envs.map((e) => (
								<tr key={e.name} className="border-t border-slate-200 dark:border-slate-700">
									<td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{e.name}</td>
									<td className="px-3 py-2">{present(e.name) ? <Badge color="success">set</Badge> : <Badge color="warning">not set</Badge>}</td>
									<td className="px-3 py-2 text-slate-500">{e.purpose}</td>
								</tr>
							))}
						</tbody>
					</table>
					</div>
				</Card>

				<Card padding="none">
					<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Vercel cron schedules</h2>
						<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">From <code>web/vercel.json</code> in this deploy. Changing a schedule is a code change, by design (it ships with the route it drives).</p>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<tbody>
							{crons.map((c) => (
								<tr key={c.path} className="border-t border-slate-200 dark:border-slate-700">
									<td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300">{c.path}</td>
									<td className="px-3 py-2 font-mono text-slate-500">{c.schedule}</td>
								</tr>
							))}
						</tbody>
					</table>
					</div>
				</Card>

				<Card className="space-y-1">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Native rules</h2>
					<p className="text-xs text-slate-600 dark:text-slate-400">
						Scheduled and event-driven rules built in the app (trigger → steps → run log) are the Pipeline tool’s engine (WIP module 6, <code>automation_rules</code> v2). When it ships, its rules appear in the same inventory and their defaults (daily run cap, allowed tables) are set here.
					</p>
				</Card>
			</div>
		</>
	);
}
