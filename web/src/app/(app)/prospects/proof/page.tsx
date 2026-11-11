// /prospects/proof — the Proof Library (0160): every case study, testimonial
// and proof asset, filterable by industry / service / type / status; edit,
// mark ready, and assign to website slots (/prospects/proof/slots). Read for
// internal staff; writes need manage_revenue (the Growth menu adopts this
// href when the nav restructure lands).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadProofLibrary } from '@/lib/proof/server';
import {
	ASSET_TYPES,
	ASSET_TYPE_LABELS,
	INDUSTRY_LABELS,
	KIND_SEGMENTS,
	PROOF_INDUSTRIES,
	PROOF_SERVICES,
	PROOF_STATUSES,
	SERVICE_LABELS,
	type ItemKind,
	type ProofStatus,
} from '@/lib/proof/shared';
import ProofNotAppliedCard from './ProofNotAppliedCard';
import RowStatus from './RowStatus';

export const metadata = { title: 'Proof Library · Prospects' };
export const dynamic = 'force-dynamic';

type Tab = 'case-studies' | 'testimonials' | 'assets';
const TABS: { key: Tab; kind: ItemKind; label: string }[] = [
	{ key: 'case-studies', kind: 'case_study', label: 'Case studies' },
	{ key: 'testimonials', kind: 'testimonial', label: 'Testimonials' },
	{ key: 'assets', kind: 'asset', label: 'Assets' },
];

const STATUS_COLOR: Record<ProofStatus, 'default' | 'success' | 'warning'> = { draft: 'warning', ready: 'success', hidden: 'default' };

function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
	const p = new URLSearchParams();
	for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
	const s = p.toString();
	return `/prospects/proof${s ? `?${s}` : ''}`;
}

