// /data/[baseId]/[tableId] — Generic table viewer. Server fetches first page,
// hands off to BaseExplorerTable for client-side filter + load-more.

import Card from '@/components/ui/Card';
import {
	getAdapter,
	DataAdapterError,
	type BaseDetail,
	type DataRecord,
	type TableSchema,
} from '@/lib/data';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';
import BaseExplorerTable from './BaseExplorerTable';
import { isSensitiveBase } from '@/lib/data/sensitiveBases';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ baseId: string; tableId: string }>;
}

export default async function TablePage({ params }: PageProps) {
	const { baseId, tableId } = await params;

	// Same personnel gate as /data, /data/[baseId] and the pagination API.
	if (isSensitiveBase(baseId) && !canManagePeople(await loadSensitiveAccessContext())) {
		notFound();
	}

	let schema: BaseDetail | null = null;
	let table: TableSchema | undefined;
	let rows: DataRecord[] = [];
	let cursor: string | undefined;
	let error: string | null = null;

	try {
		schema = await getAdapter().getBaseSchema(baseId);
		table = schema.tables.find((t) => t.id === tableId);
		if (!table) notFound();

		const result = await getAdapter().list(baseId, tableId, { pageSize: 100 });
		rows = result.rows;
		cursor = result.cursor;
	} catch (e) {
		if (e instanceof DataAdapterError && e.status === 404) notFound();
		error = e instanceof DataAdapterError ? e.message : String(e);
	}

	return (
		<>
			<div className="mb-4">
				<div className="flex items-center gap-1 text-xs text-slate-500 mb-2 flex-wrap">
					<Link href="/data" className="hover:underline">
						Data
					</Link>
					<ChevronRight className="w-3 h-3" />
					<Link href={`/data/${baseId}`} className="hover:underline">
						{schema?.name ?? baseId}
					</Link>
					<ChevronRight className="w-3 h-3" />
					<span className="text-slate-700 dark:text-slate-300">
						{table?.name ?? tableId}
					</span>
				</div>
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
					{table?.name}
				</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
					{rows.length} loaded · {table?.fields.length ?? 0} fields ·{' '}
					{table?.views.length ?? 0} views
				</p>
			</div>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error}
					</p>
				</Card>
			)}

			{table && (
				<BaseExplorerTable
					baseId={baseId}
					tableId={tableId}
					table={table}
					initialRows={rows}
					initialCursor={cursor}
				/>
			)}
		</>
	);
}
