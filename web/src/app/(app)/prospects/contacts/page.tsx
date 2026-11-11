// /prospects/contacts — People and Brands in one directory (spec
// 2026-10-15-prospects-lists-design.md §5): real pagination and totals, the
// sales columns (brand, open deal, owner) and the duplicates pill. Replaced
// the capped /prospects/people and /prospects/brands lists (they redirect here).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasModuleAccess } from '@/lib/permissions/modules';
import { formatRelative } from '@/lib/format';
import { loadConfig, loadStaff } from '@/lib/revenue/server';
import { loadBrandsPage, loadContactCounts, loadPeoplePage } from '@/lib/revenue/lists';
import { contactsHref, parseContactsFilters, type ContactsTab } from '@/lib/revenue/listParams';
import { ownerLaneFor } from '@/lib/revenue/shared';
import NotAppliedCard from '../NotAppliedCard';
import ContactsSearch from './ContactsSearch';

export const metadata = { title: 'Contacts · Prospects' };
export const dynamic = 'force-dynamic';

const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2';

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
	const f = parseContactsFilters(await searchParams);
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, staff, counts, canAdmin] = await Promise.all([loadConfig(supabase), loadStaff(supabase), loadContactCounts(supabase), hasModuleAccess('admin')]);
	if (config.notApplied) return <NotAppliedCard />;
	const [people, brands] = await Promise.all([
		f.tab === 'people' ? loadPeoplePage(supabase, f) : Promise.resolve(null),
		f.tab === 'brands' ? loadBrandsPage(supabase, f) : Promise.resolve(null),
	]);
	const page = people ?? brands;
	const pipeBy = new Map(config.pipelines.map((p) => [p.id, p]));
	const stageBy = new Map(config.stages.map((s) => [s.id, s]));
	const staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));

	const tab = (key: ContactsTab, label: string, n: number) => (
		<Link
			href={contactsHref(f, { tab: key })}
			aria-current={f.tab === key ? 'page' : undefined}
			className={clsx(
				'-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
				f.tab === key ? 'border-primary-600 font-semibold text-primary-900 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
			)}
		>
			{label}
			<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-2xs tabular-nums dark:bg-slate-800">{n.toLocaleString()}</span>
		</Link>
	);
	const nameHead = (label: string) => (
		<th className={th} aria-sort={f.sort === 'name' ? 'ascending' : 'none'}>
			<Link
				href={contactsHref(f, { sort: f.sort === 'name' ? 'updated' : 'name' })}
				className={clsx('hover:text-slate-900 dark:hover:text-slate-100', f.sort === 'name' && 'font-semibold text-primary-800 dark:text-primary-300')}
			>
				{label}
				{f.sort === 'name' ? ' ↑' : ''}
			</Link>
		</th>
	);

	return (
		<>
			<PageHeader
				title="Contacts"
				description={`${counts.people.toLocaleString()} people · ${counts.brands.toLocaleString()} brands`}
				actions={
					counts.duplicates > 0 && canAdmin ? (
						<Link
							href="/admin/prospects/duplicates"
							className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
						>
							<AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
							{counts.duplicates.toLocaleString()} possible duplicate{counts.duplicates === 1 ? '' : 's'} · Review
						</Link>
					) : undefined
				}
			/>
			<nav aria-label="Contacts" className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
				{tab('people', 'People', counts.people)}
				{tab('brands', 'Brands', counts.brands)}
			</nav>
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<FilterChipLink href={contactsHref(f, { has: 'all' })} active={f.has === 'all'}>All</FilterChipLink>
				<FilterChipLink href={contactsHref(f, { has: 'open' })} active={f.has === 'open'}>Open deal</FilterChipLink>
				<FilterChipLink href={contactsHref(f, { has: 'none' })} active={f.has === 'none'}>No deal</FilterChipLink>
				<ContactsSearch f={f} />
			</div>
			{page?.error ? (
				<Callout tone="error">{page.error}</Callout>
			) : (
				<Card padding="none" className="overflow-x-auto">
					{page && page.rows.length === 0 ? (
						<p className="px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
							No {f.tab} match.{' '}
							<Link href={contactsHref({ ...f, has: 'all', q: null })} className="underline">
								Clear filters
							</Link>
						</p>
					) : people ? (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-200 dark:border-slate-700">
									{nameHead('Name')}
									<th className={th}>Brand</th>
									<th className={th}>Email</th>
									<th className={th}>Phone</th>
									<th className={th}>Open deal</th>
									<th className={th}>Owner</th>
									<th className={clsx(th, 'text-right')}>Updated</th>
								</tr>
							</thead>
							<tbody>
								{people.rows.map((p) => {
									const pipe = p.deal ? pipeBy.get(p.deal.pipeline_id) : null;
									const owner = p.deal && pipe ? p.deal[ownerLaneFor(pipe.lane)] : null;
									return (
										<tr key={p.id} className="border-b border-slate-200 dark:border-slate-700 transition-colors hover:bg-hover">
											<td className={td}>
												<Link href={`/prospects/people/${p.id}`} className="font-semibold text-slate-900 hover:underline dark:text-slate-100">{p.display_name}</Link>
												{p.title && <span className="block text-xs text-slate-500">{p.title}</span>}
											</td>
											<td className={td}>{p.brand ?? '—'}</td>
											<td className={clsx(td, 'text-slate-600 dark:text-slate-400')}>{p.email ?? '—'}</td>
											<td className={clsx(td, 'whitespace-nowrap text-slate-600 dark:text-slate-400')}>{p.phone ?? '—'}</td>
											<td className={clsx(td, 'whitespace-nowrap')}>
												{p.deal ? (
													<Link href={`/prospects/deals/${p.deal.id}`} className="inline-flex items-center gap-1.5 hover:underline">
														<span className="h-2 w-2 rounded-full bg-primary-500" aria-hidden="true" />
														{pipe?.name ?? '—'} · {stageBy.get(p.deal.stage_id)?.name ?? '—'}
													</Link>
												) : (
													<span className="text-slate-500">No open deal</span>
												)}
											</td>
											<td className={clsx(td, 'whitespace-nowrap')}>{owner ? (staffMap[owner] ?? '—') : '—'}</td>
											<td className={clsx(td, 'text-right tabular-nums text-slate-500')}>{formatRelative(p.updated_at)}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					) : brands ? (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-200 dark:border-slate-700">
									{nameHead('Brand')}
									<th className={th}>Website</th>
									<th className={clsx(th, 'text-right')}>People</th>
									<th className={clsx(th, 'text-right')}>Open deals</th>
									<th className={th}>Client</th>
									<th className={clsx(th, 'text-right')}>Updated</th>
								</tr>
							</thead>
							<tbody>
								{brands.rows.map((b) => (
									<tr key={b.id} className="border-b border-slate-200 dark:border-slate-700 transition-colors hover:bg-hover">
										<td className={td}>
											<Link href={`/prospects/brands/${b.id}`} className="font-semibold text-slate-900 hover:underline dark:text-slate-100">{b.name}</Link>
										</td>
										<td className={clsx(td, 'text-slate-600 dark:text-slate-400')}>{b.domain ?? b.website ?? '—'}</td>
										<td className={clsx(td, 'text-right tabular-nums')}>{b.people}</td>
										<td className={clsx(td, 'text-right tabular-nums')}>{b.openDeals}</td>
										<td className={td}>{b.client_id ? <Badge color="primary">Client</Badge> : '—'}</td>
										<td className={clsx(td, 'text-right tabular-nums text-slate-500')}>{formatRelative(b.updated_at)}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : null}
					{page && page.rows.length > 0 && (
						<Pagination page={f.page} size={f.size} total={page.count} hrefFor={(n) => contactsHref(f, { page: n })} sizeHrefFor={(s) => contactsHref(f, { size: s })} />
					)}
				</Card>
			)}
		</>
	);
}
