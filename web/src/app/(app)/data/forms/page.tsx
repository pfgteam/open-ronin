// /data/forms — Forms tool (Alex, 2026-09-14, Part 5 item 22).
//
// The working half: the list of forms, the builder (?new=1 / ?edit=<slug>)
// with logic-based conditional fields, and per-form submissions. The
// settings half (who can build, defaults) is Admin -> Forms. Fill a form at
// /data/forms/<slug>. Tables: 0086.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { redirect } from 'next/navigation';
import { FormError } from '../../team/_form';
import { FileSignature, Plus } from 'lucide-react';
import { parseFields } from '@/lib/forms/logic';
import { appUrl, hostedUrl } from '@/lib/forms/shared';
import FormBuilder, { EMPTY_BUILDER_FORM, type BuilderForm } from './FormBuilder';
import { setFormStatus } from './actions';

export const metadata = { title: 'Forms' };
export const dynamic = 'force-dynamic';

interface FormRow {
	id: string;
	slug: string;
	title: string;
	description_md: string | null;
	status: 'draft' | 'open' | 'closed';
	fields: unknown;
	allow_multiple: boolean;
	anonymous_ok: boolean;
	created_by: string | null;
	created_at: string;
	// 0158 (null until the migration is applied)
	is_public: boolean | null;
	confidential: boolean | null;
	request_type: string | null;
	notify_emails: string[] | null;
	success_message: string | null;
	redirect_url: string | null;
	success_cta_label: string | null;
	success_cta_url: string | null;
	submit_label: string | null;
	brand_label: string | null;
	submission_tags: Record<string, string> | null;
}

