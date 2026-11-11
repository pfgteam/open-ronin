// /admin/innovation-desk — Innovation Desk Pipeline (Alex, 2026-09-14).
//
// Every staff_requests row in one admin-side queue, grouped by pipeline
// stage (Submitted -> In review -> Approved (awaiting completion) -> Done /
// Denied / Withdrawn), filterable by kind and type. Admin/exec only (the
// /admin ModuleGate); the decide/review/complete controls are the same
// server actions the desk uses, returning here.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import FilterChip from '@/components/ui/FilterChipLink';
import Link from 'next/link';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { FormError } from '../../team/_form';
import {
	INNOVATION_DESK_PATH,
	INNOVATION_PIPELINE_PATH,
	INNOVATION_TYPES,
	INNOVATION_TYPE_LABELS,
	KIND_LABELS,
	REQUEST_KINDS,
	type RequestKind,
} from '@/lib/requests/kinds';
import {
	RequestSummary,
	ReviewerActions,
	StatusBadge,
	type RequestRow,
} from '@/app/(app)/the-work/innovation-desk/RequestRows';

export const metadata = { title: 'Innovation Desk Pipeline' };
export const dynamic = 'force-dynamic';

const STAGES: { key: string; title: string; statuses: string[]; note: string }[] = [
	{ key: 'submitted', title: 'Submitted', statuses: ['pending'], note: 'Waiting for a reviewer' },
	{ key: 'in_review', title: 'In review', statuses: ['in_review'], note: 'Claimed by a reviewer' },
	{ key: 'approved', title: 'Approved · awaiting completion', statuses: ['approved'], note: 'Two-step kinds only' },
	{ key: 'closed', title: 'Closed', statuses: ['completed', 'denied', 'withdrawn'], note: 'Last 60 days' },
];

function href(params: Record<string, string | undefined>): string {
	const usp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
	const s = usp.toString();
	return s ? `${INNOVATION_PIPELINE_PATH}?${s}` : INNOVATION_PIPELINE_PATH;
}

export default async function InnovationPipelinePage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; kind?: string; type?: string }>;
}) {
	const { error, kind: kindParam, type: typeParam } = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	if (!['admin', 'exec'].includes(profile.role)) redirect(INNOVATION_DESK_PATH);

	const kind = REQUEST_KINDS.includes(kindParam as RequestKind) ? (kindParam as RequestKind) : null;
	const type = INNOVATION_TYPES.includes(typeParam as (typeof INNOVATION_TYPES)[number]) ? typeParam : null;

	const supabase = await createClient();
	const { data: rows, error: readError } = await supabase
		.from('staff_requests')
		.select(
			'id, kind, title, body_md, payload, requester_id, reviewer_group_id, status, decided_at, decision_note_md, created_at, requester:profiles!staff_requests_requester_id_fkey(first_name, last_name)',
		)
		.order('created_at', { ascending: false })
		.limit(1000);

	const all = (rows ?? []) as unknown as RequestRow[];
	const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
	const filtered = all.filter(
		(r) =>
			(!kind || r.kind === kind) &&
			(!type || (r.kind === 'innovation' && r.payload.innovation_type === type)),
	);

	const countByKind = new Map<string, number>();
	for (const r of all) countByKind.set(r.kind, (countByKind.get(r.kind) ?? 0) + 1);
	const countByType = new Map<string, number>();
	for (const r of all) if (r.kind === 'innovation' && r.payload.innovation_type) countByType.set(r.payload.innovation_type, (countByType.get(r.payload.innovation_type) ?? 0) + 1);

	// approved is terminal for one-step kinds: those belong in Closed, not
	// "awaiting completion".
	const stageOf = (r: RequestRow): string => {
		if (r.status === 'approved' && !['software_change', 'innovation'].includes(r.kind)) return 'closed';
		return STAGES.find((s) => s.statuses.includes(r.status))?.key ?? 'closed';
	};

	return (
		<>
			<div className="space-y-4">
				<PageHeader
					title="Innovation Desk Pipeline"
					description="Every submission across all kinds, by stage. Same approve / deny / complete controls as the desk."
					actions={
						<Link href={INNOVATION_DESK_PATH} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
							Open the desk →
						</Link>
					}
				/>
				<FormError message={error} />
				{readError && (
					<Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
						<p className="text-sm text-red-700 dark:text-red-300">Could not read submissions: {readError.message}</p>
					</Card>
				)}

				<div className="flex flex-wrap items-center gap-2">
					<FilterChip href={href({ type: type ?? undefined })} active={!kind} count={all.length}>
						All kinds
					</FilterChip>
					{REQUEST_KINDS.map((k) => (
						<FilterChip key={k} href={href({ kind: k, type: type ?? undefined })} active={kind === k} count={countByKind.get(k) ?? 0}>
							{KIND_LABELS[k]}
						</FilterChip>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 font-medium mr-1">Innovation type</span>
					<FilterChip href={href({ kind: kind ?? undefined })} active={!type}>
						Any
					</FilterChip>
					{INNOVATION_TYPES.map((t) => (
						<FilterChip key={t} href={href({ kind: kind ?? undefined, type: t })} active={type === t} count={countByType.get(t) ?? 0}>
							{INNOVATION_TYPE_LABELS[t]}
						</FilterChip>
					))}
				</div>

				{STAGES.map((stage) => {
					const inStage = filtered.filter((r) => stageOf(r) === stage.key);
					const shown = stage.key === 'closed' ? inStage.filter((r) => Date.parse(r.decided_at ?? r.created_at) > sixtyDaysAgo) : inStage;
					return (
						<Card key={stage.key} padding="none">
							<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
								<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{stage.title}</h3>
								<span className="text-xs text-slate-400 tabular-nums">{shown.length}</span>
								<span className="text-2xs text-slate-600 dark:text-slate-400 ml-auto">{stage.note}</span>
							</div>
							<div className="divide-y divide-slate-200 dark:divide-slate-700">
								{shown.length === 0 && (
									<p className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">Nothing here.</p>
								)}
								{shown.map((r) => (
									<div key={r.id} className="px-4 py-3 space-y-2">
										<div className="flex items-center justify-between gap-3">
											<RequestSummary r={r} />
											<StatusBadge status={r.status} />
										</div>
										{stage.key !== 'closed' && <ReviewerActions r={r} returnTo={INNOVATION_PIPELINE_PATH} />}
									</div>
								))}
							</div>
						</Card>
					);
				})}
			</div>
		</>
	);
}
