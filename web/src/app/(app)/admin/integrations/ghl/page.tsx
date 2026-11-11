// /admin/integrations/ghl - GHL connection management.
// One connection per sub-account: MAIN_ORG, Beacon, Media (plus any others).

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Link from 'next/link';
import { createClient, getAuthUser } from '@/lib/supabase/server';
import { isGhlConfigured } from '@/lib/ghl/config';
import GhlConnectionList from './GhlConnectionList';
import { Bot, AlertCircle, ChevronLeft } from 'lucide-react';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface PageProps {
	searchParams: Promise<{ error?: string }>;
}

interface ConnectionRow {
	id: string;
	scope: 'location' | 'company';
	ghl_company_id: string | null;
	ghl_location_id: string | null;
	label: string | null;
	scopes: string | null;
	expires_at: string | null;
	installed_at: string;
	last_refresh_at: string | null;
	last_refresh_error: string | null;
	disconnected_at: string | null;
}

interface LocationRow {
	id: string;
	ghl_location_id: string;
	name: string;
	label: string | null;
	source_connection_id: string | null;
}

interface SyncStateRow {
	connection_id: string;
	resource: string;
	ghl_location_id: string | null;
	status: string;
	last_synced_at: string | null;
	last_count: number | null;
	last_error: string | null;
}

const LABEL_PRESETS = [
	{ slug: 'main', name: 'Main' },
	{ slug: 'beacon', name: 'Beacon' },
	{ slug: 'media', name: 'Media' },
];

export default async function GhlAdminPage({ searchParams }: PageProps) {
	const sp = await searchParams;
	const supabase = await createClient();

	const user = await getAuthUser();
	if (!user) {
		return (
			<>
				<Card><p className="text-sm text-slate-500 text-center py-6">Sign in to continue.</p></Card>
			</>
		);
	}

	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
	if (!profile || !['exec', 'admin'].includes(profile.role ?? '')) {
		return (
			<>
				<Card>
					<div className="text-center py-10 text-slate-500">
						<AlertCircle className="w-8 h-8 mx-auto text-slate-300 mb-2" />
						<p className="text-sm">Exec or admin only.</p>
					</div>
				</Card>
			</>
		);
	}

	const [{ data: connections }, { data: locations }, { data: syncRows }] = await Promise.all([
		supabase
			.from('ghl_connections')
			.select('id, scope, ghl_company_id, ghl_location_id, label, scopes, expires_at, installed_at, last_refresh_at, last_refresh_error, disconnected_at')
			.is('disconnected_at', null)
			.order('installed_at'),
		supabase
			.from('ghl_locations')
			.select('id, ghl_location_id, name, label, source_connection_id'),
		supabase
			.from('ghl_sync_state')
			.select('connection_id, resource, ghl_location_id, status, last_synced_at, last_count, last_error'),
	]);

	const conns = (connections ?? []) as ConnectionRow[];
	const locs = (locations ?? []) as LocationRow[];
	const sync = (syncRows ?? []) as SyncStateRow[];

	const installedLabels = new Set(conns.map((c) => c.label ?? '').filter(Boolean));
	const configured = isGhlConfigured();

	return (
		<>
			<Link href="/admin/integrations" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Connections
			</Link>

			<div className="flex items-start justify-between mb-4">
				<div>
					<div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
						<Bot className="w-3.5 h-3.5" /> Integrations · GoHighLevel
					</div>
					<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">GHL OAuth Connections</h1>
					<p className="text-sm text-slate-500 mt-1">
						One install per sub-account. Open Ronin, Beacon, and Media each have their own GHL.
					</p>
				</div>
			</div>

			{!configured && (
				<Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
					<div className="text-sm text-amber-800 dark:text-amber-300">
						<strong>Not configured.</strong> Set these env vars before installing:
						<ul className="mt-2 ml-4 list-disc text-xs">
							<li><code>GHL_CLIENT_ID</code></li>
							<li><code>GHL_CLIENT_SECRET</code></li>
							<li><code>GHL_REDIRECT_URI</code> (set to <code>https://your-domain/api/ghl/callback</code>)</li>
							<li><code>GHL_TOKEN_ENC_KEY</code> (64 hex chars; <code>openssl rand -hex 32</code>)</li>
						</ul>
						<p className="mt-2">Create the marketplace app at <a href="https://marketplace.gohighlevel.com/" target="_blank" rel="noreferrer" className="underline">marketplace.gohighlevel.com</a>.</p>
					</div>
				</Card>
			)}

			{sp.error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300"><strong>OAuth error:</strong> {sp.error}</p>
				</Card>
			)}

			<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Install or reconnect</h2>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
				{LABEL_PRESETS.map((p) => {
					const installed = installedLabels.has(p.slug);
					return (
						<Card key={p.slug} className={installed ? 'border-green-300 dark:border-green-800' : ''}>
							<div className="flex items-start justify-between">
								<div>
									<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</h3>
									<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">Sub-account label <code>{p.slug}</code></p>
								</div>
								{installed && <Badge color="success">Connected</Badge>}
							</div>
							<a
								href={configured ? `/api/ghl/install?label=${p.slug}` : '#'}
								aria-disabled={!configured}
								className={`transition-colors mt-3 inline-flex items-center justify-center px-2.5 py-1.5 rounded-md text-xs font-medium w-full bg-primary-600 text-white ${
									configured ? 'hover:bg-primary-700' : 'opacity-50 pointer-events-none'
								}`}
							>
								{installed ? 'Reconnect' : 'Connect'}
							</a>
						</Card>
					);
				})}
			</div>

			<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">Active connections ({conns.length})</h2>
			{conns.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 text-center py-6">No GHL connections yet.</p>
				</Card>
			) : (
				<GhlConnectionList connections={conns} locations={locs} syncStates={sync} />
			)}

			<p className="text-2xs text-slate-600 dark:text-slate-400 mt-4">
				Tokens are stored encrypted (AES-256-GCM, <code>GHL_TOKEN_ENC_KEY</code>). Access tokens refresh automatically when within 1 minute of expiry.
				Last seen: connection refresh timestamps · {conns.length > 0 && conns[0].last_refresh_at ? formatRelative(conns[0].last_refresh_at) : '—'}.
			</p>
		</>
	);
}
