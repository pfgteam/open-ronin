// /media/opps — Media Opportunities across all clients.
// Source: Client Media → Media Opportunities

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { BASE_IDS, DataAdapterError, type DataRecord } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { resolveLinkNames } from '@/app/(app)/clients/[id]/_lib';
import MediaOppsTable, { type MediaOppFields } from './MediaOppsTable';

export const metadata = { title: 'Media Opportunities' };


export const dynamic = 'force-dynamic';

async function fetchOpps(): Promise<{
	rows: DataRecord<MediaOppFields>[];
	truncated: boolean;
	error: string | null;
}> {
	const fields = [
		'Media Opp',
		'Outlet',
		'Outlet URL',
		'Reach',
		'Live Date',
		'Live Link',
		'Date Secured',
		'Status',
		'Category',
		'Opp Type',
		'Media Tier',
		'Client',
		'Story Title',
		'Potential Story / Angle',
		'Secured By',
		'Date Added',
	];
	try {
		const { rows, truncated } = await listFullTable<MediaOppFields>(
			BASE_IDS.CLIENT_MEDIA,
			'Media Opportunities',
			{ fields },
		);
		return { rows, truncated, error: null };
	} catch (e) {
		return {
			rows: [],
			truncated: false,
			error:
				e instanceof DataAdapterError
					? `${e.status} — ${e.message}`
					: e instanceof Error
						? e.message
						: String(e),
		};
	}
}

export default async function MediaOppsPage({
	searchParams,
}: {
	searchParams: Promise<{ client?: string }>;
}) {
	// ?client=<name> arrives from the "View all" link on a client detail page
	// (clients/[id]/page.tsx). It used to point at /media, whose redirect to
	// this route dropped the query string, so the link landed on the
	// unfiltered table and the name had to be retyped.
	const { client } = await searchParams;
	const { rows, truncated, error } = await fetchOpps();

	// The REST API returns the Client link as string[] of rec ids — resolve
	// to {id, name} server-side so the table's Client column and client
	// search actually work (they rendered '—' forever, 18/08 QA audit).
	const rawClientIds = rows.flatMap((r) => (r.fields.Client ?? []) as unknown as string[]);
	const clientNames = await resolveLinkNames(
		BASE_IDS.CLIENT_MEDIA,
		'Contract Agreement',
		rawClientIds.filter((v) => typeof v === 'string'),
		'Client',
	);
	for (const r of rows) {
		const ids = (r.fields.Client ?? []) as unknown as string[];
		r.fields.Client = ids
			.filter((v) => typeof v === 'string')
			.map((cid) => ({ id: cid, name: clientNames.get(cid) }));
	}

	return (
		<>
			<PageHeader
				title="Media Opps"
				description={`Live from Airtable · Client Media · Media Opportunities · ${rows.length} records`}
			/>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error}
					</p>
				</Card>
			)}

			{truncated && (
				<Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
					<p className="text-sm text-amber-800 dark:text-amber-300">
						<strong>Showing the first {rows.length} records only.</strong> The table
						has more rows than this page reads, so filters and counts below cover
						this slice, not everything.
					</p>
				</Card>
			)}

			<MediaOppsTable rows={rows} initialSearch={client ?? ''} />
		</>
	);
}
