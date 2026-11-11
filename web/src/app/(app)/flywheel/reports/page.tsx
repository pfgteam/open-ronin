// /flywheel/reports — F6: every report in the pipeline (AI-generated →
// awaiting review → approved → sent → delivered → opened), draft one, and
// the health flags (F7) across programs.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig, loadPrograms } from '@/lib/flywheel/server';
import type { ReportRow, ReportTemplateRow } from '@/lib/flywheel/reports';
import NotAppliedCard from '../NotAppliedCard';
import { DraftReportForm, HealthFlags, ReportCard } from './Panels';

export const metadata = { title: 'Reports · Flywheel' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string; program?: string }> }) {
	const sp = await searchParams;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const [programs, { data: templates }, { data: flags }] = await Promise.all([loadPrograms(supabase, { status: 'open' }), supabase.from('fw_report_templates').select('*').eq('is_active', true).order('kind'), supabase.from('fw_health_flags').select('*, program:fw_programs!fw_health_flags_program_id_fkey(client:clients_v2!fw_programs_client_id_fkey(display_name))').eq('status', 'open').or(`muted_until.is.null,muted_until.lt.${new Date().toISOString()}`).order('severity').order('opened_at', { ascending: false }).limit(100)]);
	let q = supabase.from('fw_reports').select('*, client:clients_v2!fw_reports_client_id_fkey(display_name)').order('created_at', { ascending: false }).limit(80);
	if (sp.status === 'review') q = q.in('status', ['ai_generated', 'awaiting_review']);
	else if (sp.status === 'approved') q = q.eq('status', 'approved');
	else if (sp.status === 'sent') q = q.in('status', ['sent', 'delivered', 'opened']);
	if (sp.program && programs.some((p) => p.id === sp.program)) q = q.eq('program_id', sp.program);
	const { data: reports } = await q;
	type R = ReportRow & { client: { display_name: string } | null };
	const rows = (reports ?? []) as R[];
	const counts = { review: rows.filter((r) => r.status === 'ai_generated' || r.status === 'awaiting_review').length, approved: rows.filter((r) => r.status === 'approved').length, sent: rows.filter((r) => ['sent', 'delivered', 'opened'].includes(r.status)).length };
	type F = { id: string; program_id: string; kind: string; severity: string; summary: string; opened_at: string; last_seen_at: string; program: { client: { display_name: string } | null } | null };
	return (
		<>
			<PageHeader
				title="Reports & health"
				description="Friday recaps and monthly reports: AI-generated → awaiting review → approved → sent → delivered → opened (open pixel). Nothing reaches a client without a person approving it. Health flags from the behind-plan checker below."
				actions={
					<div className="flex gap-2 text-xs">
						<Link href="/flywheel/reports" className="text-primary-600 hover:underline">All</Link>
						<Link href="/flywheel/reports?status=review" className="text-primary-600 hover:underline">To review ({counts.review})</Link>
						<Link href="/flywheel/reports?status=approved" className="text-primary-600 hover:underline">Approved ({counts.approved})</Link>
						<Link href="/flywheel/reports?status=sent" className="text-primary-600 hover:underline">Sent ({counts.sent})</Link>
					</div>
				}
			/>
			<div className="grid gap-4 lg:grid-cols-3">
				<div className="lg:col-span-2 space-y-3">
					{rows.length === 0 ? (
						<Card><p className="text-sm text-slate-500">No reports yet. Draft one on the right; Fridays the cron drafts a recap per open program, day 3 of the month the monthly report.</p></Card>
					) : (
						rows.map((r) => <ReportCard key={r.id} report={r} clientName={r.client?.display_name ?? ''} />)
					)}
				</div>
				<div className="space-y-4">
					<DraftReportForm programs={programs.map((p) => ({ id: p.id, client_id: p.client_id, client_name: p.client_name }))} templates={(templates ?? []) as ReportTemplateRow[]} />
					<HealthFlags flags={((flags ?? []) as unknown as F[]).map((f) => ({ id: f.id, program_id: f.program_id, kind: f.kind, severity: f.severity, summary: f.summary, opened_at: f.opened_at, client_name: f.program?.client?.display_name ?? '' }))} />
					<Card>
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Templates</h2>
						<ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
							{((templates ?? []) as ReportTemplateRow[]).map((t) => (
								<li key={t.key}>
									<Badge>{t.kind.replace('_', ' ')}</Badge> <span className="text-slate-800 dark:text-slate-200">{t.label}</span> · data set: {(t.data_set.sources ?? []).join(', ') || '—'} · window {t.data_set.window ?? '—'}
								</li>
							))}
						</ul>
						<p className="text-2xs text-slate-500 mt-2">Edit the templates (subject, body, data set, filters, AI prompt) in Admin → Flywheel → SLA & rules via the JSON editor, or ask Architect bot for a form.</p>
					</Card>
				</div>
			</div>
		</>
	);
}
