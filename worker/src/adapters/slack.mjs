// Slack channel adapter for the Open Ronin comms bridge.
// ----------------------------------------------------
// Implements the four-verb contract in ./contract.mjs (connect, ingest, send,
// backfill). Design decisions (build brief, canonical — do not deviate):
//
// - BOT IDENTITY MINIMIZATION: exactly ONE Slack app/bot per workspace carries
//   the bridge. Agent replies are posted through that bot with the acting
//   agent named in the text (contract.formatAgentLabel), never as a separate
//   bot user. Human-authored messages post AS the person when a per-user
//   token exists (resolveUserToken(profileId), user-scope chat:write; returns
//   null today), else via the bot with username/icon_url override
//   (chat:write.customize). No additional bot identities, ever.
// - TRANSPORT: Socket Mode (manifest socket_mode_enabled: true) — no inbound
//   port/URL. connect() calls apps.connections.open with the app token, opens
//   a WebSocket, handles hello / disconnect (reconnect) / events_api and ACKS
//   every envelope with { envelope_id } within 3s.
// - LOOP GUARD: everything we post comes back through the Events API. ingest
//   skips our own posts (bot_id / user == bot user id, or a openronin_message_id
//   in metadata.event_payload that send() attaches) as { skipped:'own_echo' }.
// - RATE LIMITS / TERMS:
//   * chat.postMessage is Tier 3 (~50 req/min) and ~1 msg/sec/channel — send()
//     paces 1 msg/sec per channel and retries a 429 once (Retry-After).
//   * conversations.history is throttled for non-Marketplace apps (2025) —
//     backfill reads a workspace EXPORT, never the history API.
//   * Slack read-only date for this workspace: Dec 31 2026.
//
// Env (process.env only — host secret store, never a .env in prod):
//   SLACK_APP_TOKEN      xapp-... Socket Mode app-level token (connect)
//   SLACK_BOT_TOKEN      xoxb-... bot token (send, auth.test)
//   SLACK_SIGNING_SECRET HTTP-mode events route only (verifySlackSignature)
//   SLACK_BOT_USER_ID    optional; else auth.test at connect() fills it in
//
// Nothing here imports supabase: `db` is injected (RPC wrappers), as are
// fetch and the WebSocket factory, so tests run entirely against fakes.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertAdapter, formatAgentLabel } from './contract.mjs';

export const provider = 'slack';
export const requiredEnv = ['SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN'];
export const optionalEnv = ['SLACK_SIGNING_SECRET', 'SLACK_BOT_USER_ID'];

const SLACK_API = 'https://slack.com/api/';
const ACK_DEADLINE_MS = 3000;
const CHANNEL_PACE_MS = 1000;
const HANDLED_EVENTS = new Set(['message', 'message.channels', 'message.groups', 'message.im', 'message.mpim']);

// ------------------------------------------------------------- http ----
/** POST JSON to https://slack.com/api/<method>. Throws on ok:false. Retries a
 *  429 exactly once after Retry-After seconds. `fetchImpl` is injectable. */
export async function slackApi(method, body, token, fetchImpl = globalThis.fetch, { retried = false, sleep = defaultSleep } = {}) {
  if (!token) throw new Error(`slackApi ${method}: missing token`);
  const res = await fetchImpl(SLACK_API + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 429 && !retried) {
    const wait = Number(res.headers?.get?.('retry-after') ?? 1) || 1;
    await sleep(wait * 1000);
    return slackApi(method, body, token, fetchImpl, { retried: true, sleep });
  }
  const json = await res.json();
  if (!json || json.ok === false) throw new Error(`slack ${method}: ${json?.error ?? `http ${res.status}`}`);
  return json;
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// -------------------------------------------------------- signature ----
/** Slack HMAC v0 request signature (HTTP events mode only). Constant-time. */
export function verifySlackSignature({ signingSecret, timestamp, body, signature, now = Date.now(), maxSkewSec = 300 }) {
  if (!signingSecret || !timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > maxSkewSec) return false;
  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------- formatting ----
/** Slack mrkdwn -> markdown. `users` maps U123 -> handle. */
export function mrkdwnToMarkdown(text, users = {}) {
  if (!text) return '';
  return String(text)
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${users[id] ?? id}`)
    .replace(/<#([CG][A-Z0-9]+)\|([^>]*)>/g, (_, _id, name) => `#${name}`)
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, (_, url, label) => `[${label}](${url})`)
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, '$1**$2**')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** markdown -> Slack mrkdwn. `handles` maps @handle -> U123 (optional). */
export function markdownToMrkdwn(text, handles = {}) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[([^\]]+)\]\(((?:https?|mailto):[^)\s]+)\)/g, (_, label, url) => `<${url}|${label}>`)
    .replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
    .replace(/(^|[^\w])@([\w.-]+)/g, (m, pre, handle) => (handles[handle] ? `${pre}<@${handles[handle]}>` : m));
}

