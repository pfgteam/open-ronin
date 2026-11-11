// Open Ronin organisation config: the open-ronin.config.yaml format written by
// the install questionnaire (install/questionnaire.md) and applied by the
// setup wizard (/setup) or `pnpm setup:apply`. Pure module (no server
// imports) so the wizard's client preview validates with the same code.
//
// Only the keys the app applies are validated strictly; the rest of the file
// (hosting, migration, integrations, install) is carried along untouched and
// stored on org_settings.config for reference.

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const domain = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Use a bare domain like example.com');

const optionalText = z.preprocess((v) => (v === '' ? null : v), z.string().trim().nullable().optional());

export const serviceLineSchema = z.object({
	key: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z][a-z0-9_]{0,30}$/, 'Keys are lowercase letters, digits and _ (e.g. pr, social, seo)'),
	label: z.string().trim().min(1).max(60),
	deliverables: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
	reports: z.boolean().default(false),
});
export type ServiceLine = z.infer<typeof serviceLineSchema>;

export const MODULE_CHOICES = ['work', 'clients', 'growth', 'studio', 'team', 'management', 'ai_agents', 'client_portal'] as const;
export type ModuleChoice = (typeof MODULE_CHOICES)[number];

export const MODULE_CHOICE_LABELS: Record<ModuleChoice, { label: string; help: string }> = {
	work: { label: 'Work', help: 'Goals, projects, tasks, boards' },
	clients: { label: 'Clients', help: 'Clients, contacts, tickets, media' },
	growth: { label: 'Growth', help: 'Prospects and pipeline' },
	studio: { label: 'Studio', help: 'Content and pitching' },
	team: { label: 'Team', help: 'Directory, performance, hiring, knowledge' },
	management: { label: 'Management', help: 'Dashboards, requests desk' },
	ai_agents: { label: 'AI agents', help: 'Agents and bots' },
	client_portal: { label: 'Client portal', help: 'Clients sign in to their own portal' },
};

/** Config module -> app module keys (app_modules.key). Admin and Data are always on. */
export const MODULE_KEY_MAP: Record<Exclude<ModuleChoice, 'ai_agents' | 'client_portal'>, string[]> = {
	work: ['the_work'],
	clients: ['clients', 'media'],
	growth: ['prospects'],
	studio: ['social'],
	team: ['team', 'hiring'],
	management: ['dashboard'],
};

export const ROLE_CHOICES = ['admin', 'executive', 'manager', 'member', 'contractor'] as const;
/** Config role names -> the app's four built-in roles. */
export const ROLE_MAP: Record<string, 'admin' | 'exec' | 'manager' | 'contributor'> = {
	admin: 'admin',
	executive: 'exec',
	exec: 'exec',
	manager: 'manager',
	member: 'contributor',
	contributor: 'contributor',
	contractor: 'contributor',
};

export const orgConfigSchema = z
	.object({
		org: z
			.object({
				name: z.string().trim().min(1).max(120),
				domain: domain.nullable().optional(),
				type: optionalText,
				allowed_email_domains: z.array(domain).max(20).default([]),
				timezone: z.string().trim().min(1).max(64).default('UTC'),
				currency: z
					.string()
					.trim()
					.toUpperCase()
					.regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code like USD')
					.default('USD'),
			})
			.passthrough(),
		brand: z
			.object({
				logo: optionalText,
				primary_color: z.preprocess(
					(v) => (v === '' ? null : v),
					z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0F766E').nullable().optional(),
				),
			})
			.passthrough()
			.default({}),
		service_lines: z.array(serviceLineSchema).max(30).default([]),
		packages: z
			.array(z.object({ name: z.string().trim().min(1).max(80), service_lines: z.array(z.string()).default([]) }).passthrough())
			.max(50)
			.default([]),
		team: z
			.object({
				size_now: z.number().int().nonnegative().nullable().optional(),
				size_12mo: z.number().int().nonnegative().nullable().optional(),
				departments: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
				roles: z.array(z.string().trim()).default([...ROLE_CHOICES]),
				first_admin: z
					.object({ name: optionalText, email: z.string().trim().toLowerCase().email().nullable().optional() })
					.passthrough()
					.nullable()
					.optional(),
			})
			.passthrough()
			.default({}),
		modules: z
			.object(Object.fromEntries(MODULE_CHOICES.map((m) => [m, z.boolean().optional()])) as Record<ModuleChoice, z.ZodOptional<z.ZodBoolean>>)
			.passthrough()
			.default({}),
		auth: z
			.object({ methods: z.array(z.enum(['google', 'magic_link', 'password'])).default(['magic_link']) })
			.passthrough()
			.default({}),
		email: z.object({ provider: optionalText, from: optionalText }).passthrough().default({}),
		ai: z
			.object({
				providers: z.array(z.string()).default([]),
				spend_limit_total: z.number().nonnegative().nullable().optional(),
				spend_limit_per_user: z.number().nonnegative().nullable().optional(),
			})
			.passthrough()
			.default({}),
	})
	.passthrough();

export type OrgConfig = z.infer<typeof orgConfigSchema>;

export interface ApplyResult {
	ok: boolean;
	error?: string;
	errors?: string[];
	summary?: { service_lines: number; departments: number; modules: Record<string, boolean> };
}

export type ParseResult = { ok: true; config: OrgConfig } | { ok: false; errors: string[] };

/** Parse + validate YAML text (or an already-parsed object). Never throws. */
export function parseOrgConfig(input: string | unknown): ParseResult {
	let raw: unknown = input;
	if (typeof input === 'string') {
		try {
			raw = parseYaml(input);
		} catch (e) {
			return { ok: false, errors: [`YAML: ${(e as Error).message.split('\n')[0]}`] };
		}
	}
	const r = orgConfigSchema.safeParse(raw ?? {});
	if (!r.success) {
		return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
	}
	// Sign-in domains default to the org domain, as the questionnaire says.
	const c = r.data;
	if (!c.org.allowed_email_domains.length && c.org.domain) c.org.allowed_email_domains = [c.org.domain];
	return { ok: true, config: c };
}

/** Which app modules end up enabled for a config (preview in the wizard). */
export function enabledAppModules(c: OrgConfig): Record<string, boolean> {
	const out: Record<string, boolean> = { admin: true, data: true };
	for (const [choice, keys] of Object.entries(MODULE_KEY_MAP)) {
		const on = c.modules[choice as ModuleChoice] ?? true;
		for (const k of keys) out[k] = on;
	}
	out.flywheel = c.service_lines.length === 0 || c.service_lines.some((s) => s.key === 'flywheel');
	return out;
}

/** An empty starting config for the wizard when no file is present. */
export function blankConfig(): OrgConfig {
	return orgConfigSchema.parse({
		org: { name: 'My Organization', allowed_email_domains: [] },
		service_lines: [{ key: 'pr', label: 'PR', deliverables: ['Placements'], reports: true }],
		team: { departments: ['Delivery', 'Sales', 'Operations'] },
		modules: { work: true, clients: true, team: true, growth: false, studio: false, management: false, ai_agents: false, client_portal: false },
	});
}
