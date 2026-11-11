// AI time attribution.
//
// For each newly-synced calendar event:
//   1. RULES PASS — match against the user's open projects/tasks/clients:
//      • Event title contains client name (from clients table) → bill to that client.
//      • Event title contains project name (from projects/work_items) → log to that project.
//      • Event title matches a task title → log to that task.
//      • External attendees match a client's GHL contacts → bill to that client.
//   2. LLM FALLBACK — for events not matched by rules + category in
//      ('client_call','focus_block','podcast'), call the Open Ronin Beacon AI
//      endpoint to pick a best-fit client/project. NOT WIRED YET — see
//      matchByLLM() stub below; first iteration runs rules-only.
//
// Writes results to time_entries (source='ai_attributed') with the matched
// project_id/task_id/airtable_contract_id. A confidence score gates auto-
// approval: ≥ 0.8 marks the entry approved; otherwise it stays in a pending
// queue for the user to confirm. Categories with auto_log_time=true on
// calendar_event_categories drive whether we attribute at all.

import { isInternalEmail } from '@/lib/tenant/domains';
import type { SupabaseClient } from '@supabase/supabase-js';

// Beacon AI endpoint will be wired here once the inference URL is locked.
// For now, LLM fallback is a no-op — rules cover ~70% of cases and the
// remainder land in /the-work/time-entries for manual review (future page).
const CLASSIFIER_AI_URL = process.env.CLASSIFIER_AI_URL;        // e.g. https://api.beacon.example.org/classify
const CLASSIFIER_AI_KEY = process.env.CLASSIFIER_AI_KEY;

interface CalEventLite {
	id: string;
	title: string;
	starts_at: string;
	ends_at: string | null;
	category_key: string | null;
	attendee_external: string[] | null;
	user_id: string;
}

interface ProjectLite { id: string; name: string; airtable_contract_id: string | null; kind: string }
interface ClientLite { id: string; name: string; airtable_contract_id: string | null }

export async function attributeEventsToWork(
	supabase: SupabaseClient,
	user_id: string,
	upsertedEventIds: string[],
): Promise<number> {
	if (upsertedEventIds.length === 0) return 0;

	const [{ data: events }, { data: projects }, { data: clientsRaw }, { data: categories }] = await Promise.all([
		supabase
			.from('calendar_events')
			.select('id, title, starts_at, ends_at, category_key, attendee_external, user_id')
			.in('id', upsertedEventIds),
		supabase
			.from('projects')
			.select('id, name, airtable_contract_id, kind')
			.eq('archived', false)
			.in('kind', ['project', 'priority', 'campaign', 'event', 'client_work', 'assignment']),
		supabase.from('clients').select('id, name, airtable_contract_id').limit(500).then(
			(r) => r.error ? { data: [] } : r,
		),
		supabase
			.from('calendar_event_categories')
			.select('key, auto_log_time, default_billable'),
	]);

	const evList = (events ?? []) as CalEventLite[];
	const projList = (projects ?? []) as ProjectLite[];
	const clientList = (clientsRaw ?? []) as ClientLite[];
	const catMap = new Map((categories ?? []).map((c: { key: string; auto_log_time: boolean; default_billable: boolean }) => [c.key, c]));

	let attributed = 0;

	for (const ev of evList) {
		const cat = ev.category_key ? catMap.get(ev.category_key) : null;
		if (cat && !cat.auto_log_time) continue;     // category opt-out

		const match = matchByRules(ev, projList, clientList);
		if (!match && shouldFallbackToLLM(ev)) {
			const llmMatch = await matchByLLM(ev, projList, clientList);
			if (llmMatch) {
				await writeTimeEntry(supabase, user_id, ev, llmMatch);
				attributed++;
			}
			continue;
		}

		if (match) {
			await writeTimeEntry(supabase, user_id, ev, match);
			attributed++;
		}
	}

	return attributed;
}

interface AttributionMatch {
	project_id?: string;
	task_id?: string;
	airtable_contract_id?: string;
	confidence: number;
	reasoning: string;
	source: 'rule' | 'llm';
}

