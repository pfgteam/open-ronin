'use client';

// Thin client wrapper so the server rendered Snapshots tab can hand
// BaseExplorerTable a highlight predicate (functions do not cross the
// server to client boundary; a Set of "recordId:fieldId" keys does).

import BaseExplorerTable from '@/app/(app)/data/[baseId]/[tableId]/BaseExplorerTable';
import type { DataRecord, TableSchema } from '@/lib/data';

interface Props {
	sourceId: string;
	table: TableSchema;
	rows: DataRecord[];
	/** "recordId:fieldId" for every cell that differs from the previous snapshot. */
	changedKeys: string[];
}

export default function SnapshotTable({ sourceId, table, rows, changedKeys }: Props) {
	const changed = new Set(changedKeys);
	return (
		<BaseExplorerTable
			baseId="sheets"
			tableId={sourceId}
			table={table}
			initialRows={rows}
			highlightCell={(row, field) => changed.has(`${row.id}:${field.id}`)}
		/>
	);
}
