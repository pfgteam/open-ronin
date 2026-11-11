'use client';

// Per-program agent roster (F4b): which of Chris's agents run for this client
// and how the portal names them. Channel variants follow their parent.

import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import type { AgentRow } from '@/lib/flywheel/production';
import type { ProgramAgentRow } from '@/lib/flywheel/shared';
import ActionForm from '../ActionForm';
import { discoverKeywordsAction, setProgramAgent } from '../productionActions';

export function RosterPanel({ programId, agents, roster }: { programId: string; agents: AgentRow[]; roster: ProgramAgentRow[] }) {
	const tops = agents.filter((a) => !a.parent_key && a.is_active);
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Agent roster</h2>
			<p className="text-xs text-slate-500 mb-2">Which agents run for this client. The portal attributes client-visible output to the persona. Channel variants (Medium, Reddit…) follow the copywriter.</p>
			<ul className="divide-y divide-slate-200 dark:divide-slate-700">
				{tops.map((a) => {
					const r = roster.find((x) => x.agent_key === a.key);
					return (
						<li key={a.key} className="py-1.5">
							<ActionForm action={setProgramAgent} success={null} className="flex flex-wrap items-center gap-2 text-xs">
								<input type="hidden" name="program_id" value={programId} />
								<input type="hidden" name="agent_key" value={a.key} />
								<input type="hidden" name="enabled_present" value="1" />
								<input type="hidden" name="show_in_portal_present" value="1" />
								<label className="flex items-center gap-1">
									<Checkbox name="enabled" defaultChecked={r?.enabled ?? true} onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()} />
									<span className="font-medium text-slate-800 dark:text-slate-200">{a.persona ?? a.label}</span>
								</label>
								{a.is_placeholder && <Badge color="warning">placeholder</Badge>}
								<label className="flex items-center gap-1 text-slate-500">
									<Checkbox name="show_in_portal" defaultChecked={r?.show_in_portal ?? true} onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()} /> portal
								</label>
								<Input name="persona_override" placeholder="Persona shown to the client" defaultValue={r?.persona_override ?? ''} className="text-xs" />
								<Button type="submit" size="sm" variant="ghost">
									Save
								</Button>
							</ActionForm>
						</li>
					);
				})}
			</ul>
		</Card>
	);
}

export function DiscoverKeywordsButton({ programId, aiOn, hasUrl }: { programId: string; aiOn: boolean; hasUrl: boolean }) {
	return (
		<ActionForm action={discoverKeywordsAction} success="Site crawled — review the keyword scout draft in Drafts.">
			<input type="hidden" name="program_id" value={programId} />
			<Button type="submit" size="sm" variant="outline" disabled={!aiOn || !hasUrl} title={!hasUrl ? 'Set the primary URL first' : undefined}>
				AI: discover keywords from the site
			</Button>
		</ActionForm>
	);
}
