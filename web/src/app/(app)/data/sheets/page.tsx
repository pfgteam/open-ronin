// /data/sheets: Google Sheets sync status plus Sync now. The full browser
// (add by URL, snapshots with change highlighting, CSV) is /data/spreadsheets;
// this page stays as the short status view and shares its components.

import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import Callout from '@/components/ui/Callout';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { isElevatedRole } from '@/lib/permissions/constants';
import { getServiceAccountEmail } from '@/lib/metrics/sheetsClient';
import { FileSpreadsheet } from 'lucide-react';
import ConnectedSheets, { type SourceView } from '../spreadsheets/ConnectedSheets';

export const dynamic = 'force-dynamic';

export default async function SheetsPage() {
	const supabase = await createClient();
	const profile = await getAuthProfile();
	const { data: sources, error } = await supabase
		.from('sheet_sources')
		.select('id, google_sheet_id, display_name, tabs, sync_interval_minutes, last_synced_at, last_sync_status, last_sync_error')
		.order('display_name', { ascending: true });

	const rows = (sources ?? []) as Omit<SourceView, 'snapshot_rows'>[];
	const counts = await Promise.all(
		rows.map(async (s) => {
			const { count } = await supabase
				.from('sheet_snapshots')
				.select('id', { count: 'exact', head: true })
				.eq('source_id', s.id);
			return count ?? 0;
		}),
	);
	const views: SourceView[] = rows.map((s, i) => ({ ...s, snapshot_rows: counts[i] }));

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<FileSpreadsheet className="w-5 h-5 text-slate-400" />
						Google Sheets
					</span>
				}
				description={
					<>
						{rows.length} sheet sources, synced with the service account. Browse snapshots at{' '}
						<Link href="/data/spreadsheets" className="text-primary-600 dark:text-primary-400 hover:underline">
							Spreadsheets
						</Link>
						.
					</>
				}
			/>

			{error && (
				<Callout tone="error" className="mb-4">
					Failed to load: {error.message}
				</Callout>
			)}

			<ConnectedSheets
				sources={views}
				serviceAccountEmail={getServiceAccountEmail()}
				canManage={isElevatedRole(profile?.role)}
			/>
		</>
	);
}
