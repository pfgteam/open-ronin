// /the-work/acquisitions/[id] — one target: the 28-column record and deal
// card (editable by anyone with the acquisitions capability), plus the
// shared notes log: research (deal_research), risk register + decision log
// (deal_integration), negotiation (deal_negotiation), touches
// (deal_sourcing). Notes by identities arrive through approved proposals and
// carry the identity slug; notes by people carry the author.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { formatDate, formatRelative } from '@/lib/format';
import { NOTE_COLUMNS, TARGET_COLUMNS, type NoteRow, type TargetRow } from '@/lib/mcp/mappers/acquisitions';
import { AddNoteForm, TargetEditForm } from '../Forms';

export const dynamic = 'force-dynamic';

const KIND_COLOR: Record<string, 'default' | 'primary' | 'warning' | 'danger' | 'success' | 'accent'> = {
	research: 'primary', risk: 'danger', decision: 'success', negotiation: 'warning', touch: 'default', integration: 'accent', general: 'default',
};

export default async function AcquisitionTargetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
	const { id } = await params;
	const { kind } = await searchParams;
	if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
	const profile = await getAuthProfile();
	if (!profile) redirect(`/auth/login?redirect=/the-work/acquisitions/${id}`);
	if (!(await hasCapability('acquisitions'))) redirect('/the-work/acquisitions');

	const supabase = await createClient();
	const [{ data: t, error: tErr }, { data: noteRows }] = await Promise.all([
		supabase.from('acquisition_targets').select(TARGET_COLUMNS).eq('id', id).maybeSingle<TargetRow>(),
		supabase.from('acquisition_target_notes').select(NOTE_COLUMNS).eq('target_id', id).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(300).returns<NoteRow[]>(),
	]);
	if (tErr) {
		return (
			<Callout tone="warning">Migration 0107 (acquisitions module) is not applied yet; this page needs its columns.</Callout>
		);
	}
	if (!t) notFound();

	const notes = noteRows ?? [];
	const authorIds = [...new Set([...notes.map((n) => n.author_id), t.owner_profile_id].filter((v): v is string => !!v))];
	const { data: people } = authorIds.length
		? await supabase.from('profiles').select('id, first_name, last_name, email').in('id', authorIds)
		: { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string }[] };
	const nameOf = new Map((people ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email]));
	const shown = kind ? notes.filter((n) => n.kind === kind) : notes;
	const openRisks = notes.filter((n) => n.kind === 'risk' && n.risk_status !== 'closed');
	const kinds = ['research', 'risk', 'decision', 'negotiation', 'touch', 'integration', 'general'];

	return (
		<>
			<PageHeader
				title={t.company_name}
				description={[t.target_ref, t.vertical, [t.city, t.state].filter(Boolean).join(', ') || null, t.owner_name ? `${t.owner_name}${t.owner_title ? `, ${t.owner_title}` : ''}` : null].filter(Boolean).join(' · ')}
				actions={
					<Link href="/the-work/acquisitions" className="inline-flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 hover:text-primary-600">
						<ArrowLeft className="w-4 h-4" /> All targets
					</Link>
				}
			/>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				<div className="lg:col-span-2 space-y-4">
					<Card>
						<div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
							<Badge>{t.status}</Badge>
							{t.hard_gate && <Badge color={t.hard_gate === 'pass' ? 'success' : 'danger'}>gate {t.hard_gate}</Badge>}
							{t.scorecard_total !== null && <Badge color="primary">{t.scorecard_total}/40</Badge>}
							{t.recommendation && <Badge color="warning">{t.recommendation}</Badge>}
							{openRisks.length > 0 && <Badge color="danger">{openRisks.length} open risk{openRisks.length === 1 ? '' : 's'}</Badge>}
							{t.website && (
								<a href={t.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-slate-500 hover:text-primary-600">
									site <ExternalLink className="w-3 h-3" />
								</a>
							)}
							{t.linkedin_url && (
								<a href={t.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-slate-500 hover:text-primary-600">
									linkedin <ExternalLink className="w-3 h-3" />
								</a>
							)}
						</div>
						<dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-2xs mb-4">
							<div><dt className="text-slate-500">Founded</dt><dd className="text-slate-800 dark:text-slate-200">{t.founded_year ?? '—'}</dd></div>
							<div><dt className="text-slate-500">Headcount</dt><dd className="text-slate-800 dark:text-slate-200">{t.employee_count ?? '—'}</dd></div>
							<div><dt className="text-slate-500">Services</dt><dd className="text-slate-800 dark:text-slate-200">{t.agency_services ?? '—'}</dd></div>
							<div><dt className="text-slate-500">Owner contact</dt><dd className="text-slate-800 dark:text-slate-200">{[t.email, t.phone].filter(Boolean).join(' · ') || '—'}</dd></div>
							<div><dt className="text-slate-500">Fit score (scraper)</dt><dd className="text-slate-800 dark:text-slate-200">{t.fit_score ?? '—'}</dd></div>
							<div><dt className="text-slate-500">Open Ronin owner</dt><dd className="text-slate-800 dark:text-slate-200">{t.owner_profile_id ? nameOf.get(t.owner_profile_id) ?? '—' : '—'}</dd></div>
							<div><dt className="text-slate-500">Added</dt><dd className="text-slate-800 dark:text-slate-200">{formatDate(t.created_at)}</dd></div>
							<div><dt className="text-slate-500">Last touch</dt><dd className="text-slate-800 dark:text-slate-200">{t.last_touch_on ? formatDate(t.last_touch_on) : '—'}</dd></div>
						</dl>
						{t.owner_signal && (
							<Callout tone="info" className="mb-4">
								<span className="text-2xs uppercase tracking-wide text-slate-500">Owner signal (verbatim)</span>
								<p className="mt-1 whitespace-pre-wrap">{t.owner_signal}</p>
							</Callout>
						)}
						<TargetEditForm t={t} />
					</Card>
				</div>

				<div className="space-y-4">
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Add a note</h2>
						<AddNoteForm targetId={t.id} />
					</Card>
				</div>
			</div>

			<Card padding="none" className="mt-4">
				<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notes</h2>
					<span className="text-2xs text-slate-500">{notes.length} total</span>
					<span className="text-slate-300 dark:text-slate-600">·</span>
					<Link href={`/the-work/acquisitions/${t.id}`} className={`text-2xs ${!kind ? 'text-primary-600 font-medium' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>all</Link>
					{kinds.map((k) => (
						<Link key={k} href={`/the-work/acquisitions/${t.id}?kind=${k}`} className={`text-2xs ${kind === k ? 'text-primary-600 font-medium' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
							{k} ({notes.filter((n) => n.kind === k).length})
						</Link>
					))}
				</div>
				{shown.length === 0 ? (
					<p className="text-sm text-slate-500 text-center py-6">No notes{kind ? ` of kind ${kind}` : ''} yet.</p>
				) : (
					<ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
						{shown.map((n) => (
							<li key={n.id} className="px-3 py-3">
								<div className="flex flex-wrap items-center gap-2 text-2xs text-slate-500 mb-1">
									<Badge color={KIND_COLOR[n.kind] ?? 'default'}>{n.kind}</Badge>
									{n.kind === 'risk' && n.severity && <Badge color={n.severity === 'critical' || n.severity === 'high' ? 'danger' : 'warning'}>{n.severity}</Badge>}
									{n.kind === 'risk' && n.risk_status && <Badge color={n.risk_status === 'closed' ? 'success' : 'default'}>{n.risk_status}</Badge>}
									<span>{formatDate(n.occurred_on)}</span>
									<span>·</span>
									<span>{n.identity_slug ? <span className="font-mono">{n.identity_slug}</span> : n.author_id ? nameOf.get(n.author_id) ?? 'someone' : 'unknown'}</span>
									{n.identity_slug && n.author_id && <span>approved by {nameOf.get(n.author_id) ?? 'someone'}</span>}
									<span className="ml-auto">{formatRelative(n.created_at)}</span>
								</div>
								{n.title && <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{n.title}</div>}
								<p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{n.body_md}</p>
							</li>
						))}
					</ul>
				)}
			</Card>
		</>
	);
}
