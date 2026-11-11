// /data/forms/[slug]/submissions — the inbox for one form (0158): newest
// first, status filter, a few key answers per row, CSV export. Reads with
// the user's session; confidential forms show nothing to non-execs.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { answerText, STATUS_LABELS, SUBMISSION_STATUSES, type SubmissionStatus } from '@/lib/forms/shared';
import { Download } from 'lucide-react';
import { normalizeSubmission, requireInboxForm, SUBMISSION_COLS, submitterLabel } from './_lib';
import SubmissionActions from './SubmissionActions';

export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<SubmissionStatus, 'primary' | 'default' | 'success' | 'danger' | 'warning'> = { new: 'primary', reviewed: 'default', booked: 'success', accepted: 'success', pass: 'warning', declined: 'danger' };

export default async function InboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
	const [{ slug }, sp] = await Promise.all([params, searchParams]);
	const { form, isExec } = await requireInboxForm(slug);
	const filter = SUBMISSION_STATUSES.includes(sp.status as SubmissionStatus) ? (sp.status as SubmissionStatus) : null;

	const supabase = await createClient();
	let q = supabase.from('form_submissions').select(SUBMISSION_COLS).eq('form_id', form.id).order('created_at', { ascending: false }).limit(500);
	if (filter) q = q.eq('status', filter);
	const { data, error } = await q;
	const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeSubmission);
	const counts = new Map<string, number>();
	if (!filter) for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

	// the first few non-name/email fields as preview columns
	const preview = form.fields.filter((f) => !['name', 'email'].includes(f.key) && f.type !== 'file').slice(0, 3);
	const blockedConfidential = form.confidential && !isExec;

	return (
		<>
			<PageHeader
				title={`${form.title} · inbox`}
				description={`${rows.length}${filter ? ` ${STATUS_LABELS[filter].toLowerCase()}` : ''} submission${rows.length === 1 ? '' : 's'}${form.request_type ? ` · ${form.request_type}` : ''}`}
				actions={
					<div className="flex items-center gap-3">
						{form.confidential && <Badge color="danger">Confidential · execs only</Badge>}
						<a href={`/data/forms/${slug}/submissions/export${filter ? `?status=${filter}` : ''}`} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"><Download className="w-3.5 h-3.5" /> CSV</a>
						<Link href={`/data/forms?edit=${slug}`} className="text-xs text-primary-600 hover:underline">Edit form</Link>
						<Link href="/data/forms" className="text-xs text-primary-600 hover:underline">← All forms</Link>
					</div>
				}
			/>
			<div className="space-y-3">
				<div className="flex flex-wrap items-center gap-1.5 text-xs">
					<Link href={`/data/forms/${slug}/submissions`} className={!filter ? 'rounded-md px-2 py-1 bg-primary-700 text-white' : 'rounded-md px-2 py-1 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45'}>All</Link>
					{SUBMISSION_STATUSES.map((s) => (
						<Link key={s} href={`/data/forms/${slug}/submissions?status=${s}`} className={filter === s ? 'rounded-md px-2 py-1 bg-primary-700 text-white' : 'rounded-md px-2 py-1 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/45'}>
							{STATUS_LABELS[s]}{!filter && counts.get(s) ? ` (${counts.get(s)})` : ''}
						</Link>
					))}
				</div>
				{error && <Card className="border-red-200 bg-red-50 dark:bg-red-950/30"><p className="text-sm text-red-700 dark:text-red-300">{error.message}</p></Card>}
				{blockedConfidential && rows.length === 0 && (
					<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"><p className="text-sm text-amber-800 dark:text-amber-300">This form is confidential: only execs and admins can read its submissions.</p></Card>
				)}
				<Card padding="none" className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="bg-slate-50/80 dark:bg-slate-900/30">
							<tr>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2 whitespace-nowrap">When</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap">From</th>
								{preview.map((f) => <th key={f.key} className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap">{f.label}</th>)}
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap">Status</th>
								<th className="w-32" />
							</tr>
						</thead>
						<tbody>
							{rows.length === 0 && !blockedConfidential && <tr><td colSpan={5 + preview.length} className="px-4 py-6 text-sm text-slate-500 text-center">No submissions{filter ? ` with status ${STATUS_LABELS[filter].toLowerCase()}` : ' yet'}.</td></tr>}
							{rows.map((s) => (
								<tr key={s.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top">
									<td className="px-4 py-2 text-slate-500 whitespace-nowrap">
										<Link href={`/data/forms/${slug}/submissions/${s.id}`} className="hover:text-primary-600">{formatDate(s.created_at, 'MMM d, yyyy h:mm a')}</Link>
										{s.notify_error && <span className="block text-2xs text-amber-700 dark:text-amber-400" title={s.notify_error}>email failed</span>}
									</td>
									<td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">
										<Link href={`/data/forms/${slug}/submissions/${s.id}`} className="font-medium hover:text-primary-600">{submitterLabel(s)}</Link>
										{typeof s.data.email === 'string' && s.data.name ? <span className="block text-2xs text-slate-500">{s.data.email}</span> : null}
									</td>
									{preview.map((f) => (
										<td key={f.key} className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-56 truncate" title={answerText(f, s.data[f.key], s.files)}>
											{answerText(f, s.data[f.key], s.files) || <span className="text-slate-300">—</span>}
										</td>
									))}
									<td className="px-3 py-2 whitespace-nowrap"><Badge color={STATUS_COLOR[s.status]}>{STATUS_LABELS[s.status]}</Badge></td>
									<td className="px-3 py-2 text-right whitespace-nowrap">
										<SubmissionActions id={s.id} slug={slug} status={s.status} notes={s.notes} compact />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Card>
			</div>
		</>
	);
}
