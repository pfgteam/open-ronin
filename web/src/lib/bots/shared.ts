// Bot management vocabulary shared by the /admin/bots page, its actions and
// the bridge routes. No server imports: a 'use client' form imports this.
//
// The config shape mirrors `hermes setup` section for section (Alex's
// condition: do not invent a schema). Each field names the config.yaml key
// it maps to; toOps() turns a BotDesired into the literal `hermes config set
// <key> <value>` pairs the bridge applies, so the mapping lives here once.
//
//   hermes setup section   config.yaml keys
//   model                  model.provider, model.default
//   tts                    tts.provider
//   terminal               terminal.backend
//   gateway                (platform tokens live in .env: NOT editable here,
//                          shown read-only from observed; see GATEWAY_NOTE)
//   tools                  platform_toolsets.cli (toolset keys)
//   telemetry              telemetry.shared_metrics.enabled / .send
//   agent                  agent.max_turns, display.tool_progress,
//                          compression.threshold (+ SOUL.md personality)

export const HERMES_SETUP_SECTIONS = ['model', 'tts', 'terminal', 'gateway', 'tools', 'telemetry', 'agent'] as const;
export type HermesSetupSection = (typeof HERMES_SETUP_SECTIONS)[number];

export const SECTION_LABELS: Record<HermesSetupSection, string> = {
	model: 'Model & Provider',
	tts: 'Text-to-Speech',
	terminal: 'Terminal Backend',
	gateway: 'Messaging Platforms (Gateway)',
	tools: 'Tools',
	telemetry: 'Shared Metrics',
	agent: 'Agent Settings',
};

export const GATEWAY_NOTE =
	'Platform tokens (Telegram, Discord, Slack…) live in the profile .env and are set with `hermes -p <bot> setup gateway` on the host. This panel shows which platforms the host reports configured; it never carries a token. Fleet rule: one shared Telegram bot, the default profile owns the poller.';

// Fallback catalog when the bridge has not reported one yet. The bridge sends
// the live lists from hermes_cli (PROVIDER_REGISTRY, CONFIGURABLE_TOOLSETS,
// _BUILTIN_TERMINAL_BACKENDS, tts providers) and those win.
export const FALLBACK_PROVIDERS = ['anthropic', 'nous', 'openai-api', 'openai-codex', 'openrouter', 'gemini', 'xai', 'deepseek', 'ollama-cloud', 'bedrock', 'vertex'] as const;

export const FALLBACK_TOOLSETS: ReadonlyArray<{ key: string; label: string; description: string }> = [
	{ key: 'web', label: 'Web Search & Scraping', description: 'web_search, web_extract' },
	{ key: 'browser', label: 'Browser Automation', description: 'navigate, click, type, scroll' },
	{ key: 'terminal', label: 'Terminal & Processes', description: 'terminal, process' },
	{ key: 'file', label: 'File Operations', description: 'read, write, patch, search' },
	{ key: 'code_execution', label: 'Code Execution', description: 'execute_code' },
	{ key: 'vision', label: 'Vision / Image Analysis', description: 'vision_analyze' },
	{ key: 'video', label: 'Video Analysis', description: 'video_analyze' },
	{ key: 'image_gen', label: 'Image Generation', description: 'image_generate' },
	{ key: 'video_gen', label: 'Video Generation', description: 'video_generate' },
	{ key: 'x_search', label: 'X (Twitter) Search', description: 'x_search' },
	{ key: 'tts', label: 'Text-to-Speech', description: 'text_to_speech' },
	{ key: 'skills', label: 'Skills', description: 'list, view, manage' },
	{ key: 'todo', label: 'Task Planning', description: 'todo_list' },
	{ key: 'kanban', label: 'Kanban', description: 'task board tools' },
	{ key: 'memory', label: 'Memory', description: 'persistent memory across sessions' },
	{ key: 'context_engine', label: 'Context Engine', description: 'runtime tools from the active context engine' },
	{ key: 'session_search', label: 'Session Search', description: 'search past conversations' },
	{ key: 'connections', label: 'Connections', description: 'remote connector tools' },
	{ key: 'clarify', label: 'Clarifying Questions', description: 'clarify' },
	{ key: 'delegation', label: 'Task Delegation', description: 'delegate_task' },
	{ key: 'cronjob', label: 'Cron Jobs', description: 'create/list/update/pause/resume/run' },
	{ key: 'homeassistant', label: 'Home Assistant', description: 'smart home device control' },
	{ key: 'spotify', label: 'Spotify', description: 'playback, search, playlists' },
	{ key: 'discord', label: 'Discord (read/participate)', description: 'fetch messages, search members' },
	{ key: 'discord_admin', label: 'Discord Server Admin', description: 'channels, roles, pins' },
	{ key: 'computer_use', label: 'Computer Use', description: 'background desktop control' },
];

