# or-skills-worker — skills runtime v1

Consumes the `skill_runs` queue (Supabase, migration `0020`) and executes
SKILL.md skills via the Claude Agent SDK. The app only ever touches the queue
through `POST/GET /api/skills/run` — this process is invisible to the UI and
therefore **swappable** (a Hermes instance + glue script honoring the same
claim/execute/write loop is a drop-in replacement).

## The contract (do not break)

1. Claim: `UPDATE skill_runs SET status='running' WHERE id=? AND status='queued'`.
2. Execute the skill named in `skill` with `context` as input.
3. Write `result_md` + `status='done'` (or `error` + `status='failed'`).

## Spine (migration 0059)

The worker is also the spine's scheduler (MIGRATION_READINESS rule 5 — jobs
run here, never in `pg_cron`). Every poll tick:

1. `spine_dispatch_events()` turns unprocessed `spine.events` rows into
   `skill_runs` rows via the `spine.event_routes` allowlist, tagged with
   `identity_slug` + `triggered_by_event_id`, `requested_by` = the identity's
   owner (that is the `sub` on the audit row).
2. A run that carries `identity_slug` reads its inputs through
   `spine_gateway_read_transcript(...)`. The database looks up the identity's
   Postgres role and runs the read inside a function *owned by that role*, so
   GRANT + RLS on the role decide what comes back and the caller cannot forge
   `act`. The audit triple (`sub`, `act`, `work_item_id`/`event_id`) is written
   in the same call.
3. The run's output lands in `spine.proposed_actions` through
   `spine_propose_action(...)` — never in an app table. Identity-tagged runs
   get no tools at all; their inputs arrived through the gateway.

`src/spine.mjs` is the whole client. `src/smoke-spine.mjs` exercises the path
end to end against the dev box's `web/.env.local` (dispatch, read as identity,
forged-identity refusal, proposal, anon refusal).

First event kind: `call_transcripts.inserted` (trigger on the table) →
`transcript-summary` as `transcript_reader`. Add kinds by inserting into
`spine.event_routes`; add identities by migration only (one line of
justification each, per the access policy).

## Setup

```bash
npm install
mkdir -p skills && cp -r <or-skills>/friday-recap-draft skills/   # transcript-summary ships in ./skills
WORKER_ENV=development npm start        # dev only — see Secrets
```

Deploy anywhere Node 20+ runs unattended (Railway/Fly ~US$5/mo, or any VM).
Vercel is NOT suitable — runs take minutes, serverless kills them.

## Secrets (spine plan §E, item 110)

**The host secret store is the only source of secrets in production.** Railway
`Variables`, Fly `secrets set`, or AWS Secrets Manager → task definition once
the worker is on ECS. The process reads them from `process.env` at start.

- `src/secrets.mjs` refuses to boot if a `.env`, `.env.local` or
  `.env.production` file exists in the working directory, unless
  `WORKER_ENV=development`. A plaintext key cannot ride along to a deploy.
- `.env.example` lists the names only. Never commit a filled copy; never paste
  a value in Slack or a ticket — hand it over through the password manager.
- Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
  `ANTHROPIC_API_KEY` is optional: without it chat runs (comms 0061) answer
  with the deterministic digest and other identity runs stay queued.
  Optional: `AIRTABLE_API_KEY` (legacy friday-recap-draft), `SKILLS_DIR`,
  `RUNTIME_NAME`. Bridges (off when absent): `SLACK_APP_TOKEN`,
  `SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`,
  `DISCORD_GUILD_ID` — see `docs/comms-phase-1.md`.
- Service role is still what the worker connects as (it must UPDATE
  `skill_runs`, which has no client policies). Reducing it to a dedicated
  worker role with a security definer claim/finish pair is the next step in
  §E move 2; everything spine-side already goes through definer functions, so
  that swap touches only `claimNextRun`/`tick`.

## Security model

- The **worker** holds all credentials (service role, Airtable). The model
  only requests tool calls; the worker executes them via MCP.
- v1 has no Bash/filesystem tools and a single MCP (Airtable). Widen
  deliberately, per skill, as skills are added to the API allowlist
  (`web/src/app/api/skills/run/route.ts`).
- One run at a time, 10-minute hard timeout.
- Hermes profiles are dispatched **to** via `skill_runs`; they never claim
  runs themselves and never hold a database credential (first month rule).
