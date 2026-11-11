// /data/spreadsheets: a browser over the connected Google Sheets. Two tabs,
// state in the URL (?tab=connected|snapshots&source=<uuid>&sheet=<tab>).
//
// Connected: sheet_sources with Sync now, add by URL, disconnect (admin).
// Snapshots: the latest sheet_snapshots grid for a source and tab through
// BaseExplorerTable, cells that changed since the previous snapshot painted
// amber, CSV download. No editing here; the sheet is the editor.
//
// Reads use the user's session (sheet_sources_read_all, sheet_snapshots_read_all).

import Link from 'next/link';
import { clsx } from 'clsx';
import Card from '@/components/ui/Card';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { isElevatedRole } from '@/lib/permissions/constants';
import { getServiceAccountEmail } from '@/lib/metrics/sheetsClient';
import { buildSnapshotView, toTable, type SnapshotRow } from '@/lib/sheets/snapshot';
import { formatDate } from '@/lib/format';
import { FileSpreadsheet, Download, ExternalLink } from 'lucide-react';
import ConnectedSheets, { type SourceView } from './ConnectedSheets';
import SnapshotTable from './SnapshotTable';

export const dynamic = 'force-dynamic';

type Tab = 'connected' | 'snapshots';
const TABS: { key: Tab; label: string }[] = [
	{ key: 'connected', label: 'Connected sheets' },
	{ key: 'snapshots', label: 'Snapshots' },
];

interface PageProps {
	searchParams: Promise<{ tab?: string; source?: string; sheet?: string; header?: string }>;
}

const SOURCE_COLUMNS =
	'id, google_sheet_id, display_name, tabs, sync_interval_minutes, last_synced_at, last_sync_status, last_sync_error';

function href(params: { tab: Tab; source?: string; sheet?: string; header?: string }): string {
	const usp = new URLSearchParams();
	if (params.tab !== 'connected') usp.set('tab', params.tab);
	if (params.source) usp.set('source', params.source);
	if (params.sheet) usp.set('sheet', params.sheet);
	if (params.header) usp.set('header', params.header);
	const qs = usp.toString();
	return qs ? `/data/spreadsheets?${qs}` : '/data/spreadsheets';
}

