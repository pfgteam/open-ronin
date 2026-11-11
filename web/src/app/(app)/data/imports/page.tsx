// /data/imports: the five step wizard plus the batch history.
//
// State lives in the URL (?batch=<id>&step=<upload|target|map|dry-run|commit>)
// and in the import_batches row, so a refresh or a second tab lands on the
// same step with the same file. The page is a server component that loads
// the batch and a sample of its rows; ImportWizard is the client shell that
// calls the server actions and pushes the URL forward.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import { getAdapter } from '@/lib/data';
import type { FieldSchema } from '@/lib/data/adapter';
import { columnsForTarget } from '@/lib/imports/engine';
import { stepForStatus, stepIndex, WIZARD_STEPS, type BatchRow, type WizardStep } from '@/lib/imports/types';
import ImportWizard from './ImportWizard';
import HistoryTable from './HistoryTable';

export const metadata = { title: 'Imports' };
export const dynamic = 'force-dynamic';

export interface RowPreview {
	row_number: number;
	action: string;
	target_id: string | null;
	reason: string | null;
	after: Record<string, unknown> | null;
}

export default async function ImportsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const sp = await searchParams;
	const batchId = typeof sp.batch === 'string' ? sp.batch : null;
	const requested = typeof sp.step === 'string' && (WIZARD_STEPS as readonly string[]).includes(sp.step) ? (sp.step as WizardStep) : null;

	const supabase = await createClient();

	const { data: historyRows, error: historyError } = await supabase
		.from('import_batches')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(50);
	const history = ((historyRows ?? []) as BatchRow[]).filter((b) => b.id !== batchId);
	const tableMissing = historyError?.message?.includes('import_batches') ?? false;

	let batch: BatchRow | null = null;
	let rows: RowPreview[] = [];
	let columns: ReturnType<typeof columnsForTarget> = [];
	let bases: { id: string; name: string }[] = [];

	if (batchId) {
		const { data } = await supabase.from('import_batches').select('*').eq('id', batchId).maybeSingle();
		batch = (data as BatchRow | null) ?? null;
	}

	if (batch?.target) {
		let fields: FieldSchema[] | undefined;
		if (batch.target === 'airtable' && batch.target_ref) {
			try {
				const i = batch.target_ref.indexOf('/');
				const base = await getAdapter().getBaseSchema(batch.target_ref.slice(0, i));
				const name = batch.target_ref.slice(i + 1);
				fields = base.tables.find((t) => t.id === name || t.name === name)?.fields ?? [];
			} catch {
				fields = [];
			}
		}
		columns = columnsForTarget(batch.target, fields);
	}

	if (batch && ['dry_run', 'committing', 'committed', 'rolled_back', 'failed'].includes(batch.status)) {
		const { data } = await supabase
			.from('import_rows')
			.select('row_number, action, target_id, reason, after')
			.eq('batch_id', batch.id)
			.order('row_number')
			.limit(200);
		rows = (data ?? []) as RowPreview[];
	}

	if (batch && !batch.target) {
		try {
			bases = (await getAdapter().listBases()).map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			bases = [];
		}
	}

	// The URL may ask for a step the batch has not reached; clamp to what the
	// row allows so a stale link cannot show a commit button for a draft.
	const furthest = batch ? stepForStatus(batch.status) : 'upload';
	const step: WizardStep = requested && stepIndex(requested) <= stepIndex(furthest) ? requested : furthest;

	return (
		<>
			<PageHeader
				title="Imports"
				description="CSV or XLSX into a Supabase table or an Airtable table, with a dry run before and a rollback after."
				actions={
					batch ? (
						<Link href="/data/imports" className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
							New import
						</Link>
					) : null
				}
			/>

			{tableMissing ? (
				<Card className="mb-6">
					<p className="text-sm text-slate-600 dark:text-slate-400">
						Imports aren&apos;t switched on yet. Ask Ops to enable them.
					</p>
				</Card>
			) : (
				<ImportWizard batch={batch} step={step} columns={columns} rows={rows} bases={bases} />
			)}

			{!tableMissing && (
				<section className="mt-8">
					<div className="flex items-center gap-2 mb-2">
						<h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">History</h2>
						<span className="text-xs tabular-nums text-slate-400">{history.length}</span>
						<div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
					</div>
					<HistoryTable batches={history} />
				</section>
			)}
		</>
	);
}
