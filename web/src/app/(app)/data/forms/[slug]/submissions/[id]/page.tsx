// /data/forms/[slug]/submissions/[id] — one submission (0158): every
// answer, the files (signed links, 10 min), provenance, status + notes.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { answerText, STATUS_LABELS, UTM_KEYS } from '@/lib/forms/shared';
import { normalizeSubmission, requireInboxForm, SUBMISSION_COLS, submitterLabel } from '../_lib';
import SubmissionActions from '../SubmissionActions';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SubmissionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
	const { slug, id } = await params;
	if (!UUID.test(id)) notFound();
	const { form } = await requireInboxForm(slug);
	const supabase = await createClient();
	// RLS decides: a confidential form's row is simply absent for non-execs.
	const { data } = await supabase.from('form_submissions').select(SUBMISSION_COLS).eq('id', id).eq('form_id', form.id).maybeSingle();
	if (!data) notFound();
	const s = normalizeSubmission(data as Record<string, unknown>);

	// Signed links for files: the row read above already proved access.
	const links = new Map<string, string>();
	if (s.files.length) {
		const svc = createServiceRoleClient();
		const { data: signed } = await svc.storage.from('form-uploads').createSignedUrls(s.files.map((f) => f.path), 600);
		for (const x of signed ?? []) if (x.signedUrl && x.path) links.set(x.path, x.signedUrl);
	}
	let reviewer: string | null = null;
	if (s.reviewed_by) {
		const { data: p } = await supabase.from('profiles').select('first_name, last_name').eq('id', s.reviewed_by).maybeSingle();
		reviewer = p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : null;
	}
	const email = typeof s.data.email === 'string' ? s.data.email : null;
	const utm = UTM_KEYS.filter((k) => s.utm[k]).map((k) => `${k}=${s.utm[k]}`);

	return (
		<>
			<PageHeader
				title={submitterLabel(s)}
				description={`${form.title} · ${formatDate(s.created_at, 'MMM d, yyyy h:mm a')}`}
				actions={
					<div className="flex items-center gap-3">
						{form.confidential && <Badge color="danger">Confidential</Badge>}
						{email && <a href={`mailto:${email}?subject=${encodeURIComponent(`Re: ${form.title}`)}`} className="text-xs text-primary-600 hover:underline">Reply by email</a>}
						<Link href={`/data/forms/${slug}/submissions`} className="text-xs text-primary-600 hover:underline">← Inbox</Link>
					</div>
				}
			/>
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				<Card className="lg:col-span-2 space-y-4">
					<dl className="divide-y divide-slate-200 dark:divide-slate-700">
						{form.fields.map((f) => {
							const file = f.type === 'file' ? s.files.find((x) => x.key === f.key) : null;
							const text = answerText(f, s.data[f.key], s.files);
							return (
								<div key={f.key} className="py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
									<dt className="text-xs font-medium text-slate-600 dark:text-slate-400">{f.label}</dt>
									<dd className="sm:col-span-2 text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
										{file ? (
											links.get(file.path) ? <a href={links.get(file.path)} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{file.name} ({Math.round(file.size / 1024)} KB)</a> : `${file.name} (link unavailable)`
										) : f.type === 'url' && text ? (
											<a href={/^https?:\/\//i.test(text) ? text : `https://${text}`} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{text}</a>
										) : f.type === 'email' && text ? (
											<a href={`mailto:${text}`} className="text-primary-600 hover:underline">{text}</a>
										) : text || <span className="text-slate-300">—</span>}
									</dd>
								</div>
							);
						})}
					</dl>
				</Card>
				<div className="space-y-4">
					<Card className="space-y-3">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Status</h3>
							<Badge color={s.status === 'new' ? 'primary' : s.status === 'accepted' || s.status === 'booked' ? 'success' : s.status === 'declined' ? 'danger' : s.status === 'pass' ? 'warning' : 'default'}>{STATUS_LABELS[s.status]}</Badge>
						</div>
						{s.reviewed_at && <p className="text-2xs text-slate-500">Last change {formatDate(s.reviewed_at, 'MMM d, h:mm a')}{reviewer ? ` by ${reviewer}` : ''}</p>}
						<SubmissionActions id={s.id} slug={slug} status={s.status} notes={s.notes} />
					</Card>
					<Card className="space-y-1.5 text-2xs text-slate-600 dark:text-slate-400">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Provenance</h3>
						<p><span className="font-medium">Source page:</span> {s.source_url ? <a href={s.source_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline break-all">{s.source_url}</a> : '—'}</p>
						{utm.length > 0 && <p><span className="font-medium">UTM:</span> {utm.join(' · ')}</p>}
						{Object.keys(s.tags).length > 0 && <p><span className="font-medium">Tags:</span> {Object.entries(s.tags).map(([k, v]) => `${k}=${v}`).join(' · ')}</p>}
						<p><span className="font-medium">IP:</span> {s.ip ?? '—'}</p>
						<p className="break-all"><span className="font-medium">Browser:</span> {s.user_agent ?? '—'}</p>
						<p><span className="font-medium">Notification:</span> {s.notified_at ? `sent ${formatDate(s.notified_at, 'MMM d, h:mm a')}` : s.notify_error ? <span className="text-amber-700 dark:text-amber-400">failed: {s.notify_error}</span> : 'not configured'}</p>
						<p className="font-mono text-slate-400">{s.id}</p>
					</Card>
				</div>
			</div>
		</>
	);
}
