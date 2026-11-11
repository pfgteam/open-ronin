'use client';

import { useState, useTransition } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { formatRelative, formatDate, formatNumber } from '@/lib/format';
import {
	syncLocationsAction,
	syncContactsAction,
	syncOpportunitiesAction,
	setConnectionLabelAction,
	disconnectGhlAction,
} from '@/lib/ghl/actions';
import { Trash2, RefreshCw, MapPin, Users, TrendingUp, AlertCircle } from 'lucide-react';

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

interface Props {
	connections: ConnectionRow[];
	locations: LocationRow[];
	syncStates: SyncStateRow[];
}

const LABELS = [
	{ slug: '', name: '(none)' },
	{ slug: 'main', name: 'Main' },
	{ slug: 'beacon', name: 'Beacon' },
	{ slug: 'media', name: 'Media' },
];

export default function GhlConnectionList({ connections, locations, syncStates }: Props) {
	return (
		<div className="space-y-3">
			{connections.map((c) => (
				<ConnectionCard key={c.id} conn={c} locations={locations} syncStates={syncStates} />
			))}
		</div>
	);
}

function ConnectionCard({ conn, locations, syncStates }: { conn: ConnectionRow; locations: LocationRow[]; syncStates: SyncStateRow[] }) {
	const [pending, startTransition] = useTransition();
	const [label, setLabel] = useState(conn.label ?? '');
	const [busyResource, setBusyResource] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	const connLocations = locations.filter((l) => l.source_connection_id === conn.id);
	const locationSync = (locId: string, resource: string) =>
		syncStates.find((s) => s.connection_id === conn.id && s.resource === resource && s.ghl_location_id === locId);

	function run(action: () => Promise<{ ok: boolean; error?: string; result?: { fetched: number; upserted: number } }>, key: string) {
		setBusyResource(key);
		setStatus(null);
		startTransition(async () => {
			const r = await action();
			setBusyResource(null);
			if (!r.ok) setStatus('Error: ' + (r.error ?? 'unknown'));
			else if (r.result) setStatus(key + ': fetched ' + r.result.fetched + ', upserted ' + r.result.upserted);
			else setStatus(key + ': done');
		});
	}

	const expiresMs = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
	const expired = expiresMs && expiresMs < Date.now();

	return (
		<Card padding="none">
			<div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
							{conn.label ? conn.label.toUpperCase() : '(unlabeled)'}
						</h3>
						<Badge color={conn.scope === 'company' ? 'primary' : 'default'}>{conn.scope}</Badge>
						{expired && <Badge color="warning">token expired - will refresh on next call</Badge>}
						{conn.last_refresh_error && <Badge color="danger"><AlertCircle className="w-2.5 h-2.5 mr-0.5" />refresh error</Badge>}
					</div>
					<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 font-mono truncate">
						{conn.scope === 'company' ? 'company ' + conn.ghl_company_id : 'location ' + conn.ghl_location_id}
					</p>
				</div>
				<select
					value={label}
					onChange={(e) => {
						const v = e.target.value;
						setLabel(v);
						startTransition(async () => {
							await setConnectionLabelAction(conn.id, v || null);
						});
					}}
					className="text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:focus:border-primary-400 dark:focus:ring-primary-400"
				>
					{LABELS.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
				</select>
				<Button
					variant="ghost"
					size="sm"
					loading={busyResource === 'disconnect'}
					onClick={() => run(() => disconnectGhlAction(conn.id), 'disconnect')}
				>
					<Trash2 className="w-3 h-3" />
				</Button>
			</div>

			<div className="px-3 py-2 grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
				<SyncButton
					icon={<MapPin className="w-3 h-3" />}
					title="Locations"
					subtitle="Fetch sub-accounts"
					stat={syncStates.find((s) => s.connection_id === conn.id && s.resource === 'locations' && !s.ghl_location_id)}
					busy={busyResource === 'locations'}
					onClick={() => run(() => syncLocationsAction(conn.id), 'locations')}
				/>
			</div>

			{connLocations.length > 0 && (
				<div className="border-t border-slate-200 dark:border-slate-700">
					<div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 text-2xs uppercase text-slate-600 dark:text-slate-400">Per-location sync ({connLocations.length})</div>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{connLocations.map((loc) => {
							const contactsSync = locationSync(loc.ghl_location_id, 'contacts');
							const oppsSync = locationSync(loc.ghl_location_id, 'opportunities');
							return (
								<li key={loc.id} className="px-3 py-2 flex flex-wrap items-center gap-3">
									<div className="min-w-0 flex-1">
										<div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{loc.name}</div>
										<div className="text-2xs text-slate-600 dark:text-slate-400 font-mono">{loc.ghl_location_id}</div>
									</div>
									<MiniSyncButton
										icon={<Users className="w-3 h-3" />}
										label="Contacts"
										sync={contactsSync}
										busy={busyResource === ('contacts:' + loc.ghl_location_id)}
										onClick={() => run(() => syncContactsAction(conn.id, loc.ghl_location_id), 'contacts:' + loc.ghl_location_id)}
									/>
									<MiniSyncButton
										icon={<TrendingUp className="w-3 h-3" />}
										label="Opps"
										sync={oppsSync}
										busy={busyResource === ('opps:' + loc.ghl_location_id)}
										onClick={() => run(() => syncOpportunitiesAction(conn.id, loc.ghl_location_id), 'opps:' + loc.ghl_location_id)}
									/>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			<div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-2xs text-slate-600 dark:text-slate-400 flex items-center justify-between">
				<span>Installed {formatDate(conn.installed_at, 'MMM d, yyyy')} {conn.last_refresh_at && ' · token refreshed ' + formatRelative(conn.last_refresh_at)}</span>
				{pending && <span>Working...</span>}
			</div>
			{status && (
				<div className="px-3 py-1.5 text-2xs border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">{status}</div>
			)}
		</Card>
	);
}

function SyncButton({ icon, title, subtitle, stat, busy, onClick }: {
	icon: React.ReactNode;
	title: string;
	subtitle: string;
	stat?: SyncStateRow;
	busy: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			disabled={busy}
			className="text-left p-2 rounded-md border border-slate-200 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-700 disabled:opacity-50 transition-colors"
		>
			<div className="flex items-center gap-1.5">
				<span className="text-slate-500">{icon}</span>
				<span className="font-medium text-slate-900 dark:text-slate-100">{title}</span>
				{busy ? <RefreshCw className="w-3 h-3 animate-spin text-primary-500 ml-auto" /> : null}
			</div>
			<div className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">
				{stat?.last_synced_at
					? formatNumber(stat.last_count ?? 0) + ' rows · ' + formatRelative(stat.last_synced_at)
					: subtitle}
			</div>
			{stat?.last_error && <div className="text-2xs text-red-600 mt-0.5 truncate">{stat.last_error}</div>}
		</button>
	);
}

function MiniSyncButton({ icon, label, sync, busy, onClick }: {
	icon: React.ReactNode;
	label: string;
	sync?: SyncStateRow;
	busy: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			disabled={busy}
			className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs hover:bg-hover disabled:opacity-50 transition-colors"
		>
			{busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : icon}
			<span>{label}</span>
			{sync?.last_count != null && <span className="text-2xs text-slate-600 dark:text-slate-400 ml-1">{formatNumber(sync.last_count)}</span>}
		</button>
	);
}
