'use client';

// Admin → Flywheel → AI panel (F3): the Nous key (write-only; presence shown),
// enable switch, monthly cap, judge model, sync + test, the model panel
// (core / in panel toggles, vendor bulk).

import { useMemo, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import type { AiModelRow } from '@/lib/flywheel/shared';
import ActionForm from '@/app/(app)/flywheel/ActionForm';
import { saveNousConnection, setModelFlags, setPanelByVendors, syncNousModels, testNousConnection } from '@/app/(app)/flywheel/auditActions';

export interface ConnView {
	is_enabled: boolean;
	has_key: boolean;
	base_url: string;
	monthly_cap_usd: number;
	spend_month: string;
	spend_month_usd: number;
	judge_model: string | null;
	max_tokens: number;
	concurrency: number;
	last_models_sync_at: string | null;
	last_ok_at: string | null;
	last_error: string | null;
}

export default function AiPanelTab({ conn, models, canManage, encReady }: { conn: ConnView | null; models: AiModelRow[]; canManage: boolean; encReady: boolean }) {
	const [q, setQ] = useState('');
	const [onlyPanel, setOnlyPanel] = useState(false);
	const vendors = useMemo(() => Array.from(new Set(models.map((m) => m.vendor))).sort(), [models]);
	const shown = models.filter((m) => (!onlyPanel || m.in_panel) && (!q || m.id.toLowerCase().includes(q.toLowerCase()) || m.label.toLowerCase().includes(q.toLowerCase()))).slice(0, 400);
	const inPanel = models.filter((m) => m.in_panel && m.is_active).length;
	const core = models.filter((m) => m.is_core).length;
	return (
		<div className="space-y-4">
			<Card>
				<div className="flex items-center justify-between mb-1">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Nous (OpenAI-compatible router)</h2>
					<div className="flex items-center gap-2">
						<Badge color={conn?.has_key ? 'success' : 'warning'}>{conn?.has_key ? 'key stored' : 'no key'}</Badge>
						<Badge color={conn?.is_enabled ? 'success' : 'default'}>{conn?.is_enabled ? 'enabled' : 'off'}</Badge>
					</div>
				</div>
				<p className="text-xs text-slate-500 mb-3">The ~200-model AI visibility panel runs through one key. The key is encrypted at rest (AES-256-GCM, same as GHL tokens) and never shown again. Off until the key is entered AND the switch is on; every run is estimated first and refused past the monthly cap.</p>
				{!encReady && <Callout tone="error" className="mb-3">GHL_TOKEN_ENC_KEY is not set on this deployment, so the key cannot be stored encrypted. Add it in Vercel first.</Callout>}
				{conn?.last_error && <Callout tone="warning" className="mb-3">Last error: {conn.last_error}</Callout>}
				{conn && (
					<p className="text-2xs text-slate-500 mb-3">
						Spend {conn.spend_month.slice(0, 7)}: ${conn.spend_month_usd.toFixed(2)} of ${conn.monthly_cap_usd.toFixed(0)} · last OK {conn.last_ok_at ? conn.last_ok_at.slice(0, 16).replace('T', ' ') : 'never'} · models synced {conn.last_models_sync_at ? conn.last_models_sync_at.slice(0, 16).replace('T', ' ') : 'never'}
					</p>
				)}
				<ActionForm action={saveNousConnection} success="Connection saved." className="grid gap-3 md:grid-cols-3">
					<input type="hidden" name="is_enabled_present" value="1" />
					<div className="md:col-span-2">
						<Input label={conn?.has_key ? 'Replace API key (leave blank to keep)' : 'Nous API key'} name="api_key" type="password" autoComplete="off" placeholder="sk-…" readOnly={!canManage} />
					</div>
					<Input label="Monthly cap (USD)" name="monthly_cap_usd" type="number" min={0} step={1} defaultValue={conn?.monthly_cap_usd ?? 100} readOnly={!canManage} />
					<Input label="Judge model (scores sentiment / accuracy / misinfo)" name="judge_model" defaultValue={conn?.judge_model ?? ''} placeholder="anthropic/claude-fable-5.1" readOnly={!canManage} />
					<Input label="Max answer tokens" name="max_tokens" type="number" min={50} max={4000} defaultValue={conn?.max_tokens ?? 600} readOnly={!canManage} />
					<Input label="Concurrency" name="concurrency" type="number" min={1} max={16} defaultValue={conn?.concurrency ?? 4} readOnly={!canManage} />
					<div className="md:col-span-2">
						<Input label="Base URL" name="base_url" defaultValue={conn?.base_url ?? 'https://inference-api.nousresearch.com/v1'} readOnly={!canManage} />
					</div>
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mt-6">
						<Checkbox name="is_enabled" defaultChecked={conn?.is_enabled ?? false} disabled={!canManage} /> Enabled
					</label>
					{canManage && (
						<div className="md:col-span-3 flex gap-2">
							<Button type="submit" size="sm">
								Save
							</Button>
						</div>
					)}
				</ActionForm>
				{canManage && (
					<div className="mt-3 flex flex-wrap gap-2">
						<ActionForm action={async () => syncNousModels()} success="Model list synced.">
							<Button type="submit" size="sm" variant="outline">
								Sync model list from the router
							</Button>
						</ActionForm>
						<ActionForm action={async () => testNousConnection()} success="Connection OK.">
							<Button type="submit" size="sm" variant="outline" disabled={!conn?.has_key}>
								Test connection (one tiny call)
							</Button>
						</ActionForm>
					</div>
				)}
			</Card>

			<Card>
				<div className="flex items-center justify-between mb-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Model panel</h2>
					<span className="text-xs text-slate-500">
						{inPanel} in panel · {core} core · {models.length} known
					</span>
				</div>
				<p className="text-xs text-slate-500 mb-2">Core = the SOP&apos;s locked five (one per family: GPT, Claude, Gemini, Perplexity Sonar, an open model). The panel is the ~200 the monthly re-scan runs; a run can also target core only. Pricing is per 1M tokens from the router.</p>
				{canManage && (
					<ActionForm action={setPanelByVendors} success="Panel updated." className="mb-3 flex flex-wrap items-center gap-2 text-xs">
						<span className="text-slate-500">Keep in panel:</span>
						<label className="flex items-center gap-1"><Checkbox name="all" /> everything</label>
						{vendors.slice(0, 20).map((v) => (
							<label key={v} className="flex items-center gap-1">
								<Checkbox name="vendor" value={v} /> {v}
							</label>
						))}
						<Button type="submit" size="sm" variant="outline">
							Apply
						</Button>
					</ActionForm>
				)}
				<div className="flex gap-2 mb-2">
					<Input placeholder="Filter by id or name" value={q} onChange={(e) => setQ(e.target.value)} />
					<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
						<Checkbox checked={onlyPanel} onChange={(e) => setOnlyPanel(e.target.checked)} /> panel only
					</label>
				</div>
				{models.length === 0 ? (
					<p className="text-xs text-slate-500">No models yet — sync the list.</p>
				) : (
					<div className="max-h-[520px] overflow-y-auto">
						<table className="w-full text-xs">
							<thead className="sticky top-0 bg-white dark:bg-slate-800">
								<tr className="text-left text-2xs uppercase tracking-wide text-slate-500">
									<th className="py-1 pr-2">Model</th>
									<th className="py-1 pr-2">$/1M in</th>
									<th className="py-1 pr-2">$/1M out</th>
									<th className="py-1 pr-2">Core</th>
									<th className="py-1 pr-2">Panel</th>
									<th className="py-1">Active</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
								{shown.map((m) => (
									<tr key={m.id} className={!m.is_active ? 'opacity-50' : ''}>
										<td className="py-1 pr-2">
											<span className="font-mono text-slate-800 dark:text-slate-200">{m.id}</span>
											{m.web_search && <span className="ml-1 text-2xs text-slate-500">web</span>}
										</td>
										<td className="py-1 pr-2 text-slate-600 dark:text-slate-400">{m.prompt_usd_per_m != null ? Number(m.prompt_usd_per_m).toFixed(2) : '—'}</td>
										<td className="py-1 pr-2 text-slate-600 dark:text-slate-400">{m.completion_usd_per_m != null ? Number(m.completion_usd_per_m).toFixed(2) : '—'}</td>
										<td className="py-1 pr-2">
											<ActionForm action={setModelFlags} success={null}>
												<input type="hidden" name="id" value={m.id} />
												<input type="hidden" name="is_core_present" value="1" />
												<Checkbox name="is_core" defaultChecked={m.is_core} disabled={!canManage} onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()} />
											</ActionForm>
										</td>
										<td className="py-1 pr-2">
											<ActionForm action={setModelFlags} success={null}>
												<input type="hidden" name="id" value={m.id} />
												<input type="hidden" name="in_panel_present" value="1" />
												<Checkbox name="in_panel" defaultChecked={m.in_panel} disabled={!canManage} onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()} />
											</ActionForm>
										</td>
										<td className="py-1">{m.is_active ? <Badge color="success">yes</Badge> : <Badge>gone</Badge>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>
		</div>
	);
}
