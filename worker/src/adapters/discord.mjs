// Discord channel adapter for the Open Ronin bridge worker.
// ---------------------------------------------------------------------------
// Verbs: connect (Gateway WebSocket), ingest (MESSAGE_CREATE -> comms record),
// send (drain outbound through per-channel webhooks), backfill (bounded history).
//
// BOT IDENTITY MINIMIZATION: exactly ONE Discord bot for the whole platform.
//   - Human-authored Open Ronin messages go out through a per-channel WEBHOOK the
//     bot creates once (POST /channels/{id}/webhooks; {webhook_id, webhook_token}
//     kept in the link cursor) with `username` = the person's name + avatar_url,
//     because Discord forbids automating a user's own account.
//   - Agent replies go through the SAME webhook as username 'Open Ronin' with the
//     acting agent named in the content (formatAgentLabel). Never a second bot.
//   - Fallback when no webhook can be made: bot POST /channels/{id}/messages with
//     the name in the text.
//
// Rate limits / terms (one line each):
//   - Global: 50 requests/second per bot token.
//   - Per-route buckets advertised via X-RateLimit-* headers; 429 -> retry_after.
//   - Webhooks: ~5 executions/second/channel (30/min/webhook); we pace at 4/s.
//   - MESSAGE_CONTENT is a privileged intent: a toggle under 100 guilds.
//   - Backfill: GET /channels/{id}/messages?before=&limit=100, bounded to the
//     last 6 months per the brief.
//
// Env (process.env only, injected by the host secret store — see secrets.mjs):
//   DISCORD_BOT_TOKEN        Bot -> Reset Token
//   DISCORD_APPLICATION_ID   General Information (also the bot user id)
//   DISCORD_GUILD_ID         the Beacon dev server
//
// Everything with a side effect is injectable (db, fetch, WebSocket, timers,
// sleep, mention resolver) so the unit tests never touch discord.com.

// --- contract helpers (sibling file; fall back to inline copies when absent) --
let contract = null;
try {
  contract = await import('./contract.mjs');
} catch (err) {
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}
const assertAdapter = contract?.assertAdapter ?? (() => true);
const formatAgentLabel =
  contract?.formatAgentLabel ?? (({ agentName, body }) => `**${agentName}** (Open Ronin agent)\n${body ?? ''}`);
const chunkText =
  contract?.chunkText ??
  ((body, max) => {
    const text = String(body ?? '');
    if (text.length <= max) return [text];
    const out = [];
    let rest = text;
    while (rest.length > max) {
      let cut = rest.lastIndexOf('\n', max);
      if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, '');
    }
    if (rest) out.push(rest);
    return out;
  });

// ------------------------------------------------------------ constants ----
export const API_BASE = 'https://discord.com/api/v10';
export const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
export const DISCORD_MAX_CONTENT = 2000;
export const DISCORD_EPOCH_MS = 1420070400000;
export const requiredEnv = ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID'];

export const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};
export const INTENT_MASK = INTENTS.GUILDS | INTENTS.GUILD_MEMBERS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT;

export const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 };

// Close codes after which Discord says: do not reconnect.
const FATAL_CLOSE = {
  4004: 'Authentication failed: DISCORD_BOT_TOKEN is wrong or was reset.',
  4010: 'Invalid shard.',
  4011: 'Sharding required (guild count too high for one connection).',
  4012: 'Invalid gateway API version.',
  4013: 'Invalid intents value.',
  4014: 'Disallowed intents: enable "Message Content Intent" and "Server Members Intent" under Bot -> Privileged Gateway Intents in the developer portal (docs/phase0-human-prep/discord-bot-setup.md §2).',
};
// Close codes after which a RESUME is impossible; re-IDENTIFY instead.
const NO_RESUME_CLOSE = new Set([1000, 1001, 4007, 4009]);

const MESSAGE_PACE_MS = 250; // 4 msgs/sec/channel
const CHANNEL_TYPE_THREAD = new Set([10, 11, 12]); // announcement/public/private thread

// --------------------------------------------------------------- utils ----
export function snowflakeToDate(id) {
  return new Date(Number((BigInt(id) >> 22n) + BigInt(DISCORD_EPOCH_MS)));
}

