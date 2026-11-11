// Bridge supervisor: runs whichever channel adapters have credentials.
//
// One bot per platform (bot identity minimization). A platform whose env
// vars are absent is simply off — the worker logs one line and moves on, so
// the same binary runs before and after the Slack app / Discord bot exist.
// Inbound arrives on each adapter's socket and lands through
// db.ingestBridgeMessage; outbound is drained on every worker tick through
// send(). Backfill is a one-shot job (`node src/bridges.mjs backfill slack
// <exportDir>`), never a loop, per the brief's "bounded and resumable".

import { createSlackAdapter } from './adapters/slack.mjs';
import { createDiscordAdapter } from './adapters/discord.mjs';

function hasAll(env, names) {
  return names.every((n) => Boolean(env[n]));
}

export async function startBridges({ db, env = process.env, log = console } = {}) {
  const active = [];

  const slackEnv = ['SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN'];
  if (hasAll(env, slackEnv)) {
    const slack = createSlackAdapter({ db, env, log });
    try {
      const handle = await slack.connect();
      active.push({ provider: 'slack', adapter: slack, handle });
      log.log?.(`[bridges] slack connected (bot user ${handle.botUserId})`);
    } catch (err) {
      log.error?.(`[bridges] slack connect failed: ${err?.message ?? err}`);
    }
  } else {
    log.log?.(`[bridges] slack off (needs ${slackEnv.join(', ')})`);
  }

  const discordEnv = ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID'];
  if (hasAll(env, discordEnv)) {
    const discord = createDiscordAdapter({ db, env, log });
    try {
      const handle = await discord.connect();
      active.push({ provider: 'discord', adapter: discord, handle });
      log.log?.('[bridges] discord connected');
    } catch (err) {
      log.error?.(`[bridges] discord connect failed: ${err?.message ?? err}`);
    }
  } else {
    log.log?.(`[bridges] discord off (needs ${discordEnv.join(', ')})`);
  }

  return {
    providers: active.map((a) => a.provider),
    async drain() {
      for (const { provider, adapter } of active) {
        try {
          const results = await adapter.send({ limit: 50 });
          const n = Array.isArray(results) ? results.length : 0;
          if (n) log.log?.(`[bridges] ${provider} sent ${n}`);
        } catch (err) {
          log.error?.(`[bridges] ${provider} send error: ${err?.message ?? err}`);
        }
      }
    },
    async close() {
      for (const { handle } of active) await handle?.close?.();
    },
  };
}

// One-shot backfill entry point:
//   node src/bridges.mjs backfill slack <exportDir>   (workspace export, last 12 months)
//   node src/bridges.mjs backfill discord             (Gateway history, last 6 months)
if (process.argv[1] && process.argv[1].endsWith('bridges.mjs') && process.argv[2] === 'backfill') {
  const [, , , provider, exportDir] = process.argv;
  const { createClient } = await import('@supabase/supabase-js');
  const { makeBridgeDb } = await import('./comms.mjs');
  const { requireEnv } = await import('./secrets.mjs');
  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const db = makeBridgeDb(supabase);
  if (provider === 'slack') {
    if (!exportDir) throw new Error('usage: backfill slack <exportDir>');
    const fs = await import('node:fs/promises');
    const slack = createSlackAdapter({ db, env: process.env });
    const summary = await slack.backfill(exportDir, { reader: { readdir: (d) => fs.readdir(d), readFile: (p) => fs.readFile(p, 'utf8') }, months: 12 });
    console.log(JSON.stringify(summary, null, 2));
  } else if (provider === 'discord') {
    const discord = createDiscordAdapter({ db, env: process.env });
    const summary = await discord.backfill({ months: 6 });
    console.log(JSON.stringify(summary, null, 2));
  } else {
    throw new Error('usage: backfill slack <exportDir> | backfill discord');
  }
}
