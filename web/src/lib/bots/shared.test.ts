import { describe, expect, it } from 'vitest';
import { catalogOrFallback, consumerForBot, desiredFromObserved, toOps, BOT_NAME_RE, FALLBACK_TOOLSETS, PRIVILEGED_TOOLSETS } from './shared';

describe('toOps', () => {
	it('always emits agent.disabled_toolsets first, denying every privileged toolset by default', () => {
		const ops = toOps({
			model: { provider: 'anthropic', default: 'claude-fable-5-1' },
			tools: { toolsets: ['web', 'file', 'browser'] },
			telemetry: { shared_metrics: { enabled: true, send: false } },
			agent: { max_turns: 120, tool_progress: 'new', compression_threshold: 0.6 },
			terminal: { backend: 'local' },
			tts: { provider: 'edge' },
		});
		expect(ops).toEqual([
			{ key: 'agent.disabled_toolsets', value: ['browser', 'code_execution', 'computer_use', 'terminal'] },
			{ key: 'model.provider', value: 'anthropic' },
			{ key: 'model.default', value: 'claude-fable-5-1' },
			{ key: 'tts.provider', value: 'edge' },
			{ key: 'terminal.backend', value: 'local' },
			{ key: 'platform_toolsets.cli', value: ['browser', 'file', 'web'] },
			{ key: 'telemetry.shared_metrics.enabled', value: true },
			{ key: 'telemetry.shared_metrics.send', value: false },
			{ key: 'agent.max_turns', value: 120 },
			{ key: 'display.tool_progress', value: 'new' },
			{ key: 'compression.threshold', value: 0.6 },
		]);
	});

	it('skips unset fields but still leads with the full deny list, and never sends send=true while collection is off', () => {
		expect(toOps({})).toEqual([{ key: 'agent.disabled_toolsets', value: ['browser', 'code_execution', 'computer_use', 'terminal'] }]);
		expect(toOps({ telemetry: { shared_metrics: { enabled: false, send: true } } })).toEqual([
			{ key: 'agent.disabled_toolsets', value: ['browser', 'code_execution', 'computer_use', 'terminal'] },
			{ key: 'telemetry.shared_metrics.enabled', value: false },
			{ key: 'telemetry.shared_metrics.send', value: false },
		]);
	});

	it('removes a privileged toolset from the deny list only when granted with a justification', () => {
		const ops = toOps({ tools: { privileged_grants: ['terminal'], justification: 'needs shell for log triage' } });
		expect(ops).toEqual([{ key: 'agent.disabled_toolsets', value: ['browser', 'code_execution', 'computer_use'] }]);
	});

	it('ignores privileged_grants with no justification string (defense in depth, mirrors the bridge refusal)', () => {
		const ops = toOps({ tools: { privileged_grants: ['terminal', 'browser'], justification: '   ' } });
		expect(ops).toEqual([{ key: 'agent.disabled_toolsets', value: ['browser', 'code_execution', 'computer_use', 'terminal'] }]);
	});

	it('computer_use is never grantable, even if passed in privileged_grants with a justification', () => {
		const ops = toOps({ tools: { privileged_grants: [...PRIVILEGED_TOOLSETS], justification: 'trust me' } });
		expect(ops).toEqual([{ key: 'agent.disabled_toolsets', value: ['computer_use'] }]);
	});
});

describe('desiredFromObserved', () => {
	it('reads a config.yaml-shaped report back into the form shape', () => {
		const d = desiredFromObserved({
			model: { provider: 'anthropic', default: 'claude-sonnet-5', base_url: 'x' },
			tools: { toolsets: ['web', 7, 'file'] },
			telemetry: { shared_metrics: { enabled: false } },
			agent: { max_turns: 150 },
			display: { tool_progress: 'all' },
			compression: { threshold: 0.5 },
		});
		expect(d.model).toEqual({ provider: 'anthropic', default: 'claude-sonnet-5' });
		expect(d.tools?.toolsets).toEqual(['web', 'file']);
		expect(d.telemetry?.shared_metrics).toEqual({ enabled: false, send: undefined });
		expect(d.agent).toEqual({ max_turns: 150, tool_progress: 'all', compression_threshold: 0.5 });
	});

	it('tolerates garbage', () => {
		expect(desiredFromObserved(null).model?.provider).toBeUndefined();
		expect(desiredFromObserved('str').tools?.toolsets).toBeUndefined();
	});
});

describe('catalogOrFallback', () => {
	it('uses the bridge catalog when present and the fallback per list otherwise', () => {
		const c = catalogOrFallback({ providers: ['nous'], toolsets: [] });
		expect(c.providers).toEqual(['nous']);
		expect(c.toolsets).toEqual([...FALLBACK_TOOLSETS]);
		expect(c.terminal_backends).toContain('local');
	});
});

describe('consumerForBot / BOT_NAME_RE', () => {
	it('matches `<name>` or `<name>-*` slugs only', () => {
		const cs = [
			{ slug: 'pulse-cs', name: 'F', scopes: [], identity_slug: null, last_used_at: null },
			{ slug: 'athens-data', name: 'A', scopes: [], identity_slug: null, last_used_at: null },
		];
		expect(consumerForBot('pulse', cs)?.slug).toBe('pulse-cs');
		expect(consumerForBot('athen', cs)).toBeNull();
	});
	it('mirrors hermes PROFILE_ID_RE', () => {
		expect(BOT_NAME_RE.test('tex')).toBe(true);
		expect(BOT_NAME_RE.test('zz_bridge-2')).toBe(true);
		expect(BOT_NAME_RE.test('Tex')).toBe(false);
		expect(BOT_NAME_RE.test('-x')).toBe(false);
		expect(BOT_NAME_RE.test('a'.repeat(65))).toBe(false);
	});
});
