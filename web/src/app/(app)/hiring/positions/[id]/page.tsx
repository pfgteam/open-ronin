// /hiring/positions/[id] — one position: status + approval trail, the
// builder (4R, posting, pay link) and the event history.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { hasCapability } from '@/lib/permissions/capabilities';
import { applicationCounts, loadBoards, loadCatalogs, loadHiringConfig, loadPosition, loadPositionContext, loadPostKit, loadSessionFunnel, loadStagesFor } from '@/lib/hiring/server';
import { isEmptyConfig, type ApplicationConfig } from '@/lib/hiring/application';
import { aiConfigured } from '@/lib/hiring/ai';
import { HIRE_BRAND_LABELS, POSITION_STATUS_COLORS, POSITION_STATUS_LABELS } from '@/lib/hiring/shared';
import { formatDate, formatRelative } from '@/lib/format';
import NotAppliedCard from '../../NotAppliedCard';
import PositionBuilder from '../PositionBuilder';
import StatusControls from './StatusControls';
import PostKit from './PostKit';
import ApplicationBuilder from './ApplicationBuilder';
import StagesEditor from './StagesEditor';

export const dynamic = 'force-dynamic';

export default async function PositionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
	const sp = await searchParams;
	const tab = sp.tab === 'postkit' ? 'postkit' : sp.tab === 'application' ? 'application' : sp.tab === 'stages' ? 'stages' : 'builder';
	const { id } = await params;
	if (id === 'new') redirect('/hiring/positions/new');
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const [config, canManage] = await Promise.all([loadHiringConfig(supabase), hasCapability('manage_hiring')]);
	if (config.notApplied) return <NotAppliedCard />;
	const position = await loadPosition(supabase, id);
	if (!position) notFound();
	const [ctx, catalogs, boards, kit, counts, funnel] = await Promise.all([loadPositionContext(supabase, position), loadCatalogs(supabase), loadBoards(supabase), loadPostKit(supabase, position.id), applicationCounts(supabase, [position.id]), loadSessionFunnel(supabase, position.id)]);
	const appCount = counts.get(position.id) ?? { total: 0, new: 0, flagged: 0 };
	const stagesCfg = await loadStagesFor(supabase, { interview_config: position.interview_config });
	const canEditKit = canManage || position.hiring_manager_id === profile.id || position.recruiter_id === profile.id;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const name = new Map(ctx.people.map((p) => [p.id, p.name]));
	// Comp visibility mirrors can_view_position_comp(): exec/admin, can_view_comp, or the hiring manager. RLS already filtered ctx.comp.
	const canSeeComp = profile.role === 'admin' || profile.role === 'exec' || position.hiring_manager_id === profile.id || ctx.comp !== null || canManage;

	return (
		<>
			<PageHeader
				title={position.title}
				description={`${HIRE_BRAND_LABELS[position.brand]}${position.department_label ? ` · ${position.department_label}` : ''} · ${position.headcount}× · /${position.slug}`}
				actions={
					<div className="flex items-center gap-2">
						<Badge color={POSITION_STATUS_COLORS[position.status]}>{POSITION_STATUS_LABELS[position.status]}</Badge>
						<Link href="/hiring/positions">
							<Button variant="ghost" size="sm">
								All positions
							</Button>
						</Link>
					</div>
				}
			/>
			<div className="grid gap-4 lg:grid-cols-3 mb-4">
				<Card className="lg:col-span-2 space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Status</h2>
					<StatusControls id={position.id} status={position.status} canManage={canManage} hasRequest={!!position.request_id} />
					<dl className="grid sm:grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400 pt-2">
						<div>
							<dt className="text-2xs uppercase tracking-wide text-slate-500">Hiring manager</dt>
							<dd>{position.hiring_manager_id ? name.get(position.hiring_manager_id) ?? '—' : '—'}</dd>
						</div>
						<div>
							<dt className="text-2xs uppercase tracking-wide text-slate-500">Approved</dt>
							<dd>{position.approved_at ? `${formatDate(position.approved_at)} by ${position.approved_by ? name.get(position.approved_by) ?? '—' : '—'}` : 'not yet'}</dd>
						</div>
						<div>
							<dt className="text-2xs uppercase tracking-wide text-slate-500">Request</dt>
							<dd>
								{ctx.request ? (
									<Link href="/admin/innovation-desk?kind=position_request" className="text-primary-600 hover:underline">
										{ctx.request.status} · {formatRelative(ctx.request.created_at)}
									</Link>
								) : (
									'none filed'
								)}
							</dd>
						</div>
					</dl>
				</Card>
				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">History</h2>
					<ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 max-h-48 overflow-auto">
						{ctx.events.map((e) => (
							<li key={e.id}>
								<span className="text-slate-500">{formatRelative(e.created_at)}</span> · {e.kind === 'created' ? 'created' : `${e.from_status ?? '—'} → ${e.to_status}`}
								{e.actor_id && <span className="text-slate-500"> · {name.get(e.actor_id) ?? ''}</span>}
							</li>
						))}
					</ul>
				</Card>
			</div>
			<div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
				{(
					[
						['builder', 'Role & 4R'],
						['application', 'Application'],
						['stages', 'Stages & interviewers'],
						['postkit', `Post kit${kit.postings.length ? ` (${kit.postings.length})` : ''}`],
					] as const
				).map(([key, label]) => (
					<Link key={key} href={`/hiring/positions/${position.id}?tab=${key}`} className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${tab === key ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
						{label}
					</Link>
				))}
				<Link href={`/hiring/positions/${position.id}/applications`} className="px-3 py-2 text-sm -mb-px border-b-2 border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap">
					Applications{appCount.total ? ` (${appCount.total}${appCount.new ? ` · ${appCount.new} new` : ''})` : ''}
				</Link>
			</div>
			{tab === 'builder' ? (
				<PositionBuilder position={position} comp={ctx.comp} config={config} templates={ctx.templates} people={ctx.people} catalogs={catalogs} canManage={canManage} canSeeComp={canSeeComp} />
			) : tab === 'stages' ? (
				<StagesEditor positionId={position.id} initial={stagesCfg} people={ctx.people} canEdit={canEditKit} />
			) : tab === 'application' ? (
				<ApplicationBuilder positionId={position.id} slug={position.slug} initial={isEmptyConfig(position.application_config) ? null : (position.application_config as unknown as ApplicationConfig)} canManage={canManage} aiReady={aiConfigured()} appUrl={appUrl} funnel={funnel} />
			) : (
				<PostKit positionId={position.id} slug={position.slug} status={position.status} boards={boards} postings={kit.postings} links={kit.links} canEdit={canEditKit} appUrl={appUrl} aiReady={aiConfigured()} names={Object.fromEntries(name)} />
			)}
		</>
	);
}
