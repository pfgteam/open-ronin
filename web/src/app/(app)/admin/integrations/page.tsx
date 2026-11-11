// /admin/integrations — Connections status. Shows every external service
// that's wired up + its health.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import {
	Database,
	Cloud,
	FileSpreadsheet,
	Mail,
	Lock,
	Globe,
	Bot,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getAdapter, DataAdapterError } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Conn {
	id: string;
	name: string;
	icon: LucideIcon;
	status: 'ok' | 'fail' | 'unknown' | 'planned';
	detail: string;
	links?: { label: string; href: string }[];
}

async function checkConnections(): Promise<Conn[]> {
	const out: Conn[] = [];

	// Supabase auth
	try {
		const sb = await createClient();
		const { error } = await sb.from('profiles').select('id', { head: true, count: 'exact' });
		out.push({
			id: 'supabase',
			name: 'Supabase',
			icon: Database,
			status: error ? 'fail' : 'ok',
			detail: error ? error.message : 'Auth + profiles + side store · us-west-2',
			links: [{ label: 'Project', href: 'https://supabase.com/dashboard' }],
		});
	} catch (e) {
		out.push({
			id: 'supabase',
			name: 'Supabase',
			icon: Database,
			status: 'fail',
			detail: e instanceof Error ? e.message : String(e),
		});
	}

	// Airtable
	try {
		const bases = await getAdapter().listBases();
		out.push({
			id: 'airtable',
			name: 'Airtable',
			icon: Cloud,
			status: 'ok',
			detail: `${bases.length} bases accessible · Open Ronin workspace`,
			links: [{ label: 'Diagnostic', href: '/admin/airtable-test' }],
		});
	} catch (e) {
		out.push({
			id: 'airtable',
			name: 'Airtable',
			icon: Cloud,
			status: 'fail',
			detail: e instanceof DataAdapterError ? e.message : String(e),
		});
	}

	// Google Sheets / SA
	const hasSA = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
	const hasOAuth = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID);
	out.push({
		id: 'google-sheets',
		name: 'Google Sheets',
		icon: FileSpreadsheet,
		status: hasSA ? 'ok' : 'fail',
		detail: hasSA
			? 'Service account configured · 4 sheets seeded into sheet_sources'
			: 'GOOGLE_SERVICE_ACCOUNT_JSON not set',
		links: [{ label: 'View sheets', href: '/data/sheets' }],
	});
	out.push({
		id: 'google-oauth',
		name: 'Google Sign-In',
		icon: Lock,
		status: hasOAuth ? 'ok' : 'fail',
		detail: hasOAuth
			? 'OAuth client configured · @example.com Workspace'
			: 'GOOGLE_OAUTH_CLIENT_ID not set',
	});

	// Resend
	const hasResend = Boolean(process.env.RESEND_API_KEY);
	out.push({
		id: 'resend',
		name: 'Resend',
		icon: Mail,
		status: hasResend ? 'ok' : 'fail',
		detail: hasResend
			? `Transactional email · from ${process.env.RESEND_FROM_EMAIL ?? '(unset)'}`
			: 'RESEND_API_KEY not set',
	});

	// Vercel
	out.push({
		id: 'vercel',
		name: 'Vercel',
		icon: Globe,
		status: 'ok',
		detail: 'Hosting · pdx1 (Portland, USA West) · auto-deploy on push to `vercel`',
	});

	// Planned / future — billing stack
	out.push({
		id: 'nmi',
		name: 'NMI Portal',
		icon: Lock,
		status: 'planned',
		detail: 'Primary card processor · recurring charges + card-on-file',
	});
	out.push({
		id: 'quickbooks',
		name: 'QuickBooks',
		icon: FileSpreadsheet,
		status: 'planned',
		detail: 'ACH bank info + invoice ledger (source of truth)',
	});
	out.push({
		id: 'stripe',
		name: 'Stripe',
		icon: Lock,
		status: 'planned',
		detail: 'Secondary processor · used for select clients',
	});

	// GoHighLevel — OAuth marketplace app with per-sub-account installs
	try {
		const sb = await createClient();
		const { data: ghlConns } = await sb
			.from('ghl_connections')
			.select('id, label, last_refresh_error, disconnected_at')
			.is('disconnected_at', null);
		const conns = ghlConns ?? [];
		const hasConfig = Boolean(process.env.GHL_CLIENT_ID && process.env.GHL_CLIENT_SECRET && process.env.GHL_REDIRECT_URI);
		const hasErrors = conns.some((c) => c.last_refresh_error);
		const labels = conns.map((c) => c.label).filter(Boolean).join(', ') || '(unlabeled)';
		out.push({
			id: 'ghl',
			name: 'GoHighLevel',
			icon: Bot,
			status: conns.length === 0 ? (hasConfig ? 'unknown' : 'planned') : hasErrors ? 'fail' : 'ok',
			detail: conns.length === 0
				? hasConfig ? 'Configured; no sub-accounts installed yet' : 'Marketplace app not yet configured (GHL_CLIENT_ID/SECRET/REDIRECT_URI)'
				: `${conns.length} sub-account${conns.length === 1 ? '' : 's'} connected: ${labels}`,
			links: [{ label: 'Manage', href: '/admin/integrations/ghl' }],
		});
	} catch (e) {
		out.push({
			id: 'ghl',
			name: 'GoHighLevel',
			icon: Bot,
			status: 'unknown',
			detail: e instanceof Error ? e.message : String(e),
			links: [{ label: 'Manage', href: '/admin/integrations/ghl' }],
		});
	}
	out.push({
		id: 'cision',
		name: 'Cision',
		icon: Bot,
		status: 'planned',
		detail: 'Media monitoring + outlet database',
	});
	// Nous (0138): the Flywheel AI visibility panel. Key stored encrypted on
	// fw_ai_connections; OFF until entered + enabled in Admin → Flywheel → AI panel.
	try {
		const sb = createClient();
		const { data: nous } = await (await sb).from('fw_ai_connections').select('is_enabled, encrypted_api_key, monthly_cap_usd, spend_month_usd, last_ok_at, last_error, last_models_sync_at').eq('provider', 'nous').maybeSingle();
		const n = nous as { is_enabled: boolean; encrypted_api_key: string | null; monthly_cap_usd: number; spend_month_usd: number; last_ok_at: string | null; last_error: string | null; last_models_sync_at: string | null } | null;
		out.push({
			id: 'nous',
			name: 'Nous (AI visibility panel)',
			icon: Bot,
			status: !n ? 'unknown' : !n.encrypted_api_key ? 'planned' : n.last_error ? 'fail' : n.is_enabled ? 'ok' : 'unknown',
			detail: !n
				? 'Connection row not readable (manage_flywheel) or 0138 not applied'
				: !n.encrypted_api_key
					? 'No key yet — enter the Nous API key to turn on the ~200-model AI visibility panel'
					: `${n.is_enabled ? 'Enabled' : 'Key stored, switch OFF'} · $${Number(n.spend_month_usd).toFixed(2)} of $${Number(n.monthly_cap_usd).toFixed(0)} this month${n.last_error ? ` · ${n.last_error.slice(0, 80)}` : ''}`,
			links: [{ label: 'Manage', href: '/admin/flywheel?tab=ai' }],
		});
	} catch {
		out.push({ id: 'nous', name: 'Nous (AI visibility panel)', icon: Bot, status: 'unknown', detail: 'Could not read the connection row', links: [{ label: 'Manage', href: '/admin/flywheel?tab=ai' }] });
	}
	out.push({
		id: 'ollama',
		name: 'Ollama (on-prem)',
		icon: Bot,
		status: 'planned',
		detail: 'Cloudflare Tunnel → Mac Studio + Mac Mini · Qwen models',
	});

	return out;
}

