// /data/[baseId] — Shows all tables in a selected base. Click a table → records.

import Card from '@/components/ui/Card';
import { getAdapter, DataAdapterError, type BaseDetail } from '@/lib/data';
import Link from 'next/link';
import { Table2, ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';
import { isSensitiveBase } from '@/lib/data/sensitiveBases';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { hasManageNativeTables } from '../bases/actions';
import MirrorPanel from './MirrorPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ baseId: string }>;
}

export default async function BasePage({ params }: PageProps) {
	const { baseId } = await params;

	// Personnel bases need people-management standing, not just the Data
	// module. Kept in step with /api/airtable/records, which enforces the same
	// rule on the pagination path.
	if (isSensitiveBase(baseId) && !canManagePeople(await loadSensitiveAccessContext())) {
		notFound();
	}

	let schema: BaseDetail | null = null;
	let error: string | null = null;

	try {
		schema = await getAdapter().getBaseSchema(baseId);
	} catch (e) {
		if (e instanceof DataAdapterError && e.status === 404) notFound();
		error = e instanceof DataAdapterError ? e.message : String(e);
	}

	// Phase 6 cutover tool: only people who can manage native tables see the
	// mirror controls (same gate as the /data/bases write actions).
	const canMirror = await hasManageNativeTables();

	return (
		<>
			<div className="mb-6">
				<div className="flex items-center gap-1 text-xs text-slate-500 mb-2">
					<Link href="/data" className="hover:underline">
						Data
					</Link>
					<ChevronRight className="w-3 h-3" />
					<span className="text-slate-400 font-mono">{baseId}</span>
				</div>
				<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
					{schema?.name ?? baseId}
				</h1>
				<p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
					{schema?.tables.length ?? 0} tables
				</p>
			</div>

			{error && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load schema:</strong> {error}
					</p>
				</Card>
			)}

			{canMirror && schema && (
				<Card className="mb-4 border-primary-200 dark:border-primary-800">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Mirror into native tables</h2>
					<MirrorPanel baseId={baseId} />
				</Card>
			)}

			<div className="space-y-2">
				{schema?.tables.map((t) => (
					<Link
						key={t.id}
						href={`/data/${baseId}/${t.id}`}
						className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors group"
					>
						<div className="flex items-center gap-3 min-w-0">
							<Table2 className="w-4 h-4 text-slate-400 shrink-0" />
							<div className="min-w-0">
								<p className="font-medium text-sm text-slate-900 dark:text-slate-100">
									{t.name}
								</p>
								<p className="text-xs text-slate-400">
									{t.fields.length} fields · {t.views.length} views ·{' '}
									<code className="font-mono">{t.id}</code>
								</p>
							</div>
						</div>
						<ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary-500 transition-colors" />
					</Link>
				))}
			</div>
		</>
	);
}