// Toolsets that grant desktop/process/filesystem-adjacent agency. Hard-denied
// via agent.disabled_toolsets on every provisioned profile unless explicitly
// granted (with a justification) through the "privileged grants" group below.
// computer_use is never grantable from this panel at all — see toOps().
// Fleet rule (AUDIT_ACTIONS_TAKEN.md, 2026-09-07): only alejo/chuck get
// terminal + code_execution by default.
export const PRIVILEGED_TOOLSETS = ['computer_use', 'code_execution', 'terminal', 'browser'] as const;
export type PrivilegedToolset = (typeof PRIVILEGED_TOOLSETS)[number];

// The subset of PRIVILEGED_TOOLSETS a panel admin may actually grant (with a
// justification). computer_use is deliberately excluded — see toOps().
export const GRANTABLE_PRIVILEGED_TOOLSETS = ['code_execution', 'terminal', 'browser'] as const;

export const FALLBACK_TERMINAL_BACKENDS = ['local', 'docker', 'modal', 'ssh', 'daytona', 'vercel_sandbox'] as const;
export const FALLBACK_TTS_PROVIDERS = ['edge', 'elevenlabs', 'openai', 'xai', 'minimax', 'mistral', 'gemini', 'neutts', 'kittentts', 'none'] as const;
export const TOOL_PROGRESS_MODES = ['off', 'new', 'all', 'verbose', 'log'] as const;

export type FleetCatalog = {
	providers: string[];
	toolsets: { key: string; label: string; description: string }[];
	terminal_backends: string[];
	tts_providers: string[];
	platforms?: string[];
	hermes_version?: string;
};

export function catalogOrFallback(raw: unknown): FleetCatalog {
	const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<FleetCatalog>;
	const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
	const toolsets = Array.isArray(c.toolsets)
		? c.toolsets.filter((t): t is FleetCatalog['toolsets'][number] => !!t && typeof t === 'object' && typeof (t as { key?: unknown }).key === 'string')
		: [];
	return {
		providers: strs(c.providers).length ? strs(c.providers) : [...FALLBACK_PROVIDERS],
		toolsets: toolsets.length ? toolsets : [...FALLBACK_TOOLSETS],
		terminal_backends: strs(c.terminal_backends).length ? strs(c.terminal_backends) : [...FALLBACK_TERMINAL_BACKENDS],
		tts_providers: strs(c.tts_providers).length ? strs(c.tts_providers) : [...FALLBACK_TTS_PROVIDERS],
		platforms: strs(c.platforms),
		hermes_version: typeof c.hermes_version === 'string' ? c.hermes_version : undefined,
	};
}

// The desired-config document stored in bot_profiles.desired. Every key is
// optional: an unset key means "leave the profile's current value alone".
export type BotDesired = {
	model?: { provider?: string; default?: string };
	tts?: { provider?: string };
	terminal?: { backend?: string };
	gateway?: Record<string, never>;
	tools?: { toolsets?: string[]; privileged_grants?: string[]; justification?: string };
	telemetry?: { shared_metrics?: { enabled?: boolean; send?: boolean } };
	agent?: { max_turns?: number; tool_progress?: string; compression_threshold?: number };
};

export type ConfigOp = { key: string; value: string | number | boolean | string[] };

/**
 * The literal `hermes config set` pairs for a desired doc. agent.disabled_toolsets is
 * ALWAYS emitted first so the bridge lands the hard-deny before platform_toolsets.cli
 * (fleet computer_use excessive-agency incident, t_b1dc47ca). A privileged toolset
 * (code_execution, terminal, browser) is removed from the deny list only when it was
 * explicitly checked under the panel's "privileged grants" group AND a non-empty
 * justification was given; computer_use can never be removed from the deny list,
 * even if a caller tries to pass it in privileged_grants — this panel does not grant it.
 */
