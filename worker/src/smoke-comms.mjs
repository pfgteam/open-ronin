// Smoke test for the comms Phase 1 done-test, driven the way the worker
// would drive it, without the polling loop or the Agent SDK:
//
//   1. Alex posts "@client_pulse what is going on with <client>?" in #ai-test
//      (comms_send_message_as — the same insert path the composer uses).
//   2. spine_dispatch_events turns the chat.mention.client_pulse event into a
//      skill_runs row with sub = Alex.
//   3. runtime.runOne executes it: thread read (audit), client_pulse reader
//      (audit), deterministic reply, chat.reply proposal, apply (Auto).
//   4. Print the audit rows and the agent's message.
//
// Usage: node src/smoke-comms.mjs [path/to/.env.local] ["<client name>"]
// (default env: ../web/.env.local; default client: the most recently updated
// client that has open work).

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { dispatchSpineEvents } from './spine.mjs';
import { createRuntime } from './runtime.mjs';

const envPath = process.argv[2] ?? path.resolve(process.cwd(), '../web/.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: alex } = await supabase.from('profiles').select('id, email').eq('email', 'owner@example.com').single();
const { data: conv } = await supabase.from('comms_conversations').select('id, slug, title').eq('slug', 'ai-test').single();
if (!alex || !conv) { console.error('need alex + #ai-test (migration 0061)'); process.exit(1); }

let clientName = process.argv[3];
if (!clientName) {
  const { data: p } = await supabase.from('projects').select('client_id, clients_v2!inner(display_name)').not('client_id', 'is', null).eq('archived', false).is('completed_at', null).order('updated_at', { ascending: false }).limit(1);
  clientName = p?.[0]?.clients_v2?.display_name ?? 'Main';
}

// 1. the mention
const body = `@client_pulse what is going on with ${clientName}?`;
const { data: msgId, error: sendErr } = await supabase.rpc('comms_send_message_as', { p_profile_id: alex.id, p_conversation_id: conv.id, p_body: body });
if (sendErr) throw sendErr;
console.log('1. mention posted:', msgId, JSON.stringify(body));

// 2. dispatch
const d = await dispatchSpineEvents(supabase);
console.log('2. dispatch:', d);
const { data: ev } = await supabase.from('skill_runs').select('id, skill, identity_slug, requested_by, triggered_by_event_id, status').eq('identity_slug', 'client_pulse').order('created_at', { ascending: false }).limit(1);
const run = ev?.[0];
if (!run) { console.error('no client_pulse run dispatched'); process.exit(1); }
console.log('   run:', run.id, run.skill, 'sub=', run.requested_by === alex.id ? 'alex' : run.requested_by, 'event=', run.triggered_by_event_id);

// 3. execute
const runtime = createRuntime({ supabase, skillsDir: path.resolve(process.cwd(), 'skills'), hasModel: false, runtimeName: 'smoke-comms' });
const out = await runtime.runOne({ onlyId: run.id });
console.log('3. run result:', out?.status, out?.resultMd ?? out?.error);

// 4. evidence
const { data: reply } = await supabase.from('comms_messages').select('id, sender_name, sender_type, body, payload, sent_at').eq('conversation_id', conv.id).order('sent_at', { ascending: false }).limit(1).single();
console.log('4. agent message:', reply?.sender_name, `(${reply?.sender_type})`, '\n---\n' + (reply?.body ?? '') + '\n---');
console.log('   why:', JSON.stringify(reply?.payload?.why));
console.log('   audit ids in payload:', reply?.payload?.audit_id, JSON.stringify(reply?.payload?.why?.reads?.map((r) => r.audit_id)));
