// /admin/forms — settings for the Forms tool (Alex, 2026-09-14: settings
// under Admin, the tool under Data). What is configurable today: who builds
// (the can_build_forms() rule), the field types on offer, the logic
// operators, and where submissions land. Routing to other systems is the
// next slice (Pipeline); until then every submission lives in
// form_submissions and is readable from the form's Submissions view.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FIELD_TYPES, FIELD_TYPE_LABELS, OPS, OP_LABELS } from '@/lib/forms/logic';

export const metadata = { title: 'Forms settings' };
export const dynamic = 'force-dynamic';

export default async function FormsAdminPage() {
	const supabase = await createClient();
	const [{ count: formCount, error }, { count: subCount }] = await Promise.all([
		supabase.from('forms').select('id', { count: 'exact', head: true }),
		supabase.from('form_submissions').select('id', { count: 'exact', head: true }),
	]);

	return (
		<>
			<PageHeader
				title="Forms"
				description="Settings for the form builder. The tool itself (build, fill, read submissions) is under Data → Forms."
				actions={<Link href="/data/forms" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Open the tool →</Link>}
			/>
			<div className="space-y-4">
				{error ? (
					<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<p className="text-sm text-amber-800 dark:text-amber-300">Migration <code>0086_forms.sql</code> is written but not applied; the tables do not exist yet.</p>
					</Card>
				) : (
					<Card>
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
							<div><p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">Forms</p><p className="font-medium tabular-nums">{formCount ?? 0}</p></div>
							<div><p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400">Submissions</p><p className="font-medium tabular-nums">{subCount ?? 0}</p></div>
						</div>
					</Card>
				)}

				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Who can build</h2>
					<p className="text-xs text-slate-600 dark:text-slate-400">
						Admin, exec and people-managers. Anyone signed in can fill an open form; a form can allow anonymous submissions.
						To widen or narrow this, change the people-managers group on <Link href="/admin/people-managers" className="text-primary-600 hover:underline">Admin → People managers</Link>.
					</p>
				</Card>

				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Field types</h2>
					<div className="flex flex-wrap gap-1.5">
						{FIELD_TYPES.map((t) => <span key={t} className="text-2xs rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-600 dark:text-slate-400">{FIELD_TYPE_LABELS[t]}</span>)}
					</div>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pt-2">Conditional logic</h2>
					<p className="text-xs text-slate-600 dark:text-slate-400">
						Each field can carry one “show only if” rule against an earlier field. Operators:{' '}
						{OPS.map((o) => OP_LABELS[o]).join(' · ')}. Rules chain (a field whose controller is hidden is hidden too) and are re-evaluated on the server at submit, so a hidden answer is never stored.
					</p>
				</Card>

				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Where submissions go</h2>
					<p className="text-xs text-slate-600 dark:text-slate-400">
						Today: <code>form_submissions</code>, readable from each form’s Submissions view. Routing a form’s submissions into Airtable, Supabase tables or a notification is the Pipeline tool’s job (Data → Pipeline) once its native rules ship; a form will be a pipeline trigger.
					</p>
				</Card>
			</div>
		</>
	);
}