const COLS = 'id, slug, title, description_md, status, fields, allow_multiple, anonymous_ok, created_by, created_at, is_public, confidential, request_type, notify_emails, success_message, redirect_url, success_cta_label, success_cta_url, submit_label, brand_label, submission_tags';
const LEGACY_COLS = 'id, slug, title, description_md, status, fields, allow_multiple, anonymous_ok, created_by, created_at';

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ new?: string; edit?: string; error?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const ctx = await loadSensitiveAccessContext();
	const canBuild = canManagePeople(ctx) || profile.role === 'exec';

	const supabase = await createClient();
	let rows: unknown[] | null = null;
	let error: { message: string } | null = null;
	({ data: rows, error } = await supabase.from('forms').select(COLS).order('created_at', { ascending: false }));
	// 0158 not applied yet: fall back to the 0086 columns so the page still renders.
	if (error && /column|schema cache/i.test(error.message)) {
		({ data: rows, error } = await supabase.from('forms').select(LEGACY_COLS).order('created_at', { ascending: false }));
	}

	if (error) {
		return (
			<>
				<PageHeader title="Forms" description="Build forms with conditional fields; collect submissions." />
				<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
					<p className="text-sm text-amber-800 dark:text-amber-300">
						Forms aren&apos;t switched on yet. Ask Ops to finish enabling them.
					</p>
				</Card>
			</>
		);
	}
	const forms = (rows ?? []) as unknown as FormRow[];
	const counts = new Map<string, number>();
	if (forms.length) {
		const { data: subs } = await supabase.from('form_submissions').select('form_id');
		for (const s of subs ?? []) counts.set(s.form_id as string, (counts.get(s.form_id as string) ?? 0) + 1);
	}
	const base = appUrl();

	const editing = sp.edit ? forms.find((f) => f.slug === sp.edit) : null;
	if (canBuild && (sp.new === '1' || editing)) {
		const initial: BuilderForm = editing
			? {
					id: editing.id, slug: editing.slug, title: editing.title, description_md: editing.description_md, status: editing.status,
					allow_multiple: editing.allow_multiple, anonymous_ok: editing.anonymous_ok, fields: safeFields(editing.fields),
					is_public: !!editing.is_public, confidential: !!editing.confidential, request_type: editing.request_type ?? null,
					notify_emails: editing.notify_emails ?? [], success_message: editing.success_message ?? null, redirect_url: editing.redirect_url ?? null,
					success_cta_label: editing.success_cta_label ?? null, success_cta_url: editing.success_cta_url ?? null,
					submit_label: editing.submit_label ?? null, brand_label: editing.brand_label ?? null, submission_tags: editing.submission_tags ?? {},
				}
			: EMPTY_BUILDER_FORM;
		return (
			<>
				<PageHeader
					title={editing ? `Edit · ${editing.title}` : 'New form'}
					description="Fields render in order. A “show only if” rule hides a field until an earlier answer matches; hidden answers are never stored."
					actions={<Link href="/data/forms" className="text-xs text-primary-600 hover:underline">← All forms</Link>}
				/>
				<FormBuilder initial={initial} appUrl={base} />
			</>
		);
	}

	return (
		<>
			<PageHeader
				title="Forms"
				description="Build forms with logic-based conditional fields; collect submissions. Settings live in Admin → Forms."
				actions={
					canBuild ? (
						<Link href="/data/forms?new=1" className="inline-flex items-center gap-1 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-3 py-1.5">
							<Plus className="w-3.5 h-3.5" /> New form
						</Link>
					) : null
				}
			/>
			<div className="space-y-4">
				<FormError message={sp.error} />
				{forms.length === 0 ? (
					<Card>
						<div className="text-center py-10">
							<FileSignature className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
							<p className="text-sm text-slate-500">No forms yet.{canBuild ? ' Build the first one.' : ''}</p>
						</div>
					</Card>
				) : (
					<Card padding="none">
						<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead className="bg-slate-50/80 dark:bg-slate-900/30">
								<tr>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Form</th>
									<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Status</th>
									<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Fields</th>
									<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-3 py-2">Submissions</th>
									<th className="w-56" />
								</tr>
							</thead>
							<tbody>
								{forms.map((f) => (
									<tr key={f.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-2">
											<Link href={canBuild ? `/data/forms/${f.slug}/submissions` : `/data/forms/${f.slug}`} className="text-slate-900 dark:text-slate-100 hover:text-primary-600 font-medium">{f.title}</Link>
											{f.confidential && <Badge color="danger" className="ml-2">Confidential</Badge>}
											{f.is_public ? (
												<a href={hostedUrl(f.slug, base)} target="_blank" rel="noreferrer" className="block text-2xs text-primary-600 font-mono hover:underline">{hostedUrl(f.slug, base)}</a>
											) : (
												<span className="block text-2xs text-slate-600 dark:text-slate-400 font-mono">/data/forms/{f.slug}</span>
											)}
										</td>
										<td className="px-3 py-2"><Badge color={f.status === 'open' ? 'success' : f.status === 'draft' ? 'warning' : 'default'}>{f.status}</Badge></td>
										<td className="px-3 py-2 text-right tabular-nums text-slate-500">{safeFields(f.fields).length}</td>
										<td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{counts.get(f.id) ?? 0}</td>
										<td className="px-3 py-2 text-right whitespace-nowrap">
											{canBuild && (
												<span className="inline-flex items-center gap-2">
													<Link href={`/data/forms?edit=${f.slug}`} className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline">Edit</Link>
													<Link href={`/data/forms/${f.slug}/submissions`} className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline">Inbox</Link>
													<form action={setFormStatus} className="inline">
														<input type="hidden" name="id" value={f.id} />
														<input type="hidden" name="status" value={f.status === 'open' ? 'closed' : 'open'} />
														<button type="submit" className="text-2xs text-slate-600 dark:text-slate-400 hover:text-primary-600 underline-offset-2 hover:underline">{f.status === 'open' ? 'Close' : 'Open'}</button>
													</form>
												</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
						</div>
					</Card>
				)}
			</div>
		</>
	);
}

function safeFields(raw: unknown) {
	try {
		return parseFields(raw);
	} catch {
		return [];
	}
}