export default async function ProofLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const sp = await searchParams;
	const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? 'case-studies') as Tab;
	const filters = { industry: sp.industry, service: sp.service, status: sp.status, type: sp.type, q: sp.q };
	const supabase = await createClient();
	const [lib, canManage] = await Promise.all([loadProofLibrary(supabase, filters), hasCapability('manage_revenue')]);
	if (lib.notApplied) return <ProofNotAppliedCard />;
	const base = { tab, ...filters };
	const kind = TABS.find((t) => t.key === tab)!.kind;

	return (
		<>
			<PageHeader
				title="Proof Library"
				description={`${lib.counts.case_study} case studies, ${lib.counts.testimonial} testimonials, ${lib.counts.asset} assets · ${lib.counts.ready} ready for the website`}
				actions={
					<div className="flex gap-2">
						<Link href="/prospects/proof/slots" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-hover dark:border-slate-600">
							Slots & performance
						</Link>
						{canManage && (
							<Link href={`/prospects/proof/${KIND_SEGMENTS[kind]}/new`} className="rounded-md bg-primary-700 px-3 py-1.5 text-sm text-white hover:bg-primary-800">
								New {tab === 'case-studies' ? 'case study' : tab === 'testimonials' ? 'testimonial' : 'asset'}
							</Link>
						)}
					</div>
				}
			/>

			<div className="space-y-3 mb-4">
				<div className="flex flex-wrap gap-1.5">
					{TABS.map((t) => (
						<FilterChipLink key={t.key} href={qs(base, { tab: t.key, type: undefined })} active={tab === t.key} count={lib.counts[t.kind]}>
							{t.label}
						</FilterChipLink>
					))}
				</div>
				<div className="flex flex-wrap gap-1.5">
					<FilterChipLink href={qs(base, { industry: undefined })} active={!filters.industry}>All industries</FilterChipLink>
					{PROOF_INDUSTRIES.map((i) => (
						<FilterChipLink key={i} href={qs(base, { industry: i })} active={filters.industry === i} count={lib.byIndustry[i] || undefined}>
							{INDUSTRY_LABELS[i]}
						</FilterChipLink>
					))}
				</div>
				<div className="flex flex-wrap gap-1.5">
					<FilterChipLink href={qs(base, { service: undefined })} active={!filters.service}>All services</FilterChipLink>
					{PROOF_SERVICES.map((s) => (
						<FilterChipLink key={s} href={qs(base, { service: s })} active={filters.service === s}>
							{SERVICE_LABELS[s]}
						</FilterChipLink>
					))}
					<span className="mx-1 border-l border-slate-200 dark:border-slate-700" />
					<FilterChipLink href={qs(base, { status: undefined })} active={!filters.status}>Any status</FilterChipLink>
					{PROOF_STATUSES.map((s) => (
						<FilterChipLink key={s} href={qs(base, { status: s })} active={filters.status === s}>
							{s}
						</FilterChipLink>
					))}
					{tab === 'assets' && (
						<>
							<span className="mx-1 border-l border-slate-200 dark:border-slate-700" />
							{ASSET_TYPES.map((t) => (
								<FilterChipLink key={t} href={qs(base, { type: filters.type === t ? undefined : t })} active={filters.type === t}>
									{ASSET_TYPE_LABELS[t]}
								</FilterChipLink>
							))}
						</>
					)}
				</div>
				<form className="flex gap-2" action="/prospects/proof">
					{Object.entries(base).map(([k, v]) => (k !== 'q' && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
					<input
						name="q"
						defaultValue={filters.q ?? ''}
						placeholder="Search client, headline, quote…"
						className="w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
					/>
				</form>
			</div>

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">{tab === 'assets' ? 'Asset' : tab === 'testimonials' ? 'Quote' : 'Client'}</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Industry</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">{tab === 'assets' ? 'Type' : 'Services'}</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">{tab === 'case-studies' ? 'Results' : 'Media'}</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Status</th>
							</tr>
						</thead>
						<tbody>
							{tab === 'case-studies' &&
								(lib.caseStudies.length === 0 ? (
									<EmptyRow />
								) : (
									lib.caseStudies.map((r) => (
										<tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
											<td className="px-4 py-3">
												<Link href={`/prospects/proof/case-studies/${r.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600">
													{r.client_name}
													{r.is_featured && <span className="ml-1 text-amber-500" title="Featured">★</span>}
												</Link>
												{r.headline && <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-md">{r.headline}</div>}
												<div className="text-2xs text-slate-400">{r.year ?? 'year?'} · strength {r.strength}</div>
											</td>
											<td className="px-4 py-3"><Badge>{INDUSTRY_LABELS[r.industry]}</Badge></td>
											<td className="px-4 py-3">
												<div className="flex flex-wrap gap-1">{r.services.map((s) => <Badge key={s} color="primary">{SERVICE_LABELS[s]}</Badge>)}</div>
											</td>
											<td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
												<div className="truncate max-w-xs">{r.results ?? '—'}</div>
												{r.notable_outlets.length > 0 && <div className="text-2xs text-slate-400 truncate max-w-xs">{r.notable_outlets.slice(0, 4).join(', ')}</div>}
											</td>
											<td className="px-4 py-3">
												{canManage ? <RowStatus kind="case_study" id={r.id} status={r.status} /> : <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>}
											</td>
										</tr>
									))
								))}
							{tab === 'testimonials' &&
								(lib.testimonials.length === 0 ? (
									<EmptyRow />
								) : (
									lib.testimonials.map((r) => (
										<tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
											<td className="px-4 py-3">
												<Link href={`/prospects/proof/testimonials/${r.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 line-clamp-2 max-w-md">
													“{r.quote}”
												</Link>
												<div className="text-xs text-slate-500 dark:text-slate-400">
													{[r.person, r.title, r.company].filter(Boolean).join(' · ') || 'Anonymous'}
													{r.is_featured && <span className="ml-1 text-amber-500" title="Featured">★</span>}
												</div>
											</td>
											<td className="px-4 py-3"><Badge>{INDUSTRY_LABELS[r.industry]}</Badge></td>
											<td className="px-4 py-3">
												<div className="flex flex-wrap gap-1">{r.services.map((s) => <Badge key={s} color="primary">{SERVICE_LABELS[s]}</Badge>)}</div>
											</td>
											<td className="px-4 py-3"><Badge color={r.media_type === 'video' ? 'accent' : 'default'}>{r.media_type}</Badge></td>
											<td className="px-4 py-3">
												{canManage ? <RowStatus kind="testimonial" id={r.id} status={r.status} /> : <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>}
											</td>
										</tr>
									))
								))}
							{tab === 'assets' &&
								(lib.assets.length === 0 ? (
									<EmptyRow />
								) : (
									lib.assets.map((r) => (
										<tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
											<td className="px-4 py-3">
												<Link href={`/prospects/proof/assets/${r.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600">
													{r.label}
												</Link>
												{r.value && <div className="text-xs text-slate-500 dark:text-slate-400">{r.value}</div>}
												{(r.url || r.storage_path) && <div className="text-2xs text-slate-400 truncate max-w-xs">{r.url ?? r.storage_path}</div>}
											</td>
											<td className="px-4 py-3"><Badge>{INDUSTRY_LABELS[r.industry]}</Badge></td>
											<td className="px-4 py-3"><Badge color="primary">{ASSET_TYPE_LABELS[r.type]}</Badge></td>
											<td className="px-4 py-3"><Badge color={r.type === 'video' ? 'accent' : 'default'}>{r.type === 'video' ? 'video' : 'image'}</Badge></td>
											<td className="px-4 py-3">
												{canManage ? <RowStatus kind="asset" id={r.id} status={r.status} /> : <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>}
											</td>
										</tr>
									))
								))}
						</tbody>
					</table>
				</div>
			</Card>
			<p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
				The website reads <code>ready</code> items only: <code>GET /api/proof/case-studies</code>, <code>/api/proof/testimonials</code>, <code>/api/proof/assets</code> (filters <code>?industry= &service= &type=</code>) and <code>GET /api/proof/slot/&lt;key&gt;</code> for a rotation, or <code>GET /api/proof/slots</code> (<code>?page= &keys=</code>) for every active slot with its ready items in one cached call. Events: <code>POST /api/proof/events</code>.
			</p>
		</>
	);
}

function EmptyRow() {
	return (
		<tr>
			<td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
				Nothing here yet. The import from Drive lands as <code>draft</code>; mark items <code>ready</code> to publish them.
			</td>
		</tr>
	);
}
