// /flywheel/[id]/videos/[videoId] — one monthly seed-video recording: the
// checklist, chapters (verbatim keywords, one per page), script, shoot,
// recording / YouTube links, transcript (Sessions bridge in F4).

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadFlywheelConfig } from '@/lib/flywheel/server';
import { VIDEO_STATUS_LABELS, type ClusterRow, type VideoRow } from '@/lib/flywheel/shared';
import { formatDate } from '@/lib/format';
import NotAppliedCard from '../../../NotAppliedCard';
import VideoPanels from './VideoPanels';
import { DraftCard, RunAgentButton } from '../../../ProductionPanels';
import { loadAgents } from '@/lib/flywheel/production';
import { loadDrafts, loadMyRoles } from '@/lib/flywheel/server';
import { aiConfigured } from '@/lib/flywheel/ai';
import { hasCapability } from '@/lib/permissions/capabilities';

export const dynamic = 'force-dynamic';

export default async function VideoDetail({ params }: { params: Promise<{ id: string; videoId: string }> }) {
	const { id, videoId } = await params;
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const supabase = await createClient();
	const config = await loadFlywheelConfig(supabase);
	if (config.notApplied) return <NotAppliedCard />;
	const [{ data: v }, { data: clusters }] = await Promise.all([supabase.from('fw_videos').select('*').eq('id', videoId).maybeSingle(), supabase.from('fw_clusters').select('*').eq('program_id', id).order('number')]);
	const video = v as VideoRow | null;
	if (!video || video.program_id !== id) notFound();
	const vid = { ...video, chapters: video.chapters ?? [], checklist: video.checklist ?? [], shorts_cut_list: video.shorts_cut_list ?? [] };
	const done = vid.checklist.filter((c) => c.done).length;
	const [agents, myRolesMap, canManage, drafts] = await Promise.all([loadAgents(supabase), loadMyRoles(supabase, profile.id), profile.role === 'admin' || profile.role === 'exec' ? Promise.resolve(true) : hasCapability('manage_flywheel'), loadDrafts(supabase, id, { targetId: videoId })]);
	const scriptAgent = agents.find((a) => a.output_kind === 'script' && a.is_active) ?? null;
	const shortsAgent = agents.find((a) => a.output_kind === 'shorts' && a.is_active) ?? null;
	const aiOn = aiConfigured();
	return (
		<>
			<PageHeader
				title={`Seed video · ${formatDate(vid.month).replace(/^\d+ /, '')}`}
				description={`${vid.title ?? 'Monthly recording'} · ${vid.chapters.length} chapters · checklist ${done}/${vid.checklist.length}`}
				actions={
					<div className="flex items-center gap-2">
						<Badge color={vid.status === 'published' ? 'success' : 'primary'}>{VIDEO_STATUS_LABELS[vid.status]}</Badge>
						<Link href={`/flywheel/${id}?tab=videos`}>
							<Button variant="ghost" size="sm">
								All recordings
							</Button>
						</Link>
					</div>
				}
			/>
			<Card className="mb-4">
				<div className="flex flex-wrap items-center gap-2">
					{scriptAgent && <RunAgentButton programId={id} targetId={vid.id} agent={scriptAgent} aiOn={aiOn} notes />}
					{shortsAgent && <RunAgentButton programId={id} targetId={vid.id} agent={shortsAgent} aiOn={aiOn} />}
					<span className="text-2xs text-slate-500">Script → writers lane → verification; the SME reads the approved script verbatim. Shorts need the transcript.</span>
				</div>
			</Card>
			<VideoPanels programId={id} video={vid} clusters={(clusters ?? []) as ClusterRow[]} />
			{drafts.length > 0 && (
				<div className="mt-4 space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Drafts for this recording</h2>
					{drafts.map((d) => (
						<DraftCard key={d.id} draft={d} programId={id} myRoles={myRolesMap.get(id) ?? []} canManage={canManage} />
					))}
				</div>
			)}
			<Card className="mt-4">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">Seed video spec (SOP Step 5)</h2>
				<ul className="text-xs text-slate-600 dark:text-slate-400 list-disc pl-4 space-y-0.5">
					<li>15–20 minutes; ten chapters, each titled with a verbatim target keyword (YouTube indexes chapter titles)</li>
					<li>Each chapter maps 1:1 to one on-site page and supplies its source material</li>
					<li>Final chapter: full brand name + primary domain</li>
					<li>SME on camera; Open Ronin runs the session (one 60-minute recording)</li>
					<li>Upload with keyword-rich title, full description, tags, chapter timestamps; pull the transcript for atomization</li>
				</ul>
			</Card>
		</>
	);
}