const STATUS_COLORS: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
	ok: 'success',
	fail: 'danger',
	unknown: 'warning',
	planned: 'default',
};

const STATUS_LABELS: Record<string, string> = {
	ok: 'OK',
	fail: 'FAIL',
	unknown: 'UNKNOWN',
	planned: 'PLANNED',
};

export default async function ConnectionsPage() {
	const conns = await checkConnections();
	const active = conns.filter((c) => c.status === 'ok').length;
	const failing = conns.filter((c) => c.status === 'fail').length;

	return (
		<>
			<PageHeader
				title="Connections"
				description={
					<>
						{active} active{failing > 0 && ` · ${failing} failing`} ·{' '}
						{conns.length - active - failing} planned
					</>
				}
			/>

			<div className="space-y-2">
				{conns.map((c) => {
					const Icon = c.icon;
					return (
						<Card key={c.id} padding="md">
							<div className="flex items-start gap-3">
								<div className="w-9 h-9 rounded-md bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
									<Icon className="w-4 h-4 text-slate-500" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<p className="font-medium text-sm text-slate-900 dark:text-slate-100">
											{c.name}
										</p>
										<Badge color={STATUS_COLORS[c.status]}>
											{STATUS_LABELS[c.status]}
										</Badge>
									</div>
									<p className="text-xs text-slate-500 dark:text-slate-400">
										{c.detail}
									</p>
									{c.links && c.links.length > 0 && (
										<div className="mt-2 flex flex-wrap gap-3">
											{c.links.map((l) => (
												<Link
													key={l.href}
													href={l.href}
													className="text-xs text-primary-600 hover:underline"
												>
													{l.label} →
												</Link>
											))}
										</div>
									)}
								</div>
							</div>
						</Card>
					);
				})}
			</div>
		</>
	);
}