function matchByRules(ev: CalEventLite, projects: ProjectLite[], clients: ClientLite[]): AttributionMatch | null {
	const title = ev.title.toLowerCase();

	// Client name in title
	for (const c of clients) {
		if (!c.name) continue;
		const cname = c.name.toLowerCase();
		if (cname.length >= 3 && title.includes(cname)) {
			return {
				airtable_contract_id: c.airtable_contract_id ?? undefined,
				confidence: 0.85,
				reasoning: `Title contains client name "${c.name}"`,
				source: 'rule',
			};
		}
	}
	// Project name in title
	for (const p of projects) {
		if (!p.name) continue;
		const pname = p.name.toLowerCase();
		if (pname.length >= 4 && title.includes(pname)) {
			return {
				project_id: p.id,
				airtable_contract_id: p.airtable_contract_id ?? undefined,
				confidence: 0.82,
				reasoning: `Title contains project name "${p.name}"`,
				source: 'rule',
			};
		}
	}
	// External attendee → client (by email domain match against client name slug)
	for (const email of ev.attendee_external ?? []) {
		const lower = email.toLowerCase();
		if (isInternalEmail(lower)) continue;
		const domain = lower.split('@')[1] ?? '';
		const root = domain.split('.')[0];
		const matchClient = clients.find((c) => c.name?.toLowerCase().includes(root) && root.length >= 4);
		if (matchClient) {
			return {
				airtable_contract_id: matchClient.airtable_contract_id ?? undefined,
				confidence: 0.78,
				reasoning: `Attendee domain "${domain}" matches client "${matchClient.name}"`,
				source: 'rule',
			};
		}
	}
	return null;
}

function shouldFallbackToLLM(ev: CalEventLite): boolean {
	if (!CLASSIFIER_AI_URL) return false;                                          // Beacon not wired yet → skip
	const cat = ev.category_key;
	return cat === 'client_call' || cat === 'focus_block' || cat === 'podcast' || cat === 'internal_meet';
}

/** Beacon AI classification call. Wire URL + key in env when ready.
 *  Expected response shape (subject to change once Beacon schema lands):
 *    { kind: 'client'|'project'|'none', id: string|null, confidence: 0-1, reason: string }
 *  Until CLASSIFIER_AI_URL is set, this returns null and only rules attribution runs. */
async function matchByLLM(ev: CalEventLite, projects: ProjectLite[], clients: ClientLite[]): Promise<AttributionMatch | null> {
	if (!CLASSIFIER_AI_URL) return null;

	const payload = {
		task: 'classify_calendar_event',
		event: {
			title: ev.title,
			category: ev.category_key,
			attendees: ev.attendee_external,
			starts_at: ev.starts_at,
		},
		choices: {
			projects: projects.slice(0, 60).map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
			clients:  clients.slice(0, 100).map((c) => ({ id: c.airtable_contract_id ?? c.id, name: c.name })),
		},
	};

	try {
		const r = await fetch(CLASSIFIER_AI_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(CLASSIFIER_AI_KEY ? { authorization: `Bearer ${CLASSIFIER_AI_KEY}` } : {}),
			},
			body: JSON.stringify(payload),
		});
		if (!r.ok) return null;
		const json = await r.json() as { kind?: string; id?: string | null; confidence?: number; reason?: string };
		if (!json.kind || json.kind === 'none' || !json.id) return null;

		if (json.kind === 'client') {
			return {
				airtable_contract_id: json.id,
				confidence: Math.min(json.confidence ?? 0.5, 0.75),
				reasoning: `Beacon: ${json.reason ?? ''}`,
				source: 'llm',
			};
		}
		if (json.kind === 'project') {
			return {
				project_id: json.id,
				confidence: Math.min(json.confidence ?? 0.5, 0.75),
				reasoning: `Beacon: ${json.reason ?? ''}`,
				source: 'llm',
			};
		}
	} catch {
		return null;
	}
	return null;
}

async function writeTimeEntry(supabase: SupabaseClient, user_id: string, ev: CalEventLite, match: AttributionMatch) {
	const durationMin = ev.ends_at
		? Math.max(0, Math.round((new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60_000))
		: null;

	await supabase
		.from('time_entries')
		.upsert({
			user_id,
			task_id: match.task_id ?? null,
			project_id: match.project_id ?? null,
			airtable_contract_id: match.airtable_contract_id ?? null,
			source: match.source === 'llm' ? 'ai_attributed' : 'calendar_auto',
			calendar_event_id: ev.id,
			started_at: ev.starts_at,
			ended_at: ev.ends_at,
			duration_minutes: durationMin,
			billable: false,                                // rule layer doesn't know billing — admin reviews
			ai_confidence: match.confidence,
			ai_reasoning: match.reasoning,
			approved_at: match.confidence >= 0.8 ? new Date().toISOString() : null,
		}, { onConflict: 'calendar_event_id' as never });    // requires unique on calendar_event_id; add if missing
}