export function dateToSnowflake(date) {
  const ms = BigInt(new Date(date).getTime() - DISCORD_EPOCH_MS);
  return (ms << 22n).toString();
}

export class DiscordApiError extends Error {
  constructor(status, method, path, body) {
    super(`Discord API ${method} ${path} -> ${status}${body?.message ? `: ${body.message}` : ''}`);
    this.name = 'DiscordApiError';
    this.status = status;
    this.body = body;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal REST helper: Bot auth header, JSON bodies, one retry on 429. */
export async function discordApi(method, path, body, token, fetchImpl = globalThis.fetch, { sleep = defaultSleep, retried = false } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = { 'User-Agent': 'DiscordBot (https://app.example.com, 0.1)' };
  if (token) headers.Authorization = `Bot ${token}`;
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(url, { method, headers, body: body === undefined || body === null ? undefined : JSON.stringify(body) });

  let json = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text };
      }
    }
  }

  if (res.status === 429 && !retried) {
    const retryAfterS = Number(json?.retry_after ?? res.headers?.get?.('retry-after') ?? 1);
    await sleep(Math.max(0, retryAfterS * 1000));
    return discordApi(method, path, body, token, fetchImpl, { sleep, retried: true });
  }
  if (!res.ok) throw new DiscordApiError(res.status, method, path, json);
  return json;
}

function cursorOf(link) {
  const c = link?.cursor;
  if (!c) return {};
  if (typeof c === 'string') {
    try {
      return JSON.parse(c);
    } catch {
      return {};
    }
  }
  return { ...c };
}

