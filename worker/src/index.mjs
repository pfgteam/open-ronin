// Open Ronin skills runtime v1 (Claude Agent SDK worker)
// ------------------------------------------------------
// The contract: poll `skill_runs` for status='queued', claim atomically,
// execute the SKILL.md via the Agent SDK, write result_md + status.
// The app never talks to this process — only to the table. Any runtime
// honoring this loop (Hermes + glue, another SDK) is a drop-in replacement.
//
// Spine (migration 0059): on every tick the worker also asks the database to
// turn unprocessed spine.events into skill_runs (spine_dispatch_events — the
// worker is the scheduler, never pg_cron, MIGRATION_READINESS rule 5). A run
// that carries identity_slug does its data reads through the spine gateway
// as that identity (the audit triple is written there) and lands its output
// in spine.proposed_actions, never in an app table.
//
// Comms (migration 0061): a chat.mention.<agent> event becomes a chat run
// (src/runtime.mjs executeChatRun). Bridges (src/bridges.mjs) run in this
// same process when the platform credentials exist; without them each
// bridge is simply off.
//
// Run: npm install && npm start   (secrets come from the host store — see
// README "Secrets"; a .env file is refused outside development).

import { createClient } from '@supabase/supabase-js';
import { assertNoPlaintextSecretFile, requireEnv } from './secrets.mjs';
import { dispatchSpineEvents } from './spine.mjs';
import { makeBridgeDb } from './comms.mjs';
import { createRuntime } from './runtime.mjs';
import { startBridges } from './bridges.mjs';

await assertNoPlaintextSecretFile();

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const HAS_MODEL = Boolean(process.env.ANTHROPIC_API_KEY); // optional: chat runs degrade to the deterministic digest
const { SKILLS_DIR = './skills', RUNTIME_NAME = 'agent-sdk-worker-v1' } = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const POLL_MS = 5000;

const runtime = createRuntime({ supabase, skillsDir: SKILLS_DIR, runtimeName: RUNTIME_NAME, hasModel: HAS_MODEL, log: console });
let bridges = null;

async function tick() {
  // 1. Spine dispatch: events -> skill_runs (the job §D/§F step two names).
  try {
    const d = await dispatchSpineEvents(supabase);
    if (d.dispatched) console.log(`[${RUNTIME_NAME}] spine dispatched ${d.dispatched} run(s), skipped ${d.skipped}`);
  } catch (err) {
    console.error(`[${RUNTIME_NAME}] spine dispatch error:`, err?.message ?? err);
  }
  // 2. Bridges: drain outbound (inbound arrives on the adapters' sockets).
  if (bridges) await bridges.drain();
  // 3. Execute one run (sequential on purpose: predictable cost and load for v1).
  await runtime.runOne();
}

console.log(`[${RUNTIME_NAME}] polling every ${POLL_MS}ms — skills dir: ${SKILLS_DIR} — model: ${HAS_MODEL ? 'on' : 'off (deterministic chat replies)'}`);
bridges = await startBridges({ db: makeBridgeDb(supabase), env: process.env, log: console });
// eslint-disable-next-line no-constant-condition
while (true) {
  try {
    await tick();
  } catch (err) {
    console.error(`[${RUNTIME_NAME}] tick error:`, err);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
