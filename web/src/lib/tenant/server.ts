// Server readers for the organisation config (org_settings, service_lines).
// Read with the service role so pre-login pages (login, careers, public forms)
// get the org name too, cached across requests and busted by ORG_TAG when the
// wizard or Admin saves. Fails soft to the defaults so a missing table never
// takes the app down.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unstable_cache } from 'next/cache';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const ORG_TAG = 'org-settings';

export interface OrgSettings {
	org_name: string;
	org_domain: string | null;
	org_type: string | null;
	allowed_email_domains: string[];
	timezone: string;
	currency: string;
	owner_email: string | null;
	owner_name: string | null;
	support_email: string | null;
	app_url: string | null;
	modules: Record<string, boolean>;
	client_portal: boolean;
	auth_methods: string[];
	packages: unknown[];
	setup_completed_at: string | null;
}

export interface ServiceLineRow {
	key: string;
	label: string;
	deliverables: string[];
	reports: boolean;
	sort: number;
}

function envDomains(): string[] {
	return (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? '')
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
}

export const DEFAULT_ORG: OrgSettings = {
	org_name: process.env.NEXT_PUBLIC_ORG_NAME || 'Open Ronin',
	org_domain: null,
	org_type: null,
	allowed_email_domains: envDomains(),
	timezone: 'UTC',
	currency: 'USD',
	owner_email: null,
	owner_name: null,
	support_email: null,
	app_url: process.env.NEXT_PUBLIC_APP_URL ?? null,
	modules: {},
	client_portal: false,
	auth_methods: ['magic_link'],
	packages: [],
	setup_completed_at: null,
};

async function readOrg(): Promise<OrgSettings & { _missing?: boolean }> {
	try {
		if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return { ...DEFAULT_ORG, _missing: true };
		const supabase = createServiceRoleClient();
		const { data, error } = await supabase.from('org_settings').select('*').limit(1).maybeSingle();
		if (error || !data) return { ...DEFAULT_ORG, _missing: true };
		const row = data as Partial<OrgSettings>;
		return {
			...DEFAULT_ORG,
			...row,
			allowed_email_domains: row.allowed_email_domains?.length ? row.allowed_email_domains : DEFAULT_ORG.allowed_email_domains,
		} as OrgSettings;
	} catch {
		return { ...DEFAULT_ORG, _missing: true };
	}
}

/** Cached org settings (10 min, busted by revalidateTag(ORG_TAG)). */
export const getOrgSettings = unstable_cache(readOrg, ['org-settings-v1'], { tags: [ORG_TAG], revalidate: 600 });

/** Uncached read, for the setup gate (must see a just-finished wizard). */
export async function getOrgSettingsFresh() {
	return readOrg();
}

async function readServiceLines(): Promise<ServiceLineRow[]> {
	try {
		if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
		const supabase = createServiceRoleClient();
		const { data, error } = await supabase.from('service_lines').select('key, label, deliverables, reports, sort').eq('is_active', true).order('sort');
		if (error) return [];
		return (data ?? []) as ServiceLineRow[];
	} catch {
		return [];
	}
}
export const getServiceLines = unstable_cache(readServiceLines, ['service-lines-v1'], { tags: [ORG_TAG], revalidate: 600 });

/** Label for a service-line key, falling back to the key itself. */
export async function serviceLineLabel(key: string | null | undefined): Promise<string> {
	if (!key) return '';
	const lines = await getServiceLines();
	return lines.find((l) => l.key === key)?.label ?? key;
}

/** Email domains that count as "us" (internal staff), lowercased. */
export async function getOrgEmailDomains(): Promise<Set<string>> {
	const org = await getOrgSettings();
	return new Set(org.allowed_email_domains.map((d) => d.toLowerCase()));
}

export async function isOrgEmail(email: string | null | undefined): Promise<boolean> {
	if (!email) return false;
	const domains = await getOrgEmailDomains();
	return domains.has(email.split('@')[1]?.toLowerCase() ?? '');
}

/**
 * open-ronin.config.yaml on disk, if the install put one there (Step 0 of
 * INSTALL.md writes it to the repo root). OPEN_RONIN_CONFIG overrides the
 * path. Returns null when absent; the wizard then starts blank.
 */
export function readConfigFile(): { path: string; text: string } | null {
	const candidates = [
		process.env.OPEN_RONIN_CONFIG,
		path.resolve(process.cwd(), 'open-ronin.config.yaml'),
		path.resolve(process.cwd(), '..', 'open-ronin.config.yaml'),
	].filter((p): p is string => Boolean(p));
	for (const p of candidates) {
		try {
			if (existsSync(p)) return { path: p, text: readFileSync(p, 'utf8') };
		} catch {
			// unreadable: try the next candidate
		}
	}
	return null;
}