export function toOps(d: BotDesired): ConfigOp[] {
	const ops: ConfigOp[] = [];
	const justified = !!d.tools?.justification?.trim();
	const grants = new Set(justified ? (d.tools?.privileged_grants ?? []).filter((g) => g !== 'computer_use') : []);
	const deny = PRIVILEGED_TOOLSETS.filter((t) => !grants.has(t));
	ops.push({ key: 'agent.disabled_toolsets', value: [...deny].sort() });
	if (d.model?.provider) ops.push({ key: 'model.provider', value: d.model.provider });
	if (d.model?.default) ops.push({ key: 'model.default', value: d.model.default });
	if (d.tts?.provider) ops.push({ key: 'tts.provider', value: d.tts.provider });
	if (d.terminal?.backend) ops.push({ key: 'terminal.backend', value: d.terminal.backend });
	if (d.tools?.toolsets) ops.push({ key: 'platform_toolsets.cli', value: [...d.tools.toolsets].sort() });
	const sm = d.telemetry?.shared_metrics;
	if (sm && typeof sm.enabled === 'boolean') ops.push({ key: 'telemetry.shared_metrics.enabled', value: sm.enabled });
	if (sm && typeof sm.send === 'boolean') ops.push({ key: 'telemetry.shared_metrics.send', value: sm.enabled === false ? false : sm.send });
	if (d.agent?.max_turns) ops.push({ key: 'agent.max_turns', value: d.agent.max_turns });
	if (d.agent?.tool_progress) ops.push({ key: 'display.tool_progress', value: d.agent.tool_progress });
	if (typeof d.agent?.compression_threshold === 'number') ops.push({ key: 'compression.threshold', value: d.agent.compression_threshold });
	return ops;
}

/** Read a hermes config.yaml-shaped object (as the bridge reports it) into the desired shape. */
export function desiredFromObserved(o: unknown): BotDesired {
	const obj = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
	const sec = (k: string) => (obj[k] && typeof obj[k] === 'object' ? (obj[k] as Record<string, unknown>) : {});
	const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
	const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
	const model = sec('model');
	const tools = sec('tools');
	const toolsets = Array.isArray(tools.toolsets) ? tools.toolsets.filter((x): x is string => typeof x === 'string') : undefined;
	const disabled = new Set(Array.isArray(tools.disabled) ? tools.disabled.filter((x): x is string => typeof x === 'string') : []);
	// Reverse of toOps(): a privileged toolset not in the observed deny list was granted.
	// The justification itself isn't observed state, so re-opening the form asks for it again.
	const privilegedGrants = PRIVILEGED_TOOLSETS.filter((t) => t !== 'computer_use' && disabled.size > 0 && !disabled.has(t));
	const sm = (sec('telemetry').shared_metrics ?? {}) as Record<string, unknown>;
	const agent = sec('agent');
	return {
		model: { provider: str(model.provider), default: str(model.default) },
		tts: { provider: str(sec('tts').provider) },
		terminal: { backend: str(sec('terminal').backend) },
		tools: { toolsets, privileged_grants: privilegedGrants.length ? privilegedGrants : undefined },
		telemetry: { shared_metrics: { enabled: bool(sm.enabled), send: bool(sm.send) } },
		agent: {
			max_turns: num(agent.max_turns),
			tool_progress: str(sec('display').tool_progress),
			compression_threshold: num(sec('compression').threshold),
		},
	};
}

export const BOT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const BOT_STATUSES = ['draft', 'pending', 'applied', 'failed', 'retired'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export type BotRow = {
	id: string;
	name: string;
	display_name: string | null;
	role_description: string | null;
	desired: BotDesired;
	desired_updated_at: string | null;
	observed: Record<string, unknown> | null;
	observed_at: string | null;
	gateway_running: boolean | null;
	mcp_consumer_slug: string | null;
	spine_identity_slug: string | null;
	status: BotStatus;
	last_error: string | null;
	updated_at: string;
};

export type BotConsumer = { slug: string; name: string; scopes: string[]; identity_slug: string | null; last_used_at: string | null };

/** Convention: a bot's MCP consumer is the live mcp_consumers row whose slug starts with `<name>-` or equals the name. */
export function consumerForBot(name: string, consumers: BotConsumer[]): BotConsumer | null {
	return consumers.find((c) => c.slug === name || c.slug.startsWith(`${name}-`)) ?? null;
}

/** Bridge staleness: the observed state is trustworthy for about an hour (bridge cron is every 15 min). */
export const SYNC_STALE_MS = 60 * 60 * 1000;
