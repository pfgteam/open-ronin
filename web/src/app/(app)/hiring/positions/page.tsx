// /hiring/positions — every position, filterable by status / brand.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import FilterChipLink from '@/components/ui/FilterChipLink';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { loadHiringConfig, loadPositions, loadStaff } from '@/lib/hiring/server';
import { EMPLOYMENT_TYPE_LABELS, HIRE_BRANDS, HIRE_BRAND_LABELS, POSITION_STATUSES, POSITION_STATUS_COLORS, POSITION_STATUS_LABELS, type HireBrand, type PositionStatus } from '@/lib/hiring/shared';
import { formatRelative } from '@/lib/format';
import NotAppliedCard from '../NotAppliedCard';

export const metadata = { title: 'Positions · Hiring' };
export const dynamic = 'force-dynamic';

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ status?: string; brand?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadHiringConfig(supabase), hasCapability('manage_hiring')]);
	if (config.notApplied) return <NotAppliedCard />;
	const status = (POSITION_STATUSES as readonly string[]).includes(sp.status ?? '') ? (sp.status as PositionStatus) : sp.status === 'all' ? 'all' : 'active';
	const brand = (HIRE_BRANDS as readonly string[]).includes(sp.brand ?? '') ? (sp.brand as HireBrand) : undefined;
	const [{ positions, error }, staff] = await Promise.all([loadPositions(supabase, { status, brand }), loadStaff(supabase)]);
	const name = new Map(staff.map((s) => [s.id, s.name]));
	const href = (q: { status?: string; brand?: string }) => {
		const u = new URLSearchParams();
		const s = q.status ?? status;
		if (s !== 'active') u.set('status', s);
		const b = 'brand' in q ? q.brand : brand;
		if (b) u.set('brand', b);
		const qs = u.toString();
		return `/hiring/positions${qs ? `?${qs}` : ''}`;
	};

	return (
		<>
			<PageHeader
				title="Positions"
				description={`${positions.length} shown · the role, its 4R, PAP pay link and application config`}
				actions={
					canManage ? (
						<Link href="/hiring/positions/new">
							<Button size="sm">+ New position</Button>
						</Link>
					) : (
						<Link href="/hiring/requests?new=1">
							<Button variant="outline" size="sm">
								Request a position
							</Button>
						</Link>
					)
				}
			/>
			<div className="flex flex-wrap gap-1.5 mb-3">
				<FilterChipLink href={href({ status: 'active' })} active={status === 'active'}>
					Active
				</FilterChipLink>
				{POSITION_STATUSES.map((s) => (
					<FilterChipLink key={s} href={href({ status: s })} active={status === s}>
						{POSITION_STATUS_LABELS[s]}
					</FilterChipLink>
				))}
				<FilterChipLink href={href({ status: 'all' })} active={status === 'all'}>
					All
				</FilterChipLink>
				<span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
				<FilterChipLink href={href({ brand: undefined })} active={!brand}>
					All brands
				</FilterChipLink>
				{HIRE_BRANDS.map((b) => (
					<FilterChipLink key={b} href={href({ brand: b })} active={brand === b}>
						{HIRE_BRAND_LABELS[b]}
					</FilterChipLink>
				))}
			</div>
			{error && error !== 'not_applied' && <p className="text-sm text-red-600 mb-3">{error}</p>}
			<Card padding="none">
				<table className="w-full text-sm">
					<thead className="text-left text-2xs uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-slate-700">
						<tr>
							<th className="px-3 py-2">Position</th>
							<th className="px-3 py-2">Brand</th>
							<th className="px-3 py-2">Type</th>
							<th className="px-3 py-2">Hiring manager</th>
							<th className="px-3 py-2">Pay level</th>
							<th className="px-3 py-2">Status</th>
							<th className="px-3 py-2">Updated</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
						{positions.length === 0 && (
							<tr>
								<td colSpan={7} className="px-3 py-8 text-center text-slate-500">
									Nothing here yet.
								</td>
							</tr>
						)}
						{positions.map((p) => (
							<tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/45">
								<td className="px-3 py-2">
									<Link href={`/hiring/positions/${p.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:underline">
										{p.title}
									</Link>
									<div className="text-2xs text-slate-500">
										{p.department_label ?? '—'} · {p.headcount}× · /{p.slug}
									</div>
								</td>
								<td className="px-3 py-2 text-slate-600 dark:text-slate-400">{HIRE_BRAND_LABELS[p.brand]}</td>
								<td className="px-3 py-2 text-slate-600 dark:text-slate-400">{EMPLOYMENT_TYPE_LABELS[p.employment_type]}</td>
								<td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.hiring_manager_id ? name.get(p.hiring_manager_id) ?? '—' : '—'}</td>
								<td className="px-3 py-2 text-slate-600 dark:text-slate-400 capitalize">{p.pay_level ?? '—'}</td>
								<td className="px-3 py-2">
									<Badge color={POSITION_STATUS_COLORS[p.status]}>{POSITION_STATUS_LABELS[p.status]}</Badge>
								</td>
								<td className="px-3 py-2 text-slate-500 text-xs">{formatRelative(p.updated_at)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</Card>
		</>
	);
}
