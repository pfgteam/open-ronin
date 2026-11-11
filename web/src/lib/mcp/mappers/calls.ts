// Pure allowlist mappers for the sessions:read tools. `calls.transcript_url`
// is a real column (migration 0041:61) and `call_transcripts` a real table —
// neither may ever appear here. A pointer to the transcript is as off-limits
// as the transcript text itself.
import { scoreBand, type AttentionPoint, type CallAnalysisDimension, type ScoreBand } from '@/lib/sessions/analysis';

export type AttentionCounts = { info: number; warning: number; critical: number };

export function attentionCounts(points: AttentionPoint[]): AttentionCounts {
	const counts: AttentionCounts = { info: 0, warning: 0, critical: 0 };
	for (const p of points) counts[p.severity] += 1;
	return counts;
}

type CallListInput = {
	id: string;
	client_id: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	attendee_user_ids: string[];
	attendee_external: string[];
};

type AnalysisRow = {
	call_id: string;
	overall_score: number;
	attention_points: AttentionPoint[];
	created_at: string;
};

export type CallRow = {
	id: string;
	client_name: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	overall_score: number | null;
	score_band: ScoreBand | null;
	attention_counts: AttentionCounts;
	pending_suggestions: number;
	attendees: string[];
	external_attendee_count: number;
	url: string;
};

export function mapCallRow(input: {
	call: CallListInput;
	analysis: AnalysisRow | null;
	pendingSuggestions: number;
	attendeeNames: string[];
	clientName: string | null;
}): CallRow {
	const { call, analysis, pendingSuggestions, attendeeNames, clientName } = input;
	return {
		id: call.id,
		client_name: clientName,
		call_type: call.call_type,
		occurred_at: call.occurred_at,
		duration_minutes: call.duration_minutes,
		overall_score: analysis?.overall_score ?? null,
		score_band: analysis ? scoreBand(analysis.overall_score) : null,
		attention_counts: attentionCounts(analysis?.attention_points ?? []),
		pending_suggestions: pendingSuggestions,
		attendees: attendeeNames,
		external_attendee_count: call.attendee_external.length,
		url: `/team/sessions/${call.id}`,
	};
}

type CallDetailInput = {
	id: string;
	client_id: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	recording_url: string | null;
	attendee_user_ids: string[];
	attendee_external: string[];
};

type AnalysisMetaRow = {
	analyzer: string;
	prompt_version: string | null;
	overall_score: number;
	created_at: string;
};

type AnalysisFullRow = {
	summary_md: string;
	dimensions: CallAnalysisDimension[];
	attention_points: AttentionPoint[];
};

type SuggestedTaskRow = {
	title: string;
	detail_md: string | null;
	status: 'pending' | 'accepted' | 'dismissed';
	created_task_id: string | null;
};

type ProfileRow = {
	first_name: string | null;
	last_name: string | null;
	email: string;
};

function profileName(p: ProfileRow): string {
	return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

export type CallDetail = {
	id: string;
	client_name: string | null;
	call_type: string;
	occurred_at: string;
	duration_minutes: number | null;
	recording_url: string | null;
	summary_md: string | null;
	dimensions: CallAnalysisDimension[];
	attention_points: AttentionPoint[];
	suggested_tasks: Array<{ title: string; detail_md: string | null; status: string; created_task_id: string | null }>;
	attendees: string[];
	external_attendees: string[];
	analysis: { analyzer: string; prompt_version: string | null; overall_score: number; score_band: ScoreBand; created_at: string } | null;
	earlier_analyses: number;
	url: string;
};

export function mapCallDetail(input: {
	call: CallDetailInput;
	analysesMeta: AnalysisMetaRow[];
	latestAnalysisFull: AnalysisFullRow | null;
	suggestedTasks: SuggestedTaskRow[];
	attendeeProfiles: ProfileRow[];
	clientName: string | null;
}): CallDetail {
	const { call, analysesMeta, latestAnalysisFull, suggestedTasks, attendeeProfiles, clientName } = input;
	const latestMeta = analysesMeta[0] ?? null;
	return {
		id: call.id,
		client_name: clientName,
		call_type: call.call_type,
		occurred_at: call.occurred_at,
		duration_minutes: call.duration_minutes,
		recording_url: call.recording_url,
		summary_md: latestAnalysisFull?.summary_md ?? null,
		dimensions: latestAnalysisFull?.dimensions ?? [],
		attention_points: latestAnalysisFull?.attention_points ?? [],
		suggested_tasks: suggestedTasks.map((t) => ({
			title: t.title,
			detail_md: t.detail_md,
			status: t.status,
			created_task_id: t.created_task_id,
		})),
		attendees: attendeeProfiles.map(profileName),
		external_attendees: call.attendee_external,
		analysis: latestMeta
			? {
					analyzer: latestMeta.analyzer,
					prompt_version: latestMeta.prompt_version,
					overall_score: latestMeta.overall_score,
					score_band: scoreBand(latestMeta.overall_score),
					created_at: latestMeta.created_at,
				}
			: null,
		earlier_analyses: Math.max(analysesMeta.length - 1, 0),
		url: `/team/sessions/${call.id}`,
	};
}
