// /team/org-chart/import - CSV uploader for org chart data.
//
// Expects columns: name, email (optional), title, department, manager_email or
// manager_name. The import resolves to existing Supabase profiles by email, or
// stages new rows under "Org Chart Imports" (a graph_documents row) when no
// profile match is found.

import Card from '@/components/ui/Card';
import Link from 'next/link';
import { ChevronLeft, FileSpreadsheet } from 'lucide-react';
import ImportForm from './ImportForm';

export const dynamic = 'force-dynamic';

export default function ImportOrgChartPage() {
	return (
		<>
			<Link href="/team/org-chart" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Back to org chart
			</Link>

			<h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Import org chart</h1>
			<p className="text-sm text-slate-500 mt-1 mb-4">
				Drop a CSV with columns: <code>name</code>, <code>email</code> (optional), <code>title</code>,
				<code> department</code>, <code>manager_email</code> or <code>manager_name</code>. Rows with a matching
				profile email update the manager on the existing profile; non-matches go into a graph
				document for review.
			</p>

			<Card>
				<div className="flex items-center gap-3 mb-4 text-slate-500">
					<FileSpreadsheet className="w-5 h-5" />
					<div className="text-sm">
						<strong className="text-slate-700 dark:text-slate-200">Tip:</strong> a sample CSV column header line is:
						<code className="block mt-1 text-2xs bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded-md">name,email,title,department,manager_name,manager_email</code>
					</div>
				</div>
				<ImportForm />
			</Card>
		</>
	);
}