export default async function SpreadsheetsPage({ searchParams }: PageProps) {
	const sp = await searchParams;
	const tab: Tab = sp.tab === 'snapshots' ? 'snapshots' : 'connected';
	const supabase = await createClient();
	const profile = await getAuthProfile();
	const canManage = isElevatedRole(profile?.role);

	const { data: sourceRows, error } = await supabase.from('sheet_sources').select(SOURCE_COLUMNS).order('display_name');
	const sources = (sourceRows ?? []) as Omit<SourceView, 'snapshot_rows'>[];

	// Row counts per source (one head query each; four sources today).
	const counts = await Promise.all(
		sources.map(async (s) => {
			const { count } = await supabase
				.from('sheet_snapshots')
				.select('id', { count: 'exact', head: true })
				.eq('source_id', s.id);
			return count ?? 0;
		}),
	);
	const sourceViews: SourceView[] = sources.map((s, i) => ({ ...s, snapshot_rows: counts[i] }));

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<FileSpreadsheet className="w-5 h-5 text-slate-400" />
						Spreadsheets
					</span>
				}
				description="Connected Google Sheets, synced on a schedule, browsable as snapshots. The sheet stays the editor."
			/>

			<div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 -mx-1 px-1 mb-4 overflow-x-auto">
				{TABS.map((t) => {
					const active = t.key === tab;
					return (
						<Link
							key={t.key}
							href={href({ tab: t.key, source: sp.source, sheet: sp.sheet })}
							aria-current={active ? 'page' : undefined}
							className={clsx(
								'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2',
								active
									? 'border-primary-600 text-primary-900 dark:text-primary-300 font-semibold'
									: 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100',
							)}
						>
							{t.label}
						</Link>
					);
				})}
			</div>

			{error && (
				<Callout tone="error" className="mb-4">
					Failed to load connected sheets: {error.message}
				</Callout>
			)}

			{tab === 'connected' ? (
				<ConnectedSheets sources={sourceViews} serviceAccountEmail={getServiceAccountEmail()} canManage={canManage} />
			) : (
				<Snapshots sources={sourceViews} sourceId={sp.source} sheet={sp.sheet} header={sp.header !== '0'} />
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// Snapshots tab
// ---------------------------------------------------------------------------

async function Snapshots({
	sources,
	sourceId,
	sheet,
	header,
}: {
	sources: SourceView[];
	sourceId?: string;
	sheet?: string;
	header: boolean;
}) {
	const supabase = await createClient();
	const source = sources.find((s) => s.id === sourceId) ?? sources[0];
	if (!source) {
		return (
			<Card>
				<p className="text-sm text-slate-600 dark:text-slate-400">Connect a sheet first; snapshots appear here after the first sync.</p>
			</Card>
		);
	}

	// Tabs with rows in the snapshot (a source with tabs [] means every tab).
	const { data: tabRows } = await supabase
		.from('sheet_snapshots')
		.select('tab')
		.eq('source_id', source.id)
		.limit(5000);
	const tabsPresent = Array.from(new Set((tabRows ?? []).map((r) => r.tab as string))).sort();
	const tabNames = tabsPresent.length > 0 ? tabsPresent : source.tabs;
	const tabName = tabNames.includes(sheet ?? '') ? (sheet as string) : tabNames[0];

	let rows: SnapshotRow[] = [];
	if (tabName) {
		const { data } = await supabase
			.from('sheet_snapshots')
			.select('row_index, row_data, synced_at')
			.eq('source_id', source.id)
			.eq('tab', tabName)
			.order('row_index', { ascending: true })
			.limit(20000);
		rows = (data ?? []) as SnapshotRow[];
	}

	const view = buildSnapshotView(rows);
	const { table, records } = toTable(view, { tabName: tabName ?? 'Sheet', headerRow: header });
	const csvHref = `/data/spreadsheets/export?source=${source.id}&tab=${encodeURIComponent(tabName ?? '')}`;

	return (
		<div className="space-y-4">
			<Card padding="sm">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
					<span className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Sheet</span>
					<div className="flex flex-wrap gap-1">
						{sources.map((s) => (
							<Chip key={s.id} href={href({ tab: 'snapshots', source: s.id })} active={s.id === source.id}>
								{s.display_name}
							</Chip>
						))}
					</div>
					{tabNames.length > 1 && (
						<>
							<span className="text-2xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Tab</span>
							<div className="flex flex-wrap gap-1">
								{tabNames.map((t) => (
									<Chip key={t} href={href({ tab: 'snapshots', source: source.id, sheet: t })} active={t === tabName}>
										{t}
									</Chip>
								))}
							</div>
						</>
					)}
					<span className="ml-auto flex items-center gap-3">
						<Link
							href={href({ tab: 'snapshots', source: source.id, sheet: tabName, header: header ? '0' : undefined })}
							className="text-slate-500 dark:text-slate-400 hover:underline"
						>
							{header ? 'First row is a header' : 'First row is data'}
						</Link>
						<a
							href={`https://docs.google.com/spreadsheets/d/${source.google_sheet_id}`}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
						>
							Open in Google Sheets
							<ExternalLink className="w-3 h-3" />
						</a>
						{rows.length > 0 && (
							<a
								href={csvHref}
								className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
							>
								<Download className="w-3.5 h-3.5" />
								Download CSV
							</a>
						)}
					</span>
				</div>
			</Card>

			{rows.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-600 dark:text-slate-400">
						No snapshot for {source.display_name}
						{tabName ? ` / ${tabName}` : ''} yet. Run Sync now on the Connected sheets tab.
					</p>
				</Card>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
						<span>
							Snapshot taken {view.syncedAt ? formatDate(view.syncedAt, 'MMM d, yyyy h:mm a') : 'never'}
						</span>
						{view.changedAt ? (
							<span className="inline-flex items-center gap-1.5">
								<span className="w-2.5 h-2.5 rounded-sm bg-amber-200 dark:bg-amber-800 ring-1 ring-amber-300 dark:ring-amber-700" />
								{view.changedKeys.length} {view.changedKeys.length === 1 ? 'cell' : 'cells'} changed vs the previous snapshot (
								{formatDate(view.changedAt, 'MMM d, h:mm a')})
							</span>
						) : (
							<span>No changes recorded since the first snapshot.</span>
						)}
					</div>
					<SnapshotTable sourceId={source.id} table={table} rows={records} changedKeys={view.changedKeys} />
				</>
			)}
		</div>
	);
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
	return (
		<Link
			href={href}
			className={clsx(
				'text-xs px-2.5 py-1 rounded-full border transition-colors',
				active
					? 'border-primary-500 bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
					: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
			)}
		>
			{children}
		</Link>
	);
}