export function tsToIso(ts) {
  const ms = Math.round(Number(ts) * 1000);
  return new Date(ms).toISOString();
}

// ----------------------------------------------------------- adapter ----
/**
 * @param {object} opts
 * @param {object} opts.db                 injected RPC wrappers (see contract header)
 * @param {object} [opts.env]              defaults to process.env
 * @param {Function} [opts.fetchImpl]      defaults to global fetch
 * @param {Function} [opts.wsFactory]      (url) => WebSocket-like; defaults to global WebSocket
 * @param {Function} [opts.resolveUserToken] (profileId) => token|null; null today
 * @param {object} [opts.users]            U123 -> handle map for mention conversion
 * @param {Function} [opts.log]
 */
export function createSlackAdapter({
  db,
  env = process.env,
  fetchImpl = globalThis.fetch,
  wsFactory = (url) => new globalThis.WebSocket(url),
  resolveUserToken = async () => null,
  users = {},
  log = console,
  sleep = defaultSleep,
  now = () => Date.now(),
} = {}) {
  if (!db) throw new Error('createSlackAdapter: db is required');
  const state = { botUserId: env.SLACK_BOT_USER_ID ?? null, teamId: null, socket: null, closed: false };
  const lastPostAt = new Map(); // channel -> ms of last post (1 msg/sec pacing)

  const api = (method, body, token = env.SLACK_BOT_TOKEN) => slackApi(method, body, token, fetchImpl, { sleep });

  // ------------------------------------------------------------ ingest --
  async function ingest(event) {
    const ev = event?.event ?? event; // accept an Events API outer payload or the inner event
    if (!ev || !HANDLED_EVENTS.has(ev.type)) return { skipped: true, reason: `unhandled_type:${ev?.type ?? 'none'}` };

    const subtype = ev.subtype ?? null;
    if (subtype === 'message_changed' || subtype === 'message_deleted') return { skipped: true, reason: subtype };
    if (isOwnEcho(ev)) return { skipped: 'own_echo', reason: 'own_echo' };
    if (subtype === 'bot_message' && !ev.user) return { skipped: true, reason: 'bot_message' };
    if (subtype && subtype !== 'file_share' && subtype !== 'thread_broadcast') return { skipped: true, reason: `subtype:${subtype}` };
    if (!ev.channel || !ev.ts) return { skipped: true, reason: 'missing_channel_or_ts' };

    const record = {
      provider,
      external_ref: ev.channel,
      provider_message_id: ev.ts,
      provider_thread_id: ev.thread_ts && ev.thread_ts !== ev.ts ? ev.thread_ts : null,
      sender_handle: ev.user ?? ev.bot_id ?? null,
      sender_display: ev.user_profile?.display_name || ev.user_profile?.real_name || ev.username || users[ev.user] || ev.user || null,
      body: mrkdwnToMarkdown(ev.text ?? '', users),
      sent_at: tsToIso(ev.ts),
      attachments: (ev.files ?? []).map((f) => ({ name: f.name ?? f.title ?? null, mime: f.mimetype ?? null, size: f.size ?? null, url_private: f.url_private ?? null })),
      payload: { subtype, team: ev.team ?? event?.team_id ?? state.teamId ?? null, channel_type: ev.channel_type ?? null },
    };
    return db.ingestBridgeMessage(record);
  }

  function isOwnEcho(ev) {
    if (ev.metadata?.event_type === 'openronin_message' && ev.metadata?.event_payload?.message_id) return true;
    if (state.botUserId && (ev.user === state.botUserId || ev.bot_profile?.user_id === state.botUserId)) return true;
    if (state.botId && ev.bot_id === state.botId) return true;
    return false;
  }

  // -------------------------------------------------------------- send --
  async function send({ limit = 50 } = {}) {
    const rows = (await db.outboundForProvider(provider, limit)) ?? [];
    const results = [];
    for (const row of rows) {
      try {
        const ts = await postOutbound(row);
        await db.markBridged(row.message_id, provider, ts, null);
        results.push({ message_id: row.message_id, ts });
      } catch (err) {
        const error = String(err?.message ?? err);
        await db.markBridged(row.message_id, provider, null, error);
        results.push({ message_id: row.message_id, error });
        log.error?.(`[slack] send ${row.message_id} failed: ${error}`);
      }
    }
    return results;
  }

  async function postOutbound(row) {
    await pace(row.external_ref);
    const isAgent = row.sender_type === 'agent';
    const bodyMd = isAgent ? formatAgentLabel({ agentName: row.sender_name ?? row.sender_agent_slug, body: row.body }) : row.body;
    const payload = {
      channel: row.external_ref,
      text: markdownToMrkdwn(bodyMd),
      unfurl_links: false,
      metadata: { event_type: 'openronin_message', event_payload: { message_id: row.message_id } },
    };
    if (row.in_reply_to_external_id) payload.thread_ts = row.in_reply_to_external_id;

    let token = env.SLACK_BOT_TOKEN;
    if (!isAgent) {
      const userToken = row.sender_profile_id ? await resolveUserToken(row.sender_profile_id) : null;
      if (userToken) token = userToken; // posts AS the person
      else if (row.sender_name) {
        payload.username = row.sender_name; // bot + customize override, still ONE bot
        if (row.sender_icon_url) payload.icon_url = row.sender_icon_url;
      }
    }
    const res = await api('chat.postMessage', payload, token);
    return res.ts;
  }

  async function pace(channel) {
    if (lastPostAt.has(channel)) {
      const wait = lastPostAt.get(channel) + CHANNEL_PACE_MS - now();
      if (wait > 0) await sleep(wait);
    }
    lastPostAt.set(channel, now());
  }

  // ----------------------------------------------------------- connect --
  /** Open Socket Mode. Resolves once `hello` arrives. Returns { close }. */
  async function connect({ onEvent = ingest, reconnectDelayMs = 1000 } = {}) {
    if (!env.SLACK_APP_TOKEN) throw new Error('Missing required secret SLACK_APP_TOKEN');
    if (!state.botUserId) {
      const who = await api('auth.test', {});
      state.botUserId = who.user_id;
      state.botId = who.bot_id ?? null;
      state.teamId = who.team_id ?? null;
      await db.upsertConnection?.({ provider, scope: 'workspace', external_account_id: who.team_id, display_name: who.team ?? who.url ?? null, status: 'connected', health: 'ok' });
    }
    state.closed = false;
    await openSocket({ onEvent, reconnectDelayMs });
    return {
      close() {
        state.closed = true;
        state.socket?.close?.();
      },
      get botUserId() { return state.botUserId; },
    };
  }

  async function openSocket({ onEvent, reconnectDelayMs }) {
    const opened = await api('apps.connections.open', {}, env.SLACK_APP_TOKEN);
    const ws = wsFactory(opened.url);
    state.socket = ws;
    return new Promise((resolve, reject) => {
      let helloed = false;
      ws.addEventListener('error', (e) => { if (!helloed) reject(new Error(`socket error: ${e?.message ?? 'unknown'}`)); });
      ws.addEventListener('close', () => {
        if (state.closed) return;
        log.warn?.('[slack] socket closed, reconnecting');
        sleep(reconnectDelayMs).then(() => openSocket({ onEvent, reconnectDelayMs })).catch((err) => log.error?.(`[slack] reconnect failed: ${err.message}`));
      });
      ws.addEventListener('message', (m) => {
        let msg;
        try { msg = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)); } catch { return; }
        if (msg.type === 'hello') { helloed = true; resolve(); return; }
        if (msg.type === 'disconnect') { log.warn?.(`[slack] disconnect requested: ${msg.reason}`); ws.close?.(); return; }
        if (msg.envelope_id) {
          // Ack first (3s deadline), then route — a slow db must never cause a redelivery storm.
          ws.send(JSON.stringify({ envelope_id: msg.envelope_id }));
          if (msg.type === 'events_api') {
            Promise.resolve(onEvent(msg.payload)).catch((err) => log.error?.(`[slack] ingest failed: ${err.message}`));
          }
        }
      });
    });
  }

  // ---------------------------------------------------------- backfill --
  /** Parse a Slack workspace export. `reader` is fs-like: { readdir(dir) -> [names], readFile(path) -> string }.
   *  Only channels present in db.linksForProvider('slack') are ingested. */
  async function backfill(exportDir, { reader, months = 12, sinceMs = null } = {}) {
    if (!reader) throw new Error('backfill: reader { readdir, readFile } is required');
    const join = (...p) => p.join('/');
    const readJson = async (p) => JSON.parse(await reader.readFile(p));
    const cutoffMs = sinceMs ?? now() - months * 30 * 24 * 3600 * 1000;

    const usersJson = await readJson(join(exportDir, 'users.json')).catch(() => []);
    const identities = await mapUsersToProfiles(usersJson, db);
    const nameOf = Object.fromEntries(usersJson.map((u) => [u.id, u.profile?.display_name || u.name || u.real_name || u.id]));

    const channelsJson = await readJson(join(exportDir, 'channels.json')).catch(() => []);
    const links = (await db.linksForProvider(provider)) ?? [];
    const byRef = new Map(links.map((l) => [l.external_ref, l]));
    const byName = new Map(links.map((l) => [l.external_name, l]));

    const summary = { users_mapped: identities.length, channels: [], ingested: 0, skipped: 0 };
    for (const ch of channelsJson) {
      const link = byRef.get(ch.id) ?? byName.get(ch.name);
      if (!link || link.status === 'disabled') continue;
      const dir = join(exportDir, ch.name);
      const days = (await reader.readdir(dir).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      // Cursor keeps the raw Slack ts string (it is the provider_message_id);
      // comparisons are numeric.
      const lastTs = link.cursor?.backfill_last_ts ?? null;
      const lastNum = Number(lastTs ?? 0);
      let count = 0;
      let newest = lastTs;
      for (const day of days) {
        if (Date.parse(day.slice(0, 10)) + 24 * 3600 * 1000 < cutoffMs) continue;
        const msgs = (await readJson(join(dir, day))).filter((m) => m.ts).sort((a, b) => Number(a.ts) - Number(b.ts));
        for (const m of msgs) {
          const tsNum = Number(m.ts);
          if (tsNum * 1000 < cutoffMs || tsNum <= lastNum) continue;
          const res = await ingest({ ...m, type: 'message', channel: ch.id, user_profile: m.user_profile ?? (m.user ? { display_name: nameOf[m.user] } : undefined) });
          if (res?.skipped) summary.skipped++; else { count++; summary.ingested++; }
          if (tsNum > Number(newest ?? 0)) newest = m.ts;
        }
        if (newest !== lastTs) await db.setLinkCursor(link.id, { backfill_last_ts: newest });
      }
      summary.channels.push({ channel: ch.name, link_id: link.id, ingested: count });
    }
    return summary;
  }

  const adapter = { provider, connect, ingest, send, backfill, state };
  assertAdapter(adapter);
  return adapter;
}

/** users.json -> profile identities via db.profileIdForEmail; returns the mapped list. */
export async function mapUsersToProfiles(usersJson, db) {
  const mapped = [];
  for (const u of usersJson ?? []) {
    if (u.deleted || u.is_bot || !u.profile?.email) continue;
    const profileId = await db.profileIdForEmail(u.profile.email);
    if (!profileId) continue;
    const identity = { provider, handle: u.id, profile_id: profileId, display: u.profile.display_name || u.real_name || u.name, source: 'slack_export_email', confidence: 1 };
    await db.upsertProfileIdentity(identity);
    mapped.push(identity);
  }
  return mapped;
}
