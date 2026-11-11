'use client';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { VIDEO_STATUSES, VIDEO_STATUS_LABELS, type ClusterRow, type VideoRow } from '@/lib/flywheel/shared';
import ActionForm from '../../../ActionForm';
import { saveVideo } from '../../../actions';

export default function VideoPanels({ programId, video, clusters }: { programId: string; video: VideoRow; clusters: ClusterRow[] }) {
	const chapterText = video.chapters.map((c) => (c.start_sec != null ? `${Math.floor(c.start_sec / 60)}:${String(c.start_sec % 60).padStart(2, '0')} ${c.title}` : c.title)).join('\n');
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<div className="lg:col-span-2 space-y-4">
				<Card>
					<ActionForm action={saveVideo} success="Saved." className="grid gap-3 md:grid-cols-4">
						<input type="hidden" name="id" value={video.id} />
						<input type="hidden" name="program_id" value={programId} />
						<div className="md:col-span-2">
							<Input label="Working title" name="title" defaultValue={video.title ?? ''} />
						</div>
						<Select label="Status" name="status" defaultValue={video.status}>
							{VIDEO_STATUSES.map((s) => (
								<option key={s} value={s}>
									{VIDEO_STATUS_LABELS[s]}
								</option>
							))}
						</Select>
						<Select label="Cluster" name="cluster_id" defaultValue={video.cluster_id ?? ''}>
							<option value="">—</option>
							{clusters.map((c) => (
								<option key={c.id} value={c.id}>
									Cluster {c.number}
								</option>
							))}
						</Select>
						<Input label="Shoot (date/time)" name="shoot_at" type="datetime-local" defaultValue={video.shoot_at ? video.shoot_at.slice(0, 16) : ''} />
						<Input label="SME on camera" name="sme_name" defaultValue={video.sme_name ?? ''} />
						<Input label="Recording link (Zoom / Drive)" name="recording_url" defaultValue={video.recording_url ?? ''} />
						<Input label="YouTube URL" name="youtube_url" defaultValue={video.youtube_url ?? ''} />
						<div className="md:col-span-2">
							<Textarea label="Chapters (one per line: 'm:ss Verbatim keyword title')" name="chapters" rows={11} defaultValue={chapterText} />
						</div>
						<div className="md:col-span-2 space-y-2">
							<Select label="Script status" name="script_status" defaultValue={video.script_status}>
								<option value="draft">Draft</option>
								<option value="in_review">In review (lane)</option>
								<option value="verification">Verification (Gabi)</option>
								<option value="approved">Approved</option>
							</Select>
							<Textarea label="Notes" name="notes_md" rows={6} defaultValue={video.notes_md ?? ''} />
						</div>
						<div className="md:col-span-4">
							<Textarea label="Word-for-word recording script (the SME reads it verbatim; F4 drafts from the chapter map)" name="script_md" rows={12} defaultValue={video.script_md ?? ''} />
						</div>
						<div className="md:col-span-4">
							<Textarea label="Transcript (paste, or F4 pulls it from Sessions / YouTube)" name="transcript_md" rows={6} defaultValue={video.transcript_md ?? ''} />
						</div>
						<div className="md:col-span-4">
							<Button type="submit" size="sm">
								Save recording
							</Button>
						</div>
					</ActionForm>
				</Card>
			</div>
			<Card>
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Recording checklist</h2>
				<ul className="space-y-2">
					{video.checklist.map((item) => (
						<li key={item.key}>
							<ActionForm action={saveVideo} success={null} className="flex items-start gap-2 text-xs">
								<input type="hidden" name="id" value={video.id} />
								<input type="hidden" name="program_id" value={programId} />
								<input type="hidden" name="check_key" value={item.key} />
								<Checkbox name="check_done" defaultChecked={!!item.done} onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()} />
								<span className={item.done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}>
									{item.label}
									{item.owner && <span className="ml-1 text-2xs text-slate-500">({item.owner})</span>}
								</span>
							</ActionForm>
						</li>
					))}
				</ul>
			</Card>
		</div>
	);
}
