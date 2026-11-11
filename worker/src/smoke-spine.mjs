// Smoke test: exercise the worker's spine path through PostgREST as service_role
// (the same RPCs the worker calls), without the Agent SDK.
// Usage: node src/smoke-spine.mjs [path/to/.env.local]   (default: ../web/.env.local)
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readTranscriptAsIdentity, proposeAction, dispatchSpineEvents } from './spine.mjs';

const envPath = process.argv[2] ?? path.resolve(process.cwd(), '../web/.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TEST_CALL = '00000000-0000-4000-8000-00000000c0de';

// 1. dispatch (idempotent: nothing pending -> 0)
console.log('dispatch:', await dispatchSpineEvents(supabase));

// 2. find the queued run created by step two
const { data: runs } = await supabase.from('skill_runs').select('id, skill, identity_slug, requested_by, triggered_by_event_id, status').eq('identity_slug', 'transcript_reader').order('created_at', { ascending: false }).limit(1);
const run = runs?.[0];
if (!run) { console.error('no transcript_reader run found — run verify_step2.sql first'); process.exit(1); }
console.log('run:', run);

// 3. gateway read as the identity, anchored on the event
const read = await readTranscriptAsIdentity(supabase, {
  identitySlug: run.identity_slug, sub: run.requested_by, workItemId: null, eventId: run.triggered_by_event_id, callId: TEST_CALL,
});
console.log('gateway read:', { ...read, row: read.row ? { read_as: read.row.read_as, words: read.row.word_count } : null });

// 4. forged act via PostgREST must fail
const forged = await supabase.rpc('spine_gateway_read_transcript', { p_identity_slug: 'nash', p_sub: run.requested_by, p_work_item_id: null, p_call_id: TEST_CALL, p_event_id: run.triggered_by_event_id });
console.log('forged act ->', forged.error?.message ?? 'UNEXPECTEDLY ALLOWED');

// 5. proposal lands in spine.proposed_actions
const pid = await proposeAction(supabase, { actionType: 'transcript.summary', identitySlug: 'transcript_reader', skillRunId: run.id, workItemId: null, reasoning: 'smoke test', payload: { result_md: '# smoke' } });
console.log('proposed_action id:', pid);

// 6. anon must NOT be able to call the gateway
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const anonTry = await anon.rpc('spine_gateway_read_transcript', { p_identity_slug: 'transcript_reader', p_sub: run.requested_by, p_work_item_id: null, p_call_id: TEST_CALL, p_event_id: run.triggered_by_event_id });
console.log('anon gateway ->', anonTry.error?.message ?? 'UNEXPECTEDLY ALLOWED');

// 7. anon / service_role must NOT be able to call the identity-owned reader directly (not exposed on public at all)
const anonReader = await anon.rpc('agent_transcript_reader__read_transcript', { p_call_id: TEST_CALL });
console.log('anon direct reader ->', anonReader.error?.message ?? 'UNEXPECTEDLY ALLOWED');
const srReader = await supabase.rpc('agent_transcript_reader__read_transcript', { p_call_id: TEST_CALL });
console.log('service_role direct reader ->', srReader.error?.message ?? 'UNEXPECTEDLY ALLOWED');

// 8. unknown event anchor must be refused
const badEvent = await supabase.rpc('spine_gateway_read_transcript', { p_identity_slug: 'transcript_reader', p_sub: run.requested_by, p_work_item_id: null, p_call_id: TEST_CALL, p_event_id: '00000000-0000-4000-8000-0000000000ee' });
console.log('unknown event ->', badEvent.error?.message ?? 'UNEXPECTEDLY ALLOWED');

// 9. a second proposal for the same run is allowed (drafts are cheap; review dedupes)
const { data: proposals } = await supabase.rpc('spine_propose_action', { p_action_type: 'transcript.summary', p_identity_slug: 'transcript_reader', p_skill_run_id: run.id, p_work_item_id: null, p_reasoning: 'smoke test', p_payload: { result_md: '# smoke 2' } });
console.log('second proposal id:', proposals);