// ----------------------------------------------------------- factory ----
export function createDiscordAdapter({
  db = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  timers = { setInterval, clearInterval, setTimeout, clearTimeout },
  sleep = defaultSleep,
  resolveMention = null, // (kind: 'user'|'channel'|'role', id) => string | null | Promise<...>
  now = () => Date.now(),
  log = console,
} = {}) {
  const need = (name) => {
    const v = env[name];
    if (!v) throw new Error(`Missing required secret ${name} (inject it from the host secret store).`);
    return v;
  };

  // Adapter state shared by the verbs.
  const state = {
    botUserId: env.DISCORD_APPLICATION_ID ?? null,
    sessionId: null,
    resumeGatewayUrl: null,
    seq: null,
    webhookIds: new Set(), // webhooks WE created (from link cursors) -> echo detection
    linksById: new Map(),
    linksByRef: new Map(),
    threads: new Map(), // thread channel id -> parent channel id
    channelNames: new Map(),
    lastPostAt: new Map(), // channel id -> ms
    lastError: null,
  };

  function useDb() {
    if (!db) throw new Error('discord adapter: no db injected');
    return db;
  }

  async function refreshLinks() {
    const links = (await useDb().linksForProvider('discord')) ?? [];
    state.linksById.clear();
    state.linksByRef.clear();
    state.webhookIds.clear();
    for (const link of links) {
      state.linksById.set(link.id, link);
      state.linksByRef.set(String(link.external_ref), link);
      const c = cursorOf(link);
      if (c.webhook_id) state.webhookIds.add(String(c.webhook_id));
    }
    return links;
  }

  // ------------------------------------------------------------ ingest ----
  async function renderBody(msg) {
    let body = msg.content ?? '';
    const mentionedUsers = new Map((msg.mentions ?? []).map((u) => [String(u.id), u]));
    const mentionedChannels = new Map((msg.mention_channels ?? []).map((c) => [String(c.id), c]));

    const replacements = [];
    for (const m of body.matchAll(/<(@!?|#|@&)(\d+)>/g)) {
      const [full, sigil, id] = m;
      let kind = 'user';
      if (sigil === '#') kind = 'channel';
      else if (sigil === '@&') kind = 'role';
      let name = null;
      if (kind === 'user') {
        const u = mentionedUsers.get(id);
        name = u?.global_name ?? u?.username ?? null;
      } else if (kind === 'channel') {
        name = mentionedChannels.get(id)?.name ?? state.channelNames.get(id) ?? null;
      }
      if (!name && resolveMention) name = await resolveMention(kind, id);
      const prefix = kind === 'channel' ? '#' : '@';
      replacements.push([full, `${prefix}${name ?? id}`]);
    }
    for (const [full, text] of replacements) body = body.split(full).join(text);
    return body;
  }

  /** Normalize a MESSAGE_CREATE payload and hand it to db.ingestBridgeMessage. */
  async function ingest(msg) {
    if (!msg || !msg.id || !msg.channel_id) return { skipped: 'malformed' };
    const author = msg.author ?? {};
    const isBot = author.bot === true;
    const webhookId = msg.webhook_id ? String(msg.webhook_id) : null;

    // LOOP GUARD: our own bot user, or a webhook we created, is an echo.
    if (isBot && ((state.botUserId && String(author.id) === String(state.botUserId)) || (webhookId && state.webhookIds.has(webhookId)))) {
      return { skipped: 'own_echo' };
    }

    const channelId = String(msg.channel_id);
    const parentChannelId = state.threads.get(channelId) ?? null;

    const record = {
      provider: 'discord',
      // Links are keyed by channel; a thread message resolves to its parent's link.
      external_ref: parentChannelId ?? channelId,
      provider_message_id: String(msg.id),
      provider_thread_id: msg.message_reference?.message_id ? String(msg.message_reference.message_id) : null,
      sender_handle: author.id ? String(author.id) : null,
      sender_display: msg.member?.nick ?? author.global_name ?? author.username ?? null,
      body: await renderBody(msg),
      sent_at: msg.timestamp ?? snowflakeToDate(msg.id).toISOString(),
      attachments: (msg.attachments ?? []).map((a) => ({
        name: a.filename,
        mime: a.content_type ?? null,
        size: a.size ?? null,
        url: a.url,
      })),
      payload: {
        guild_id: msg.guild_id ?? null,
        channel_id: channelId,
        parent_channel_id: parentChannelId,
        webhook_id: webhookId,
        raw_type: msg.type ?? 0,
        is_bot: isBot,
      },
    };
    const result = await useDb().ingestBridgeMessage(record);
    return { ...(result ?? {}), record };
  }

  // ----------------------------------------------------------- gateway ----
  function rememberChannel(ch) {
    if (!ch?.id) return;
    state.channelNames.set(String(ch.id), ch.name);
    if (CHANNEL_TYPE_THREAD.has(ch.type) && ch.parent_id) state.threads.set(String(ch.id), String(ch.parent_id));
  }

  /**
   * Open the Gateway connection. Returns a handle {state, close, socket()}.
   * Errors after the handshake are reported through onError/state.lastError
   * (a fatal close such as 4014 stops reconnecting).
   */
  function connect({ onEvent = null, onError = null, gatewayUrl = GATEWAY_URL } = {}) {
    const token = need('DISCORD_BOT_TOKEN');
    if (!WebSocketImpl) throw new Error('discord adapter: no WebSocket implementation available');

    let ws = null;
    let heartbeat = null;
    let heartbeatIntervalMs = null;
    let lastAck = 0;
    let lastBeat = 0;
    let closed = false;
    let reconnectTimer = null;

    const sendPacket = (op, d) => ws?.send(JSON.stringify({ op, d }));
    const fail = (err) => {
      state.lastError = err;
      log?.error?.(`[discord] ${err.message}`);
      onError?.(err);
    };

    const stopHeartbeat = () => {
      if (heartbeat) timers.clearInterval(heartbeat);
      heartbeat = null;
    };

    const scheduleReconnect = (resume, delayMs) => {
      if (closed) return;
      const url = resume && state.resumeGatewayUrl ? `${state.resumeGatewayUrl}/?v=10&encoding=json` : gatewayUrl;
      reconnectTimer = timers.setTimeout(() => open(url, resume && !!state.sessionId), delayMs);
    };

    const identify = () =>
      sendPacket(OP.IDENTIFY, {
        token,
        intents: INTENT_MASK,
        properties: { os: process.platform, browser: 'openronin-bridge', device: 'openronin-bridge' },
      });
    const resume = () => sendPacket(OP.RESUME, { token, session_id: state.sessionId, seq: state.seq });

    const handleDispatch = async (t, d) => {
      switch (t) {
        case 'READY':
          state.sessionId = d.session_id;
          state.resumeGatewayUrl = d.resume_gateway_url ?? null;
          if (d.user?.id) state.botUserId = String(d.user.id);
          break;
        case 'RESUMED':
          break;
        case 'GUILD_CREATE':
          for (const ch of d.channels ?? []) rememberChannel(ch);
          for (const th of d.threads ?? []) rememberChannel(th);
          if (db?.upsertConnection && (!env.DISCORD_GUILD_ID || String(d.id) === String(env.DISCORD_GUILD_ID))) {
            await db.upsertConnection({
              provider: 'discord',
              scope: 'guild',
              external_account_id: String(d.id),
              display_name: d.name ?? null,
              status: 'connected',
              health: { session_id: state.sessionId, connected_at: new Date(now()).toISOString(), channels: (d.channels ?? []).length },
            });
          }
          break;
        case 'CHANNEL_CREATE':
        case 'CHANNEL_UPDATE':
        case 'THREAD_CREATE':
        case 'THREAD_UPDATE':
          rememberChannel(d);
          break;
        case 'MESSAGE_CREATE':
          await ingest(d);
          break;
        default:
          break;
      }
      await onEvent?.(t, d);
    };

    const handlePacket = async (packet) => {
      const { op, d, s, t } = packet;
      if (s !== null && s !== undefined) state.seq = s;
      switch (op) {
        case OP.HELLO: {
          heartbeatIntervalMs = d.heartbeat_interval;
          stopHeartbeat();
          lastAck = now();
          heartbeat = timers.setInterval(() => {
            if (lastBeat > lastAck) {
              // Zombie connection: no ack since the last beat. Close and resume.
              ws?.close(4000, 'heartbeat ack missed');
              return;
            }
            lastBeat = now();
            sendPacket(OP.HEARTBEAT, state.seq);
          }, heartbeatIntervalMs);
          if (state.sessionId && state.resumeGatewayUrl && ws.__resume) resume();
          else identify();
          break;
        }
        case OP.HEARTBEAT_ACK:
          lastAck = now();
          break;
        case OP.HEARTBEAT:
          lastBeat = now();
          sendPacket(OP.HEARTBEAT, state.seq);
          break;
        case OP.RECONNECT:
          ws?.close(4000, 'reconnect requested');
          break;
        case OP.INVALID_SESSION:
          if (d === true) {
            ws?.close(4000, 'invalid session (resumable)');
          } else {
            state.sessionId = null;
            state.resumeGatewayUrl = null;
            ws?.close(4000, 'invalid session');
          }
          break;
        case OP.DISPATCH:
          await handleDispatch(t, d);
          break;
        default:
          break;
      }
    };

    const open = (url, asResume) => {
      ws = new WebSocketImpl(url);
      ws.__resume = asResume;
      ws.addEventListener('message', (ev) => {
        let packet;
        try {
          packet = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        } catch (err) {
          fail(new Error(`gateway sent unparseable frame: ${err.message}`));
          return;
        }
        handlePacket(packet).catch((err) => fail(err));
      });
      ws.addEventListener('error', (ev) => log?.warn?.(`[discord] gateway socket error: ${ev?.message ?? ev?.error?.message ?? 'unknown'}`));
      ws.addEventListener('close', (ev) => {
        stopHeartbeat();
        const code = ev?.code ?? 1006;
        if (closed) return;
        if (FATAL_CLOSE[code]) {
          fail(new Error(`gateway closed ${code}: ${FATAL_CLOSE[code]}`));
          return;
        }
        const canResume = !!state.sessionId && !NO_RESUME_CLOSE.has(code);
        scheduleReconnect(canResume, 1000 + Math.floor(Math.random() * 4000));
      });
    };

    open(gatewayUrl, false);

    return {
      state,
      socket: () => ws,
      heartbeatIntervalMs: () => heartbeatIntervalMs,
      close() {
        closed = true;
        stopHeartbeat();
        if (reconnectTimer) timers.clearTimeout(reconnectTimer);
        ws?.close(1000, 'shutdown');
      },
    };
  }

  // -------------------------------------------------------------- send ----
  async function ensureWebhook(link) {
    const cursor = cursorOf(link);
    if (cursor.webhook_id && cursor.webhook_token) return { id: String(cursor.webhook_id), token: cursor.webhook_token, cursor };
    const token = need('DISCORD_BOT_TOKEN');
    const hook = await discordApi('POST', `/channels/${link.external_ref}/webhooks`, { name: 'Open Ronin' }, token, fetchImpl, { sleep });
    const next = { ...cursor, webhook_id: String(hook.id), webhook_token: hook.token };
    await useDb().setLinkCursor(link.id, next);
    link.cursor = next;
    state.webhookIds.add(String(hook.id));
    return { id: String(hook.id), token: hook.token, cursor: next };
  }

  async function pace(channelId) {
    const last = state.lastPostAt.get(channelId) ?? 0;
    const wait = last + MESSAGE_PACE_MS - now();
    if (wait > 0) await sleep(wait);
    state.lastPostAt.set(channelId, now());
  }

  function composeOutbound(row, link) {
    const isAgent = row.sender_type === 'agent';
    const name = row.sender_name ?? row.sender_agent_slug ?? row.sender_handle ?? 'Open Ronin';
    let body = row.body ?? '';
    for (const a of row.attachments ?? []) if (a?.url) body += `\n${a.url}`;
    if (row.in_reply_to_external_id) {
      const guild = env.DISCORD_GUILD_ID;
      const ref = guild ? `https://discord.com/channels/${guild}/${row.external_ref ?? link.external_ref}/${row.in_reply_to_external_id}` : row.in_reply_to_external_id;
      body = `> replying to ${ref}\n${body}`;
    }
    return {
      isAgent,
      name,
      content: isAgent ? formatAgentLabel({ agentName: name, body }) : body,
      username: isAgent ? 'Open Ronin' : name,
      avatar_url: row.sender_avatar_url ?? null,
    };
  }

  /** Drain db.outboundForProvider('discord'); returns {sent, failed}. */
  async function send({ limit = 50 } = {}) {
    const database = useDb();
    await refreshLinks();
    const rows = (await database.outboundForProvider('discord', limit)) ?? [];
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const link = state.linksById.get(row.link_id) ?? state.linksByRef.get(String(row.external_ref));
      try {
        if (!link) throw new Error(`no discord link for message ${row.message_id} (link ${row.link_id}, ref ${row.external_ref})`);
        if (link.sync_mode === 'read') throw new Error(`link ${link.id} is read-only (sync_mode=read)`);

        const channelId = String(link.external_ref);
        // A row whose external_ref differs from its link's channel targets a thread inside it.
        const threadId = row.thread_id ?? (row.external_ref && String(row.external_ref) !== channelId ? String(row.external_ref) : null);
        const composed = composeOutbound(row, link);
        const chunks = chunkText(composed.content, DISCORD_MAX_CONTENT);

        let firstId = null;
        let hook = null;
        try {
          hook = await ensureWebhook(link);
        } catch (err) {
          log?.warn?.(`[discord] webhook unavailable for channel ${channelId}, falling back to bot post: ${err.message}`);
        }

        for (const chunk of chunks) {
          await pace(channelId);
          let posted;
          if (hook) {
            const qs = new URLSearchParams({ wait: 'true' });
            if (threadId) qs.set('thread_id', threadId);
            posted = await discordApi(
              'POST',
              `/webhooks/${hook.id}/${hook.token}?${qs}`,
              { content: chunk, username: composed.username, avatar_url: composed.avatar_url ?? undefined, allowed_mentions: { parse: [] } },
              null,
              fetchImpl,
              { sleep },
            );
          } else {
            const body = {
              content: composed.isAgent ? chunk : `**${composed.name}**: ${chunk}`,
              allowed_mentions: { parse: [] },
            };
            if (row.in_reply_to_external_id && firstId === null) body.message_reference = { message_id: String(row.in_reply_to_external_id), fail_if_not_exists: false };
            posted = await discordApi('POST', `/channels/${threadId ?? channelId}/messages`, body, need('DISCORD_BOT_TOKEN'), fetchImpl, { sleep });
          }
          if (firstId === null) firstId = posted?.id ? String(posted.id) : null;
        }
        await database.markBridged(row.message_id, 'discord', firstId, null);
        sent += 1;
      } catch (err) {
        failed += 1;
        log?.error?.(`[discord] send failed for ${row.message_id}: ${err.message}`);
        await database.markBridged(row.message_id, 'discord', null, String(err?.message ?? err));
      }
    }
    return { sent, failed };
  }

  // ---------------------------------------------------------- backfill ----
  /** Page each read/two_way link back to the cut-off, ingesting oldest-first per page. */
  async function backfill({ months = 6, maxPages = 2000, force = false } = {}) {
    const database = useDb();
    const token = need('DISCORD_BOT_TOKEN');
    const cutoff = new Date(now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const cutoffMs = cutoff.getTime();

    const links = await refreshLinks();
    const summary = { links: 0, pages: 0, ingested: 0, skipped: 0 };

    for (const link of links) {
      if (!['read', 'two_way'].includes(link.sync_mode)) continue;
      if (link.status === 'disabled') continue;
      const cursor = cursorOf(link);
      if (cursor.backfill_done && !force) continue;
      summary.links += 1;

      let before = cursor.backfill_before ?? null;
      let reachedCutoff = false;
      for (let page = 0; page < maxPages && !reachedCutoff; page += 1) {
        const qs = new URLSearchParams({ limit: '100' });
        if (before) qs.set('before', before);
        const batch = await discordApi('GET', `/channels/${link.external_ref}/messages?${qs}`, undefined, token, fetchImpl, { sleep });
        summary.pages += 1;
        if (!Array.isArray(batch) || batch.length === 0) {
          reachedCutoff = true;
          break;
        }
        // Discord returns newest first; keep only messages at/after the cut-off.
        const inRange = batch.filter((m) => snowflakeToDate(m.id).getTime() >= cutoffMs);
        if (inRange.length < batch.length) reachedCutoff = true;
        for (const m of inRange.reverse()) {
          const r = await ingest({ ...m, guild_id: m.guild_id ?? env.DISCORD_GUILD_ID ?? null });
          if (r?.skipped) summary.skipped += 1;
          else summary.ingested += 1;
        }
        before = batch[batch.length - 1].id;
        if (batch.length < 100) reachedCutoff = true;
        const next = { ...cursorOf(link), backfill_before: before };
        if (reachedCutoff) {
          delete next.backfill_before;
          next.backfill_done = true;
          next.backfill_cutoff = cutoff.toISOString();
        }
        await database.setLinkCursor(link.id, next);
        link.cursor = next;
      }
    }
    return summary;
  }

  // ------------------------------------------------------- identities ----
  /**
   * Discord never exposes emails; map guild members -> profiles through a
   * provided {discordUserId|username: email} map. Returns {mapped, unmapped}.
   */
  async function mapMembers(members, handleToEmail = {}, database = db) {
    const mapped = [];
    const unmapped = [];
    for (const m of members ?? []) {
      const user = m.user ?? m;
      const handle = String(user.id);
      const email = handleToEmail[handle] ?? handleToEmail[user.username] ?? null;
      const profileId = email ? await database.profileIdForEmail(email) : null;
      const display = m.nick ?? user.global_name ?? user.username ?? handle;
      if (!profileId) {
        unmapped.push({ handle, display, email });
        continue;
      }
      await database.upsertProfileIdentity({ provider: 'discord', handle, profile_id: profileId, display, source: 'manual_map', confidence: 1 });
      mapped.push({ handle, display, profile_id: profileId });
    }
    return { mapped, unmapped };
  }

  async function fetchGuildMembers(limit = 1000) {
    return discordApi('GET', `/guilds/${need('DISCORD_GUILD_ID')}/members?limit=${limit}`, undefined, need('DISCORD_BOT_TOKEN'), fetchImpl, { sleep });
  }

  return {
    provider: 'discord',
    requiredEnv,
    connect,
    ingest,
    send,
    backfill,
    mapMembers,
    fetchGuildMembers,
    refreshLinks,
    state,
  };
}

const adapter = createDiscordAdapter();
assertAdapter(adapter); // validates the four verbs + provider; throws otherwise
export default adapter;
