'use client';

// Admin → Flywheel → Agents (F4): Chris's agents as editable skill-md prompts
// (placeholders until Riley hands over the real ones). Edits are
// versioned; the history keeps the last 20 prompts.

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { AgentRow } from '@/lib/flywheel/production';
import { MEMBER_ROLE_LABELS, OUTPUT_KINDS } from '@/lib/flywheel/shared';
import ActionForm from '@/app/(app)/flywheel/ActionForm';
import { saveAgent } from '@/app/(app)/flywheel/productionActions';

// 0143 added humanize / site_keywords; a <Select> without the row's own kind
// silently submits the first option and rewrote those agents to 'plan'.
const KINDS = OUTPUT_KINDS;
const LANES = ['lane_flywheel', 'lane_writers', 'lane_pubs', 'lane_smm'] as const;

export default function AgentsTab({ agents, canManage }: { agents: AgentRow[]; canManage: boolean }) {
	const [editing, setEditing] = useState<string | null>(null);
	const current = agents.find((a) => a.key === editing) ?? null;
	const placeholders = agents.filter((a) => a.is_placeholder && a.is_active).length;
	return (
		<div className="space-y-4">
			{placeholders > 0 && (
				<Callout tone="warning">
					{placeholders} agent{placeholders === 1 ? '' : 's'} still run on placeholder prompts. When Riley hands over Chris&apos;s Silas / Kira / Ava (and the writer, script, editor and distribution prompts), paste each one here, untick &ldquo;placeholder&rdquo; and save — the version history keeps the old text.
				</Callout>
			)}
			<Card>
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{agents.map((a) => (
						<li key={a.key} className="py-2 flex items-start justify-between gap-3 text-sm">
							<div className="min-w-0">
								<div className="flex items-center gap-2 flex-wrap">
									<span className="font-medium text-slate-900 dark:text-slate-100">{a.persona ?? a.label}</span>
									<code className="text-2xs text-slate-500">{a.key}</code>
									<Badge>{a.output_kind}</Badge>
									<Badge color="primary">{MEMBER_ROLE_LABELS[a.lane].replace('Approval lane: ', '')}</Badge>
									{a.is_placeholder && <Badge color="warning">placeholder</Badge>}
									{!a.is_active && <Badge color="danger">inactive</Badge>}
									<span className="text-2xs text-slate-500">v{a.version}</span>
								</div>
								<p className="text-xs text-slate-600 dark:text-slate-400">{a.role_md}</p>
							</div>
							<Button type="button" size="sm" variant="ghost" onClick={() => setEditing(editing === a.key ? null : a.key)}>
								{editing === a.key ? 'Close' : canManage ? 'Edit' : 'View'}
							</Button>
						</li>
					))}
				</ul>
			</Card>
			{(current || canManage) && (
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{current ? `${current.persona ?? current.label} · v${current.version}` : 'New agent'}</h2>
					<ActionForm key={current?.key ?? 'new'} action={saveAgent} success="Agent saved (new version)." className="grid gap-3 md:grid-cols-4" onDone={() => setEditing(null)}>
						<input type="hidden" name="is_placeholder_present" value="1" />
						<input type="hidden" name="is_active_present" value="1" />
						<Input label="Key" name="key" defaultValue={current?.key ?? ''} readOnly={!!current || !canManage} required pattern="[a-z][a-z0-9_]{1,40}" />
						<Input label="Label" name="label" defaultValue={current?.label ?? ''} required readOnly={!canManage} />
						<Input label="Persona" name="persona" defaultValue={current?.persona ?? ''} placeholder="Silas (AEO Strategist)" readOnly={!canManage} />
						<Select label="Output" name="output_kind" defaultValue={current?.output_kind ?? 'other'} disabled={!canManage}>
							{KINDS.map((k) => (
								<option key={k} value={k}>
									{k}
								</option>
							))}
						</Select>
						<div className="md:col-span-2">
							<Input label="What it owns (one line)" name="role_md" defaultValue={current?.role_md ?? ''} readOnly={!canManage} />
						</div>
						<Select label="Approval lane" name="lane" defaultValue={current?.lane ?? 'lane_flywheel'} disabled={!canManage}>
							{LANES.map((l) => (
								<option key={l} value={l}>
									{MEMBER_ROLE_LABELS[l].replace('Approval lane: ', '')}
								</option>
							))}
						</Select>
						<Input label="Max tokens" name="max_tokens" type="number" min={200} max={16000} defaultValue={current?.max_tokens ?? 3000} readOnly={!canManage} />
						<div className="md:col-span-4">
							<Textarea label="System prompt (skill-md)" name="system_md" rows={18} defaultValue={current?.system_md ?? ''} className="font-mono text-xs" readOnly={!canManage} />
						</div>
						<div className="md:col-span-2">
							<Textarea label="Output schema (JSON, blank = markdown)" name="output_schema_json" rows={4} defaultValue={current?.output_schema ? JSON.stringify(current.output_schema, null, 2) : ''} className="font-mono text-xs" readOnly={!canManage} />
						</div>
						<Input label="Model hint (optional)" name="model" defaultValue={current?.model ?? ''} readOnly={!canManage} />
						<div className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-300 mt-6">
							<label className="flex items-center gap-2">
								<Checkbox name="is_placeholder" defaultChecked={current?.is_placeholder ?? true} disabled={!canManage} /> Placeholder
							</label>
							<label className="flex items-center gap-2">
								<Checkbox name="is_active" defaultChecked={current?.is_active ?? true} disabled={!canManage} /> Active
							</label>
						</div>
						{canManage && (
							<div className="md:col-span-4">
								<Button type="submit" size="sm">
									Save
								</Button>
							</div>
						)}
					</ActionForm>
					{current && current.history.length > 0 && (
						<details className="mt-3 text-xs">
							<summary className="cursor-pointer text-slate-500">Previous versions ({current.history.length})</summary>
							<ul className="mt-2 space-y-2">
								{current.history
									.slice()
									.sort((a, b) => b.version - a.version)
									.map((h) => (
										<li key={h.version} className="rounded-md border border-slate-200 dark:border-slate-700 p-2">
											<p className="text-2xs text-slate-500 mb-1">
												v{h.version} · {h.at?.slice(0, 16).replace('T', ' ')}
											</p>
											<pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 max-h-40 overflow-y-auto">{h.system_md}</pre>
										</li>
									))}
							</ul>
						</details>
					)}
				</Card>
			)}
		</div>
	);
}
