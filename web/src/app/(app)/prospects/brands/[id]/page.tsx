// /prospects/brands/[id] — one brand: socials, deals per motion, the people
// on it with roles, parent companies. Edit inline.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import AddProspectButton from '../../AddProspectButton';
import ScanAiButton from '../../ScanAiButton';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { formatDate } from '@/lib/format';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadBrand, loadConfig, loadStaff } from '@/lib/revenue/server';
import { MOTION_LABELS, PERSON_ROLE_LABELS, formatCents, scoreLabel } from '@/lib/revenue/shared';
import { hasCapability } from '@/lib/permissions/capabilities';
import NotAppliedCard from '../../NotAppliedCard';
import LinkPeopleCard from '../../LinkPeopleCard';
import BrandEditForm from './BrandEditForm';

export const dynamic = 'force-dynamic';
// Scan AI reads the brand site from a server action on this page.
export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string }> }) {
	const { id } = await params;
	const sp = await searchParams;
	if (!UUID.test(id)) notFound();
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, data, staff, canManage] = await Promise.all([loadConfig(supabase), loadBrand(supabase, id), loadStaff(supabase), hasCapability('manage_revenue')]);
	if (config.notApplied) return <NotAppliedCard />;
	if (!data) notFound();
	const { brand, people, deals, companies } = data;
	const stageById = new Map(config.stages.map((s) => [s.id, s]));
	const pipelineById = new Map(config.pipelines.map((p) => [p.id, p]));
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
	const edit = sp.tab === 'edit';
	const socials = Object.entries(brand.socials ?? {}).filter(([, v]) => v);

	return (
		<>
			<PageHeader
				title={
					<span className="inline-flex items-center gap-2">
						{brand.name}
						{brand.client_id && (
							<Link href={`/clients/${brand.client_id}`}>
								<Badge color="success">client</Badge>
							</Link>
						)}
					</span>
				}
				description={[brand.domain, brand.industry, brand.vertical].filter(Boolean).join(' · ') || 'Brand'}
				actions={
					<>
						<Link href="/prospects/contacts?tab=brands">
							<Button variant="ghost" size="sm">
								All brands
							</Button>
						</Link>
						<AddProspectButton
							brand={brand.id}
							className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/45"
						>
							Add prospect
						</AddProspectButton>
						<ScanAiButton target="brand" id={brand.id} />
						<Link href={`/prospects/brands/${brand.id}${edit ? '' : '?tab=edit'}`}>
							<Button variant="outline" size="sm">
								{edit ? 'Cancel' : 'Edit'}
							</Button>
						</Link>
					</>
				}
			/>
			{sp.error && (
				<Callout tone="error" className="mb-4">
					{sp.error}
				</Callout>
			)}
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-4">
					{edit ? (
						<BrandEditForm brand={brand} />
					) : (
						<Card className="space-y-3">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Deals</h2>
							{deals.length === 0 ? (
								<p className="text-xs text-slate-500">No deals on this brand yet.</p>
							) : (
								<ul className="divide-y divide-slate-200 dark:divide-slate-700">
									{deals.map((d) => {
										const st = stageById.get(d.stage_id);
										const pl = pipelineById.get(d.pipeline_id);
										const v = (d.est_mrr_cents ?? 0) + (d.est_one_time_cents ?? 0);
										const owner = d.owner_closer_id ?? d.owner_setter_id ?? d.owner_lg_id;
										return (
											<li key={d.id} className="py-2 flex items-center gap-3 text-sm">
												<Link href={`/prospects/deals/${d.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline min-w-0 truncate">
													{d.title}
												</Link>
												<Badge>{MOTION_LABELS[d.motion]}</Badge>
												<Badge color={d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'default'}>{st?.name ?? d.status}</Badge>
												<span className="text-xs text-slate-500">{pl?.name}</span>
												<span className="ml-auto text-xs text-slate-500">{owner ? staffMap[owner] : 'Unassigned'}</span>
												<span className="text-xs font-mono text-slate-600 dark:text-slate-400">{scoreLabel(d.quality_score, d.heat_score)}</span>
												{v > 0 && <span className="text-xs tabular-nums text-slate-600 dark:text-slate-400">{formatCents(v)}</span>}
											</li>
										);
									})}
								</ul>
							)}
						</Card>
					)}
					{brand.description && !edit && (
						<Card className="text-sm">
							<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">About</h2>
							<p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap text-xs">{brand.description}</p>
						</Card>
					)}
				</div>
				<div className="space-y-4">
					<LinkPeopleCard
						mode="brand"
						anchorId={brand.id}
						canRemove={canManage}
						addProspectHref={`/prospects/deals/new?brand=${brand.id}`}
						links={people.flatMap((l) =>
							l.person
								? [{ id: l.id, person_id: l.person.id, brand_id: brand.id, label: l.person.display_name, href: `/prospects/people/${l.person.id}`, sub: [PERSON_ROLE_LABELS[l.role], l.person.title, l.person.email].filter(Boolean).join(' · ') || null, is_primary: l.is_primary }]
								: [],
						)}
					/>
					<Card className="space-y-1.5 text-xs">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Web and socials</h2>
						<Row label="Website">
							{brand.website ? (
								<a href={brand.website} target="_blank" rel="noreferrer" className="text-primary-700 dark:text-primary-300 underline break-all">
									{brand.domain ?? brand.website}
								</a>
							) : (
								brand.domain ?? '—'
							)}
						</Row>
						{socials.length === 0 && <Row label="Socials">—</Row>}
						{socials.map(([k, v]) => (
							<Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
								{v}
							</Row>
						))}
						<Row label="Added">{formatDate(brand.created_at)}</Row>
					</Card>
					<Card className="space-y-1 text-xs">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Companies</h2>
						{companies.length === 0 && <p className="text-slate-500">No parent company recorded.</p>}
						{companies.map((c) =>
							c.company ? (
								<div key={c.company_id} className="text-slate-700 dark:text-slate-300">
									{c.company.name}
									{c.is_primary ? <span className="text-slate-500"> · primary</span> : null}
									{c.company.domain ? <span className="text-slate-500"> · {c.company.domain}</span> : null}
								</div>
							) : null,
						)}
					</Card>
				</div>
			</div>
		</>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-3">
			<span className="w-16 shrink-0 text-slate-500">{label}</span>
			<span className="text-slate-700 dark:text-slate-300 min-w-0 break-words">{children}</span>
		</div>
	);
}
