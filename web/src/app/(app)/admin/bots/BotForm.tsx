'use client';

// Create / edit form for one bot. Sections follow `hermes setup` one for
// one (model, tts, terminal, gateway, tools, telemetry, agent) so an admin
// who has run the wizard recognises every field. Saving stores the desired
// config and queues a provisioning request; the fleet bridge applies it on
// the host. MCP scopes save separately and take effect immediately.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import ModalCard from '@/components/ui/ModalCard';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { SCOPES } from '@/lib/mcp/scopes';
import {
	GATEWAY_NOTE,
	GRANTABLE_PRIVILEGED_TOOLSETS,
	PRIVILEGED_TOOLSETS,
	SECTION_LABELS,
	TOOL_PROGRESS_MODES,
	desiredFromObserved,
	type BotConsumer,
	type BotDesired,
	type BotRow,
	type FleetCatalog,
} from '@/lib/bots/shared';
import { saveBot, setBotScopes } from './actions';

const PATH = '/admin/bots';

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
	return (
		<div className="pt-3 first:pt-0">
			<h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
			{hint && <p className="text-2xs text-slate-500 mt-0.5">{hint}</p>}
		</div>
	);
}

export default function BotForm({
	bot,
	consumer,
	catalog,
	existingNames,
}: {
	bot: BotRow | null;
	consumer: BotConsumer | null;
	catalog: FleetCatalog;
	existingNames: string[];
}) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// Edit opens on the desired doc when one was saved, otherwise on what the host reports.
	const initial = useMemo<BotDesired>(() => {
		if (!bot) return { model: { provider: 'anthropic', default: 'claude-sonnet-5' }, tools: { toolsets: ['web', 'file', 'skills', 'memory', 'todo'] } };
		const fromDesired = bot.desired && Object.keys(bot.desired).length > 0 ? bot.desired : null;
		return fromDesired ?? desiredFromObserved(bot.observed);
	}, [bot]);

	const [name, setName] = useState(bot?.name ?? '');
	const [displayName, setDisplayName] = useState(bot?.display_name ?? '');
	const [role, setRole] = useState(bot?.role_description ?? '');
	const [soulMd, setSoulMd] = useState('');
	const [provider, setProvider] = useState(initial.model?.provider ?? 'anthropic');
	const [model, setModel] = useState(initial.model?.default ?? '');
	const [tts, setTts] = useState(initial.tts?.provider ?? '');
	const [backend, setBackend] = useState(initial.terminal?.backend ?? 'local');
	const [toolsets, setToolsets] = useState<Set<string>>(new Set(initial.tools?.toolsets ?? []));
	const [privilegedGrants, setPrivilegedGrants] = useState<Set<string>>(new Set(initial.tools?.privileged_grants ?? []));
	const [justification, setJustification] = useState(initial.tools?.justification ?? '');
	const [metricsEnabled, setMetricsEnabled] = useState(initial.telemetry?.shared_metrics?.enabled ?? false);
	const [metricsSend, setMetricsSend] = useState(initial.telemetry?.shared_metrics?.send ?? false);
	const [maxTurns, setMaxTurns] = useState(String(initial.agent?.max_turns ?? ''));
	const [toolProgress, setToolProgress] = useState(initial.agent?.tool_progress ?? '');
	const [compression, setCompression] = useState(String(initial.agent?.compression_threshold ?? ''));
	const [scopes, setScopes] = useState<Set<string>>(new Set(consumer?.scopes ?? []));

	const isNew = !bot;
	const nameTaken = isNew && existingNames.includes(name);
	const observedPlatforms = ((bot?.observed as { gateway?: { platforms?: string[] } } | null)?.gateway?.platforms ?? []) as string[];
	// The main grid is only non-privileged toolsets; computer_use + code_execution/terminal/browser
	// move to the "privileged grants" group below (fleet rule: hard-deny by default, t_f467f967).
	const regularToolsets = catalog.toolsets.filter((t) => !PRIVILEGED_TOOLSETS.includes(t.key as (typeof PRIVILEGED_TOOLSETS)[number]));
	const grantableCatalog = catalog.toolsets.filter((t) => (GRANTABLE_PRIVILEGED_TOOLSETS as readonly string[]).includes(t.key));
	const justificationMissing = privilegedGrants.size > 0 && !justification.trim();

	function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
		const next = new Set(set);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setter(next);
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setNotice(null);
		if (justificationMissing) {
			setError('A justification is required to grant a privileged toolset (code_execution, terminal, browser).');
			return;
		}
		const desired: BotDesired = {
			model: { provider, default: model.trim() },
			tts: tts ? { provider: tts } : undefined,
			terminal: { backend },
			tools: { toolsets: [...toolsets], privileged_grants: [...privilegedGrants], justification: justification.trim() || undefined },
			telemetry: { shared_metrics: { enabled: metricsEnabled, send: metricsEnabled && metricsSend } },
			agent: {
				max_turns: maxTurns ? Number(maxTurns) : undefined,
				tool_progress: toolProgress || undefined,
				compression_threshold: compression ? Number(compression) : undefined,
			},
		};
		start(async () => {
			const res = await saveBot({ name, displayName, role, soulMd: soulMd || undefined, desired });
			if (!res.ok) {
				setError(res.error);
				return;
			}
			router.replace(PATH, { scroll: false });
		});
	}

	function saveScopes() {
		if (!consumer) return;
		setError(null);
		setNotice(null);
		start(async () => {
			const res = await setBotScopes({ slug: consumer.slug, scopes: [...scopes] });
			if (!res.ok) setError(res.error);
			else setNotice(`Scopes on ${consumer.slug} updated. Takes effect on the next MCP call.`);
		});
	}

	return (
		<ModalCard
			title={isNew ? 'New bot' : `Edit ${bot.display_name ?? bot.name}`}
			subtitle={isNew ? 'Provisions a Hermes profile on the fleet host via the bridge.' : `Profile ${bot.name} · ${bot.status}`}
			closeHref={PATH}
			maxWidth="max-w-3xl"
		>
			<form onSubmit={submit} className="space-y-3">
				{error && <Callout tone="error">{error}</Callout>}
				{notice && <Callout tone="success">{notice}</Callout>}

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<Input
						label="Profile name"
						value={name}
						onChange={(e) => setName(e.target.value.toLowerCase())}
						placeholder="e.g. quinn"
						pattern="^[a-z0-9][a-z0-9_-]{0,63}$"
						required
						disabled={!isNew}
						error={nameTaken ? 'A bot with this name already exists.' : undefined}
					/>
					<Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Quinn (Research)" maxLength={80} />
				</div>
				<Textarea
					label="Role / description"
					value={role}
					onChange={(e) => setRole(e.target.value)}
					rows={2}
					maxLength={600}
					placeholder="One or two sentences. Used by the kanban decomposer to route work to this bot."
				/>

				<SectionTitle hint="hermes setup model · model.provider, model.default">{SECTION_LABELS.model}</SectionTitle>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)} required>
						{catalog.providers.map((p) => (
							<option key={p} value={p}>
								{p}
							</option>
						))}
					</Select>
					<Input label="Default model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-fable-5-1" required />
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<SectionTitle hint="hermes setup tts · tts.provider">{SECTION_LABELS.tts}</SectionTitle>
						<Select value={tts} onChange={(e) => setTts(e.target.value)} className="mt-1">
							<option value="">(leave as is)</option>
							{catalog.tts_providers.map((p) => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
						</Select>
					</div>
					<div>
						<SectionTitle hint="hermes setup terminal · terminal.backend">{SECTION_LABELS.terminal}</SectionTitle>
						<Select value={backend} onChange={(e) => setBackend(e.target.value)} className="mt-1">
							{catalog.terminal_backends.map((b) => (
								<option key={b} value={b}>
									{b}
								</option>
							))}
						</Select>
					</div>
				</div>

				<SectionTitle hint={GATEWAY_NOTE}>{SECTION_LABELS.gateway}</SectionTitle>
				<p className="text-xs text-slate-600 dark:text-slate-400">
					Configured on host:{' '}
					{observedPlatforms.length === 0 ? <span className="text-slate-500">none reported</span> : observedPlatforms.join(', ')}
				</p>

				<SectionTitle hint="hermes setup tools · platform_toolsets.cli">{SECTION_LABELS.tools}</SectionTitle>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
					{regularToolsets.map((t) => (
						<label key={t.key} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
							<Checkbox checked={toolsets.has(t.key)} onChange={() => toggle(toolsets, t.key, setToolsets)} className="mt-0.5" />
							<span>
								<span className="font-medium">{t.label}</span>
								<span className="block text-2xs text-slate-500 font-mono">{t.key}</span>
							</span>
						</label>
					))}
				</div>

				<SectionTitle hint="Hard-denied via agent.disabled_toolsets on every profile (fleet rule, 2026-09-07 audit). Granting one here requires a justification; it is logged to the audit trail.">
					Privileged grants
				</SectionTitle>
				<Callout tone="warning" className="text-xs">
					Computer Use (background desktop control) is never grantable from this panel — it stays hard-denied on every
					profile regardless of what is checked below. The Wells Fargo wire-session incident (t_b1dc47ca) is why.
				</Callout>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
					{grantableCatalog.map((t) => (
						<label key={t.key} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
							<Checkbox checked={privilegedGrants.has(t.key)} onChange={() => toggle(privilegedGrants, t.key, setPrivilegedGrants)} className="mt-0.5" />
							<span>
								<span className="font-medium">{t.label}</span>
								<span className="block text-2xs text-slate-500 font-mono">{t.key}</span>
							</span>
						</label>
					))}
				</div>
				{privilegedGrants.size > 0 && (
					<Textarea
						label="Justification (required to grant a privileged toolset)"
						value={justification}
						onChange={(e) => setJustification(e.target.value)}
						rows={2}
						maxLength={600}
						placeholder="Why does this bot need code_execution / terminal / browser? Recorded to the audit log."
						error={justificationMissing ? 'Required while a privileged toolset is checked.' : undefined}
					/>
				)}

				<SectionTitle hint="hermes setup telemetry · telemetry.shared_metrics.enabled / .send">{SECTION_LABELS.telemetry}</SectionTitle>
				<div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
					<label className="flex items-center gap-2 cursor-pointer">
						<Checkbox checked={metricsEnabled} onChange={(e) => setMetricsEnabled(e.target.checked)} /> Local shared metrics
					</label>
					<label className="flex items-center gap-2 cursor-pointer">
						<Checkbox checked={metricsEnabled && metricsSend} disabled={!metricsEnabled} onChange={(e) => setMetricsSend(e.target.checked)} /> Send to Nous
					</label>
				</div>

				<SectionTitle hint="hermes setup agent · agent.max_turns, display.tool_progress, compression.threshold, SOUL.md">{SECTION_LABELS.agent}</SectionTitle>
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<Input label="Max iterations" type="number" min={1} max={2000} value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} placeholder="90" />
					<Select label="Tool progress" value={toolProgress} onChange={(e) => setToolProgress(e.target.value)}>
						<option value="">(leave as is)</option>
						{TOOL_PROGRESS_MODES.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
					</Select>
					<Input label="Compression threshold" type="number" step={0.05} min={0.5} max={0.95} value={compression} onChange={(e) => setCompression(e.target.value)} placeholder="0.50" />
				</div>
				<Textarea
					label={isNew ? 'SOUL.md (personality)' : 'Replace SOUL.md (leave blank to keep)'}
					value={soulMd}
					onChange={(e) => setSoulMd(e.target.value)}
					rows={4}
					maxLength={20000}
					placeholder="Who this bot is, how it talks, what it owns. Written to the profile's SOUL.md by the bridge."
					className="font-mono text-xs"
				/>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
					<Button type="button" variant="ghost" size="sm" onClick={() => router.replace(PATH, { scroll: false })} disabled={pending}>
						Cancel
					</Button>
					<Button type="submit" size="sm" disabled={pending || nameTaken || justificationMissing}>
						{pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
						{isNew ? 'Queue provisioning' : 'Queue update'}
					</Button>
				</div>
			</form>

			{!isNew && (
				<div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
					<SectionTitle hint={consumer ? `MCP consumer ${consumer.slug}${consumer.identity_slug ? ` · bound to spine identity ${consumer.identity_slug} (ceiling applies)` : ' · unbound'}. Saves immediately.` : 'No live MCP consumer with this bot\'s name. Mint one with public.mcp_provision_consumer (0106) or mcp_mint_consumer (0057).'}>
						MCP scopes (Open Ronin)
					</SectionTitle>
					{consumer && (
						<>
							<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
								{SCOPES.map((s) => (
									<label key={s} className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-slate-300 cursor-pointer">
										<Checkbox checked={scopes.has(s)} onChange={() => toggle(scopes, s, setScopes)} /> {s}
									</label>
								))}
							</div>
							<div className="flex justify-end">
								<Button type="button" variant="outline" size="sm" onClick={saveScopes} disabled={pending}>
									Save scopes
								</Button>
							</div>
						</>
					)}
				</div>
			)}
		</ModalCard>
	);
}
