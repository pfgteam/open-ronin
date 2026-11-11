// /hiring/four-r — the 4R backfill (decision 11 / round 3): every Drive 4R
// doc queued with its target (role template or person), paste → parse →
// import; people without a 4R get an AI draft a people manager approves.
// Beacon devs are out of scope (managed elsewhere).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext } from '@/lib/people/permissions';
import { loadFourRBackfill } from '@/lib/hiring/server';
import { aiConfigured } from '@/lib/hiring/ai';
import NotAppliedCard from '../NotAppliedCard';
import { DraftButton, DraftCard, ImportRow } from './Controls';

export const metadata = { title: '4R backfill · Hiring' };
export const dynamic = 'force-dynamic';

const FOLDER_LABELS = { positions_general: '4R Positions - General', new_for_review: '4Rs (New - For Review & Approval)', team_members: 'Team members (own 4R on Drive)' } as const;

export default async function FourRBackfillPage({ searchParams }: { searchParams: Promise<{ folder?: string; status?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const ctx = await loadSensitiveAccessContext();
	const canAct = ctx.viewerIsPeopleManager || profile.role === 'admin' || profile.role === 'exec';
	const data = await loadFourRBackfill(supabase);
	if (data.notApplied) return <NotAppliedCard />;
	const folder = (Object.keys(FOLDER_LABELS) as (keyof typeof FOLDER_LABELS)[]).includes(sp.folder as never) ? (sp.folder as keyof typeof FOLDER_LABELS) : null;
	const status = ['pending', 'fetched', 'imported', 'skipped'].includes(sp.status ?? '') ? sp.status! : 'open';
	const imports = data.imports.filter((i) => (!folder || i.folder === folder) && (status === 'open' ? i.status === 'pending' || i.status === 'fetched' : i.status === status));
	const personName = new Map(data.people.map((p) => [p.id, p.name]));
	const missing = data.people.filter((p) => !p.has_four_r && p.department_label !== 'Beacon');
	const pendingDraftFor = new Set(data.drafts.filter((d) => d.status === 'pending').map((d) => d.user_id));
	const href = (q: { folder?: string | null; status?: string }) => {
		const u = new URLSearchParams();
		const f = q.folder === undefined ? folder : q.folder;
		if (f) u.set('folder', f);
		const s = q.status ?? status;
		if (s !== 'open') u.set('status', s);
		const qs = u.toString();
		return `/hiring/four-r${qs ? `?${qs}` : ''}`;
	};
	const counts = { open: data.imports.filter((i) => i.status === 'pending' || i.status === 'fetched').length, imported: data.imports.filter((i) => i.status === 'imported').length, skipped: data.imports.filter((i) => i.status === 'skipped').length };

	return (
		<>
			<PageHeader title="4R backfill" description={`${data.imports.length} Drive docs queued · ${counts.imported} imported · ${missing.length} active non-dev people without a 4R`} />
			<Callout tone="info" className="mb-4">
				Two lanes. <strong>Drive docs</strong>: the 74 role 4Rs and the 9 personal ones that never got imported; the service account cannot open them, so paste each doc&apos;s text (Docs → File → Download → Plain text) and the importer splits it into the four sections — role templates land in <code>four_r_templates</code> (sanitized: no names), personal ones on the profile. <strong>People without a 4R</strong>: AI drafts from their profile + nearest template + recent work; a people manager or Alex approves. Beacon devs are out of scope.
				{!aiConfigured() && <> AI drafting is off until a text provider key (ANTHROPIC / OPENAI) is set in Vercel.</>}
			</Callout>

			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-3">
					<div className="flex flex-wrap gap-1.5">
						<FilterChipLink href={href({ folder: null })} active={!folder}>
							All folders
						</FilterChipLink>
						{(Object.keys(FOLDER_LABELS) as (keyof typeof FOLDER_LABELS)[]).map((f) => (
							<FilterChipLink key={f} href={href({ folder: f })} active={folder === f} count={data.imports.filter((i) => i.folder === f && (status === 'open' ? i.status === 'pending' || i.status === 'fetched' : i.status === status)).length}>
								{FOLDER_LABELS[f]}
							</FilterChipLink>
						))}
						<span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
						<FilterChipLink href={href({ status: 'open' })} active={status === 'open'} count={counts.open}>
							To do
						</FilterChipLink>
						<FilterChipLink href={href({ status: 'imported' })} active={status === 'imported'} count={counts.imported}>
							Imported
						</FilterChipLink>
						<FilterChipLink href={href({ status: 'skipped' })} active={status === 'skipped'} count={counts.skipped}>
							Skipped
						</FilterChipLink>
					</div>
					<Card padding="none">
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{imports.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Nothing in this view.</li>}
							{imports.map((row) => (
								<ImportRow key={row.id} row={row} canAct={canAct} personName={row.target_user_id ? personName.get(row.target_user_id) ?? null : null} />
							))}
						</ul>
					</Card>
				</div>
				<div className="space-y-3">
					<Card className="space-y-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">People without a 4R</h2>
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{missing.length === 0 && <li className="py-2 text-sm text-slate-500">Everyone has one.</li>}
							{missing.map((p) => (
								<li key={p.id} className="py-2 flex items-center justify-between gap-2">
									<div className="min-w-0">
										<Link href={`/team/${p.id}?tab=four-r`} className="text-sm text-slate-900 dark:text-slate-100 hover:underline">
											{p.name}
										</Link>
										<div className="text-2xs text-slate-500 truncate">
											{p.job_role ?? p.title ?? '—'}
											{p.department_label ? ` · ${p.department_label}` : ''}
										</div>
									</div>
									{pendingDraftFor.has(p.id) ? <Badge color="warning">draft pending</Badge> : data.imports.some((i) => i.target_user_id === p.id && i.status !== 'skipped') ? <Badge>Drive doc queued</Badge> : <DraftButton userId={p.id} canAct={canAct} />}
								</li>
							))}
						</ul>
					</Card>
				</div>
			</div>

			<Card padding="none" className="mt-4">
				<div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-slate-100">AI drafts ({data.drafts.filter((d) => d.status === 'pending').length} pending)</div>
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{data.drafts.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No drafts yet.</li>}
					{data.drafts.map((d) => (
						<DraftCard key={d.id} draft={d} personName={personName.get(d.user_id) ?? 'Unknown'} canAct={canAct} />
					))}
				</ul>
			</Card>
		</>
	);
}
