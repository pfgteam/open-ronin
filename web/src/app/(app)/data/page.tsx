// /data — Data root, native-first (phase 6 of NATIVE_TABLES_PLAN.md).
// Native tables (nt_tables) lead; the Airtable bases stay below as the
// read-only legacy explorer until the sunset completes.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { getAdapter, DataAdapterError } from '@/lib/data';
import Link from 'next/link';
import { Database, Table2, RefreshCw } from 'lucide-react';
import { isSensitiveBase, HIDDEN_BASE_RE } from '@/lib/data/sensitiveBases';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Data' };


export const dynamic = 'force-dynamic';

interface NativeTableRow {
	id: string;
	name: string;
	description: string | null;
	source: { kind?: string; base_name?: string; table_name?: string; mirrored_at?: string } | null;
	nt_rows: Array<{ count: number }> | { count: number } | null;
}

function countOf(rel: NativeTableRow['nt_rows']): number {
	if (Array.isArray(rel)) return Number(rel[0]?.count ?? 0);
	if (rel && typeof rel === 'object') return Number(rel.count ?? 0);
	return 0;
}

export default async function DataIndexPage() {
	let bases: { id: string; name: string }[] = [];
	let hiddenCount = 0;
	let error: string | null = null;

	// Native tables first. `source` only exists once 0109 is applied; fall
	// back to the 0096 column set so the page never breaks on the gap.
	const supabase = await createClient();
	let native: NativeTableRow[] = [];
	{
		const withSource = await supabase.from('nt_tables').select('id, name, description, source, nt_rows(count)').order('order_key').order('name');
		if (!withSource.error) {
			native = (withSource.data ?? []) as unknown as NativeTableRow[];
		} else {
			const plain = await supabase.from('nt_tables').select('id, name, description, nt_rows(count)').order('order_key').order('name');
			native = ((plain.data ?? []) as unknown as Omit<NativeTableRow, 'source'>[]).map((t) => ({ ...t, source: null }));
		}
	}

	// Personnel bases only appear for people-managers / exec / admin, matching
	// what /data/[baseId] and /api/airtable/records now enforce.
	const canSeePersonnel = canManagePeople(await loadSensitiveAccessContext());

	try {
		const all = await getAdapter().listBases();
		const visible = all.filter(
			(b) =>
				!HIDDEN_BASE_RE.test(b.name) && (canSeePersonnel || !isSensitiveBase(b.id)),
		);
		hiddenCount = all.length - visible.length;
		visible.sort((a, b) => a.name.localeCompare(b.name));
		bases = visible;
	} catch (e) {
		error = e instanceof DataAdapterError ? e.message : String(e);
	}

	return (
		<>
			<PageHeader
				title="Data"
				description={
					<>
						{native.length} native table{native.length === 1 ? '' : 's'} · {bases.length} legacy Airtable bases
						{hiddenCount > 0 && (
							<span className="text-slate-400">
								{' '}
								· {hiddenCount} hidden
								{canSeePersonnel
									? ' (per-publicist Metrics & Milestones)'
									: ' (per-publicist Metrics & Milestones, personnel bases)'}
							</span>
						)}
					</>
				}
			/>

			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tables</h2>
				<Link href="/data/bases" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Manage tables</Link>
			</div>
			{native.length === 0 ? (
				<Card className="mb-6">
					<p className="text-sm text-slate-600 dark:text-slate-300">
						No native tables yet.{' '}
						<Link href="/data/bases" className="font-medium text-primary-700 dark:text-primary-300 underline">Create one</Link>
						{' '}or open an Airtable base below and mirror a table into the native layer.
					</p>
				</Card>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
					{native.map((t) => (
						<Link
							key={t.id}
							href={`/data/base/${t.id}`}
							className="block p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors duration-150"
						>
							<div className="flex items-start gap-3">
								<Table2 className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
								<div className="min-w-0">
									<p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{t.name}</p>
									<p className="text-xs text-slate-400 truncate">
										{countOf(t.nt_rows)} rows
										{t.source?.kind === 'airtable' && (
											<span className="inline-flex items-center gap-1 ml-2 text-slate-400" title={`Mirrored from Airtable ${t.source.base_name ?? ''} / ${t.source.table_name ?? ''}${t.source.mirrored_at ? ` on ${new Date(t.source.mirrored_at).toLocaleDateString()}` : ''}`}>
												<RefreshCw className="w-3 h-3" /> mirror
											</span>
										)}
									</p>
								</div>
							</div>
						</Link>
					))}
				</div>
			)}

			<div className="flex items-center justify-between mb-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Legacy Airtable bases</h2>
				<span className="text-2xs text-slate-400 dark:text-slate-500">read-only · sunset target EOM</span>
			</div>
			<Card className="mb-4 border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/30">
				<p className="text-sm text-slate-700 dark:text-slate-300">
					Airtable is being sunset. Open a base and use <strong>Mirror into native tables</strong> to copy a table into the native layer; new data belongs in{' '}
					<Link href="/data/bases" className="font-medium text-primary-700 dark:text-primary-300 underline">
						Tables
					</Link>
					.
				</p>
			</Card>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load bases:</strong> {error}
					</p>
				</Card>
			)}

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{bases.map((b) => (
					<Link
						key={b.id}
						href={`/data/${b.id}`}
						className="block p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors duration-150"
					>
						<div className="flex items-start gap-3">
							<Database className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
							<div className="min-w-0">
								<p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
									{b.name}
								</p>
								<p className="text-xs text-slate-400 font-mono truncate">{b.id}</p>
							</div>
						</div>
					</Link>
				))}
			</div>
		</>
	);
}
