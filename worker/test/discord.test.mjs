// Unit tests for the Discord adapter. Everything is mocked: no network, no
// discord.com, no real WebSocket. Run: node --test worker/test/discord.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiscordAdapter,
  snowflakeToDate,
  dateToSnowflake,
  discordApi,
  INTENT_MASK,
  INTENTS,
  OP,
  requiredEnv,
} from '../src/adapters/discord.mjs';

// ------------------------------------------------------------ fixtures ----
const ENV = { DISCORD_BOT_TOKEN: 'test-token', DISCORD_APPLICATION_ID: '999000111', DISCORD_GUILD_ID: '555' };
const OUR_WEBHOOK = { id: '777', token: 'wh-token' };

function makeDb(overrides = {}) {
  const calls = { ingest: [], markBridged: [], setLinkCursor: [], upsertConnection: [], upsertProfileIdentity: [] };
  const links = overrides.links ?? [
    {
      id: 'link-1',
      conversation_id: 'conv-1',
      external_ref: '123',
      external_name: 'general',
      sync_mode: 'two_way',
      status: 'active',
      cursor: { webhook_id: OUR_WEBHOOK.id, webhook_token: OUR_WEBHOOK.token },
      conversation_slug: 'general',
    },
  ];
  const db = {
    calls,
    links,
    outbound: overrides.outbound ?? [],
    async ingestBridgeMessage(record) {
      calls.ingest.push(record);
      return { status: 'inserted', message_id: `m-${calls.ingest.length}`, conversation_id: 'conv-1' };
    },
    async linksForProvider() {
      return links;
    },
    async outboundForProvider() {
      return db.outbound;
    },
    async markBridged(message_id, provider, external_message_id, error) {
      calls.markBridged.push({ message_id, provider, external_message_id, error });
    },
    async setLinkCursor(link_id, cursor) {
      calls.setLinkCursor.push({ link_id, cursor });
      const l = links.find((x) => x.id === link_id);
      if (l) l.cursor = cursor;
    },
    async upsertConnection(c) {
      calls.upsertConnection.push(c);
    },
    async upsertLink() {},
    async upsertProfileIdentity(p) {
      calls.upsertProfileIdentity.push(p);
    },
    async profileIdForEmail(email) {
      return email === 'alice@example.com' ? 'profile-alice' : null;
    },
  };
  return db;
}

/** Records every fetch; routes are matched by substring; responses are queued per route. */
function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    for (const [needle, responder] of routes) {
      if (url.includes(needle)) {
        const r = typeof responder === 'function' ? responder({ url, init, calls }) : responder;
        const status = r.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (k) => r.headers?.[k.toLowerCase()] ?? null },
          text: async () => (r.json === undefined ? '' : JSON.stringify(r.json)),
        };
      }
    }
    throw new Error(`unexpected fetch ${init.method ?? 'GET'} ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const noSleep = async () => {};

function message(over = {}) {
  return {
    id: '1200000000000000000',
    channel_id: '123',
    guild_id: '555',
    type: 0,
    content: 'hello world',
    timestamp: '2026-09-01T12:00:00.000Z',
    author: { id: '42', username: 'alice', global_name: 'Alice A' },
    member: { nick: 'Ali' },
    attachments: [],
    mentions: [],
    ...over,
  };
}

// --------------------------------------------------------------- utils ----
describe('snowflakes', () => {
  test('snowflakeToDate vector', () => {
    assert.equal(snowflakeToDate('175928847299117063').toISOString(), '2016-04-30T11:18:25.796Z');
  });
  test('dateToSnowflake round-trips to the same ms', () => {
    const d = new Date('2026-03-10T00:00:00.000Z');
    assert.equal(snowflakeToDate(dateToSnowflake(d)).getTime(), d.getTime());
  });
  test('requiredEnv lists the three secrets', () => {
    assert.deepEqual(requiredEnv, ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID']);
  });
});

describe('discordApi', () => {
  test('sends Bot auth and retries once on 429 using retry_after', async () => {
    let hits = 0;
    const slept = [];
    const fetchImpl = makeFetch([
      [
        '/channels/1/messages',
        () => {
          hits += 1;
          return hits === 1 ? { status: 429, json: { retry_after: 0.5 } } : { json: { id: 'ok' } };
        },
      ],
    ]);
    const res = await discordApi('GET', '/channels/1/messages', undefined, 'tok', fetchImpl, { sleep: async (ms) => slept.push(ms) });
    assert.deepEqual(res, { id: 'ok' });
    assert.equal(hits, 2);
    assert.deepEqual(slept, [500]);
    assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bot tok');
  });
  test('throws DiscordApiError on non-2xx', async () => {
    const fetchImpl = makeFetch([['/x', { status: 403, json: { message: 'Missing Access' } }]]);
    await assert.rejects(() => discordApi('GET', '/x', undefined, 'tok', fetchImpl), /403: Missing Access/);
  });
});

// -------------------------------------------------------------- ingest ----
describe('ingest', () => {
  let db;
  let adapter;
  beforeEach(async () => {
    db = makeDb();
    adapter = createDiscordAdapter({ db, env: ENV, fetchImpl: makeFetch([]), sleep: noSleep, log: null });
    await adapter.refreshLinks();
  });

  test('normalizes a plain message', async () => {
    const res = await adapter.ingest(message());
    assert.equal(res.status, 'inserted');
    const rec = db.calls.ingest[0];
    assert.equal(rec.provider, 'discord');
    assert.equal(rec.external_ref, '123');
    assert.equal(rec.provider_message_id, '1200000000000000000');
    assert.equal(rec.provider_thread_id, null);
    assert.equal(rec.sender_handle, '42');
    assert.equal(rec.sender_display, 'Ali'); // member.nick wins
    assert.equal(rec.body, 'hello world');
    assert.equal(rec.sent_at, '2026-09-01T12:00:00.000Z');
    assert.deepEqual(rec.attachments, []);
    assert.equal(rec.payload.guild_id, '555');
    assert.equal(rec.payload.webhook_id, null);
    assert.equal(rec.payload.raw_type, 0);
    assert.equal(rec.payload.is_bot, false);
  });

  test('display falls back global_name -> username', async () => {
    await adapter.ingest(message({ member: undefined }));
    assert.equal(db.calls.ingest[0].sender_display, 'Alice A');
    await adapter.ingest(message({ id: '2', member: undefined, author: { id: '42', username: 'alice' } }));
    assert.equal(db.calls.ingest[1].sender_display, 'alice');
  });

  test('a reply carries message_reference as provider_thread_id', async () => {
    await adapter.ingest(message({ type: 19, message_reference: { message_id: '1100000000000000000', channel_id: '123' } }));
    const rec = db.calls.ingest[0];
    assert.equal(rec.provider_thread_id, '1100000000000000000');
    assert.equal(rec.payload.raw_type, 19);
  });

  test('attachments are normalized', async () => {
    await adapter.ingest(
      message({
        attachments: [{ id: '9', filename: 'spec.pdf', content_type: 'application/pdf', size: 1234, url: 'https://cdn.discordapp.com/a/spec.pdf' }],
      }),
    );
    assert.deepEqual(db.calls.ingest[0].attachments, [{ name: 'spec.pdf', mime: 'application/pdf', size: 1234, url: 'https://cdn.discordapp.com/a/spec.pdf' }]);
  });

  test('mentions are rendered via payload and injected resolver', async () => {
    const resolving = createDiscordAdapter({
      db,
      env: ENV,
      sleep: noSleep,
      log: null,
      resolveMention: async (kind, id) => (kind === 'channel' && id === '321' ? 'random' : kind === 'user' && id === '77' ? 'Bob' : null),
    });
    await resolving.ingest(
      message({
        content: 'hey <@42> and <@!77> see <#321> and <#000>',
        mentions: [{ id: '42', username: 'alice', global_name: 'Alice A' }],
      }),
    );
    assert.equal(db.calls.ingest[0].body, 'hey @Alice A and @Bob see #random and #000');
  });

  test('skips an echo from our own webhook', async () => {
    const res = await adapter.ingest(message({ webhook_id: OUR_WEBHOOK.id, author: { id: OUR_WEBHOOK.id, username: 'Alice', bot: true } }));
    assert.deepEqual(res, { skipped: 'own_echo' });
    assert.equal(db.calls.ingest.length, 0);
  });

  test('skips a message from our own bot user', async () => {
    const res = await adapter.ingest(message({ author: { id: ENV.DISCORD_APPLICATION_ID, username: 'Open Ronin Bridge', bot: true } }));
    assert.deepEqual(res, { skipped: 'own_echo' });
    assert.equal(db.calls.ingest.length, 0);
  });

  test('ingests other bots but marks payload.is_bot', async () => {
    const res = await adapter.ingest(message({ author: { id: '31337', username: 'GitHub', bot: true }, webhook_id: '31337' }));
    assert.equal(res.status, 'inserted');
    assert.equal(db.calls.ingest[0].payload.is_bot, true);
    assert.equal(db.calls.ingest[0].payload.webhook_id, '31337');
  });

  test('a thread message resolves to the parent channel link and records parent_channel_id', async () => {
    adapter.state.threads.set('456', '123');
    await adapter.ingest(message({ channel_id: '456' }));
    const rec = db.calls.ingest[0];
    assert.equal(rec.external_ref, '123');
    assert.equal(rec.payload.channel_id, '456');
    assert.equal(rec.payload.parent_channel_id, '123');
  });
});

// ------------------------------------------------------------- gateway ----
class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
    this.closedWith = null;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code, reason) {
    this.closedWith = { code, reason };
  }
  // test helpers
  async receive(packet) {
    for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(packet) });
    await new Promise((r) => setImmediate(r));
  }
  async serverClose(code) {
    for (const fn of this.listeners.close ?? []) fn({ code });
    await new Promise((r) => setImmediate(r));
  }
}

function fakeTimers() {
  const intervals = [];
  const timeouts = [];
  return {
    intervals,
    timeouts,
    setInterval: (fn, ms) => {
      const h = { fn, ms };
      intervals.push(h);
      return h;
    },
    clearInterval: (h) => {
      const i = intervals.indexOf(h);
      if (i >= 0) intervals.splice(i, 1);
    },
    setTimeout: (fn, ms) => {
      const h = { fn, ms };
      timeouts.push(h);
      return h;
    },
    clearTimeout: (h) => {
      const i = timeouts.indexOf(h);
      if (i >= 0) timeouts.splice(i, 1);
    },
  };
}

describe('gateway connect', () => {
  let db;
  let adapter;
  let timers;
  let errors;
  let handle;
  beforeEach(() => {
    FakeWebSocket.instances = [];
    db = makeDb();
    timers = fakeTimers();
    errors = [];
    adapter = createDiscordAdapter({ db, env: ENV, WebSocketImpl: FakeWebSocket, timers, sleep: noSleep, log: null });
    handle = adapter.connect({ onError: (e) => errors.push(e) });
  });

  test('intents mask is GUILDS|GUILD_MEMBERS|GUILD_MESSAGES|MESSAGE_CONTENT', () => {
    assert.equal(INTENT_MASK, (1 << 0) | (1 << 1) | (1 << 9) | (1 << 15));
    assert.equal(INTENT_MASK, 33283);
    assert.equal(INTENTS.MESSAGE_CONTENT, 32768);
  });

  test('HELLO schedules the heartbeat and sends IDENTIFY with the intents mask', async () => {
    const ws = FakeWebSocket.instances[0];
    assert.equal(ws.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 41250 } });

    assert.equal(timers.intervals.length, 1);
    assert.equal(timers.intervals[0].ms, 41250);
    assert.equal(handle.heartbeatIntervalMs(), 41250);

    const identify = ws.sent.find((p) => p.op === OP.IDENTIFY);
    assert.ok(identify, 'IDENTIFY sent');
    assert.equal(identify.d.token, 'test-token');
    assert.equal(identify.d.intents, INTENT_MASK);
    assert.equal(identify.d.properties.browser, 'openronin-bridge');

    // A heartbeat tick sends op 1 with the last sequence.
    await ws.receive({ op: OP.DISPATCH, s: 7, t: 'RESUMED', d: {} });
    timers.intervals[0].fn();
    const beat = ws.sent.find((p) => p.op === OP.HEARTBEAT);
    assert.deepEqual(beat, { op: 1, d: 7 });
    await ws.receive({ op: OP.HEARTBEAT_ACK });
  });

  test('READY stores session_id, resume_gateway_url and bot user id', async () => {
    const ws = FakeWebSocket.instances[0];
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    await ws.receive({ op: OP.DISPATCH, s: 1, t: 'READY', d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.example', user: { id: '999000111' } } });
    assert.equal(adapter.state.sessionId, 'sess-1');
    assert.equal(adapter.state.resumeGatewayUrl, 'wss://resume.example');
    assert.equal(adapter.state.botUserId, '999000111');
    assert.equal(adapter.state.seq, 1);
  });

  test('MESSAGE_CREATE is routed to ingest', async () => {
    const ws = FakeWebSocket.instances[0];
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    await ws.receive({ op: OP.DISPATCH, s: 2, t: 'MESSAGE_CREATE', d: message({ content: 'from gateway' }) });
    assert.equal(db.calls.ingest.length, 1);
    assert.equal(db.calls.ingest[0].body, 'from gateway');
  });

  test('GUILD_CREATE registers threads and upserts the connection', async () => {
    const ws = FakeWebSocket.instances[0];
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    await ws.receive({
      op: OP.DISPATCH,
      s: 2,
      t: 'GUILD_CREATE',
      d: { id: '555', name: 'Beacon dev', channels: [{ id: '123', name: 'general', type: 0 }], threads: [{ id: '456', name: 't', type: 11, parent_id: '123' }] },
    });
    assert.equal(adapter.state.threads.get('456'), '123');
    assert.equal(db.calls.upsertConnection.length, 1);
    assert.equal(db.calls.upsertConnection[0].external_account_id, '555');
    assert.equal(db.calls.upsertConnection[0].status, 'connected');
  });

  test('close 4014 surfaces the missing-intents error and does not reconnect', async () => {
    const ws = FakeWebSocket.instances[0];
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    await ws.serverClose(4014);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /4014/);
    assert.match(errors[0].message, /Message Content Intent/);
    assert.equal(timers.intervals.length, 0, 'heartbeat stopped');
    assert.equal(timers.timeouts.length, 0, 'no reconnect scheduled');
    assert.equal(adapter.state.lastError, errors[0]);
  });

  test('op 7 RECONNECT closes, then a new socket RESUMEs with session + seq', async () => {
    const ws = FakeWebSocket.instances[0];
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    await ws.receive({ op: OP.DISPATCH, s: 5, t: 'READY', d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.example' } });
    await ws.receive({ op: OP.RECONNECT });
    assert.equal(ws.closedWith.code, 4000);
    await ws.serverClose(4000);
    assert.equal(timers.timeouts.length, 1);
    timers.timeouts[0].fn();
    const ws2 = FakeWebSocket.instances[1];
    assert.ok(ws2, 'second socket opened');
    assert.equal(ws2.url, 'wss://resume.example/?v=10&encoding=json');
    await ws2.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    const resume = ws2.sent.find((p) => p.op === OP.RESUME);
    assert.deepEqual(resume, { op: 6, d: { token: 'test-token', session_id: 'sess-1', seq: 5 } });
  });

  test('op 9 INVALID_SESSION (false) drops the session and re-identifies', async () => {
    const ws = FakeWebSocket.instances[0];
    await ws.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    await ws.receive({ op: OP.DISPATCH, s: 5, t: 'READY', d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.example' } });
    await ws.receive({ op: OP.INVALID_SESSION, d: false });
    assert.equal(adapter.state.sessionId, null);
    await ws.serverClose(4000);
    timers.timeouts[0].fn();
    const ws2 = FakeWebSocket.instances[1];
    assert.equal(ws2.url, 'wss://gateway.discord.gg/?v=10&encoding=json');
    await ws2.receive({ op: OP.HELLO, d: { heartbeat_interval: 1000 } });
    assert.ok(ws2.sent.find((p) => p.op === OP.IDENTIFY));
    assert.ok(!ws2.sent.find((p) => p.op === OP.RESUME));
  });

  test('connect without a token throws', () => {
    const bare = createDiscordAdapter({ db, env: {}, WebSocketImpl: FakeWebSocket, timers, log: null });
    assert.throws(() => bare.connect(), /DISCORD_BOT_TOKEN/);
  });
});

// ---------------------------------------------------------------- send ----
describe('send', () => {
  const baseRow = {
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    link_id: 'link-1',
    external_ref: '123',
    body: 'hi from org',
    body_format: 'markdown',
    sent_at: '2026-09-02T00:00:00.000Z',
    sender_type: 'user',
    sender_name: 'Alice',
    sender_profile_id: 'profile-alice',
    sender_agent_slug: null,
    sender_handle: null,
    sender_avatar_url: 'https://app.example.com/a.png',
    in_reply_to_external_id: null,
    attachments: [],
  };

  test('user message goes through the webhook with username override and is marked bridged', async () => {
    const db = makeDb({ outbound: [baseRow] });
    const fetchImpl = makeFetch([[`/webhooks/${OUR_WEBHOOK.id}/${OUR_WEBHOOK.token}`, { json: { id: 'posted-1' } }]]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    const res = await adapter.send();
    assert.deepEqual(res, { sent: 1, failed: 0 });
    assert.equal(fetchImpl.calls.length, 1);
    const call = fetchImpl.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url, `https://discord.com/api/v10/webhooks/777/wh-token?wait=true`);
    assert.equal(call.headers.Authorization, undefined, 'webhook execution needs no bot token');
    assert.equal(call.body.username, 'Alice');
    assert.equal(call.body.avatar_url, 'https://app.example.com/a.png');
    assert.equal(call.body.content, 'hi from org');
    assert.deepEqual(call.body.allowed_mentions, { parse: [] });
    assert.deepEqual(db.calls.markBridged, [{ message_id: 'msg-1', provider: 'discord', external_message_id: 'posted-1', error: null }]);
  });

  test('agent message goes through the same webhook as Open Ronin with the agent name in content', async () => {
    const db = makeDb({ outbound: [{ ...baseRow, message_id: 'msg-2', sender_type: 'agent', sender_name: 'Friday', sender_agent_slug: 'friday', body: 'recap ready' }] });
    const fetchImpl = makeFetch([[`/webhooks/777/wh-token`, { json: { id: 'posted-2' } }]]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    await adapter.send();
    const call = fetchImpl.calls[0];
    assert.equal(call.url.includes('/webhooks/777/wh-token'), true, 'same webhook, no second bot');
    assert.equal(call.body.username, 'Open Ronin');
    assert.ok(call.body.content.startsWith('Friday') || call.body.content.startsWith('**Friday'), `content names the agent first: ${call.body.content}`);
    assert.match(call.body.content, /Open Ronin\.team agent/);
    assert.match(call.body.content, /recap ready/);
  });

  test('creates and persists a webhook when the link cursor lacks one', async () => {
    const db = makeDb({
      links: [{ id: 'link-1', conversation_id: 'conv-1', external_ref: '123', external_name: 'general', sync_mode: 'two_way', status: 'active', cursor: null }],
      outbound: [baseRow],
    });
    const fetchImpl = makeFetch([
      ['/channels/123/webhooks', { json: { id: '888', token: 'new-token' } }],
      ['/webhooks/888/new-token', { json: { id: 'posted-3' } }],
    ]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    await adapter.send();
    assert.equal(fetchImpl.calls[0].method, 'POST');
    assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bot test-token');
    assert.deepEqual(db.calls.setLinkCursor, [{ link_id: 'link-1', cursor: { webhook_id: '888', webhook_token: 'new-token' } }]);
    assert.ok(adapter.state.webhookIds.has('888'), 'new webhook id is recognised for echo detection');
    assert.equal(db.calls.markBridged[0].external_message_id, 'posted-3');
  });

  test('bodies over 2000 chars are chunked, first id is recorded', async () => {
    const long = 'x'.repeat(2500) + '\n' + 'y'.repeat(1500);
    const db = makeDb({ outbound: [{ ...baseRow, body: long }] });
    const fetchImpl = makeFetch([['/webhooks/777/wh-token', ({ calls }) => ({ json: { id: `posted-${calls.length}` } })]]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    await adapter.send();
    assert.ok(fetchImpl.calls.length >= 2, 'at least two chunks posted');
    for (const c of fetchImpl.calls) assert.ok(c.body.content.length <= 2000, `chunk <= 2000 (${c.body.content.length})`);
    assert.equal(fetchImpl.calls.map((c) => c.body.content).join('').replace(/\n/g, ''), long.replace(/\n/g, ''));
    assert.equal(db.calls.markBridged[0].external_message_id, 'posted-1');
  });

  test('a reply gets a "> replying to" quote line (webhooks cannot use message_reference)', async () => {
    const db = makeDb({ outbound: [{ ...baseRow, in_reply_to_external_id: '1100000000000000000' }] });
    const fetchImpl = makeFetch([['/webhooks/777/wh-token', { json: { id: 'p' } }]]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    await adapter.send();
    const content = fetchImpl.calls[0].body.content;
    assert.ok(content.startsWith('> replying to https://discord.com/channels/555/123/1100000000000000000\n'), content);
    assert.equal(fetchImpl.calls[0].body.message_reference, undefined);
  });

  test('a thread target adds ?thread_id=', async () => {
    const db = makeDb({ outbound: [{ ...baseRow, external_ref: '456' }] });
    const fetchImpl = makeFetch([['/webhooks/777/wh-token', { json: { id: 'p' } }]]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    await adapter.send();
    assert.equal(fetchImpl.calls[0].url, 'https://discord.com/api/v10/webhooks/777/wh-token?wait=true&thread_id=456');
  });

  test('error path records the error via markBridged and continues with the next row', async () => {
    const db = makeDb({ outbound: [baseRow, { ...baseRow, message_id: 'msg-2', body: 'second' }] });
    let n = 0;
    const fetchImpl = makeFetch([
      [
        '/webhooks/777/wh-token',
        () => {
          n += 1;
          return n === 1 ? { status: 403, json: { message: 'Missing Permissions' } } : { json: { id: 'posted-2' } };
        },
      ],
    ]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    const res = await adapter.send();
    assert.deepEqual(res, { sent: 1, failed: 1 });
    assert.equal(db.calls.markBridged[0].message_id, 'msg-1');
    assert.equal(db.calls.markBridged[0].external_message_id, null);
    assert.match(db.calls.markBridged[0].error, /403: Missing Permissions/);
    assert.deepEqual(db.calls.markBridged[1], { message_id: 'msg-2', provider: 'discord', external_message_id: 'posted-2', error: null });
  });

  test('falls back to a bot post with the name in the text when no webhook can be created', async () => {
    const db = makeDb({
      links: [{ id: 'link-1', conversation_id: 'conv-1', external_ref: '123', external_name: 'general', sync_mode: 'two_way', status: 'active', cursor: {} }],
      outbound: [baseRow],
    });
    const fetchImpl = makeFetch([
      ['/channels/123/webhooks', { status: 403, json: { message: 'Missing Permissions' } }],
      ['/channels/123/messages', { json: { id: 'bot-posted' } }],
    ]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    await adapter.send();
    const post = fetchImpl.calls[1];
    assert.equal(post.headers.Authorization, 'Bot test-token');
    assert.equal(post.body.content, '**Alice**: hi from org');
    assert.equal(db.calls.markBridged[0].external_message_id, 'bot-posted');
  });

  test('paces at 4 messages/second per channel', async () => {
    let clock = 1_000_000;
    const slept = [];
    const db = makeDb({ outbound: [baseRow, { ...baseRow, message_id: 'msg-2' }, { ...baseRow, message_id: 'msg-3' }] });
    const fetchImpl = makeFetch([['/webhooks/777/wh-token', { json: { id: 'p' } }]]);
    const adapter = createDiscordAdapter({
      db,
      env: ENV,
      fetchImpl,
      log: null,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    await adapter.send();
    assert.deepEqual(slept, [250, 250]);
  });
});

// ------------------------------------------------------------ backfill ----
describe('backfill', () => {
  test('pages with before=, stops at the cut-off, ingests oldest-first, sets cursor', async () => {
    const NOW = new Date('2026-09-10T00:00:00.000Z');
    const cutoff = new Date('2026-03-10T00:00:00.000Z');
    const idAt = (iso) => dateToSnowflake(new Date(iso));
    const mk = (iso, content) => ({ id: idAt(iso), channel_id: '123', content, timestamp: iso, author: { id: '42', username: 'alice' }, type: 0 });

    // Page 1 (newest first): 100 messages all in range. Page 2: two in range then one before the cut-off.
    const page1 = Array.from({ length: 100 }, (_, i) => mk(new Date(NOW.getTime() - (i + 1) * 3600_000).toISOString(), `p1-${i}`));
    const page2 = [mk('2026-04-01T00:00:00.000Z', 'p2-0'), mk('2026-03-15T00:00:00.000Z', 'p2-1'), mk('2026-02-01T00:00:00.000Z', 'too-old')];

    const db = makeDb();
    const fetchImpl = makeFetch([
      [
        '/channels/123/messages',
        ({ url }) => {
          const before = new URL(url).searchParams.get('before');
          if (!before) return { json: page1 };
          if (before === page1[99].id) return { json: page2 };
          throw new Error(`unexpected before=${before}`);
        },
      ],
    ]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null, now: () => NOW.getTime() });
    const res = await adapter.backfill({ months: 6 });

    assert.equal(res.links, 1);
    assert.equal(res.pages, 2);
    assert.equal(res.ingested, 102);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('limit'), '100');
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('before'), null);
    assert.equal(new URL(fetchImpl.calls[1].url).searchParams.get('before'), page1[99].id);
    assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bot test-token');

    // Oldest first within each page; the too-old message never reaches ingest.
    const bodies = db.calls.ingest.map((r) => r.body);
    assert.equal(bodies[0], 'p1-99');
    assert.equal(bodies[99], 'p1-0');
    assert.deepEqual(bodies.slice(100), ['p2-1', 'p2-0']);
    assert.ok(!bodies.includes('too-old'));
    for (const r of db.calls.ingest) assert.ok(new Date(r.sent_at) >= cutoff);

    // Cursor: resumable after page 1, done after page 2, webhook fields preserved.
    assert.equal(db.calls.setLinkCursor.length, 2);
    assert.equal(db.calls.setLinkCursor[0].cursor.backfill_before, page1[99].id);
    assert.equal(db.calls.setLinkCursor[0].cursor.webhook_id, OUR_WEBHOOK.id);
    assert.equal(db.calls.setLinkCursor[1].cursor.backfill_done, true);
    assert.equal(db.calls.setLinkCursor[1].cursor.backfill_before, undefined);
    assert.equal(db.calls.setLinkCursor[1].cursor.backfill_cutoff, cutoff.toISOString());
  });

  test('resumes from cursor.backfill_before and skips write-only / done links', async () => {
    const db = makeDb({
      links: [
        { id: 'l-resume', conversation_id: 'c', external_ref: '123', sync_mode: 'read', status: 'active', cursor: { backfill_before: '1000' } },
        { id: 'l-write', conversation_id: 'c', external_ref: '124', sync_mode: 'write', status: 'active', cursor: {} },
        { id: 'l-done', conversation_id: 'c', external_ref: '125', sync_mode: 'two_way', status: 'active', cursor: { backfill_done: true } },
      ],
    });
    const fetchImpl = makeFetch([['/channels/123/messages', { json: [] }]]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    const res = await adapter.backfill();
    assert.equal(res.links, 1);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(new URL(fetchImpl.calls[0].url).searchParams.get('before'), '1000');
  });

  test('handles a 429 once and continues', async () => {
    let n = 0;
    const db = makeDb();
    const fetchImpl = makeFetch([
      [
        '/channels/123/messages',
        () => {
          n += 1;
          return n === 1 ? { status: 429, json: { retry_after: 0.01 } } : { json: [] };
        },
      ],
    ]);
    const adapter = createDiscordAdapter({ db, env: ENV, fetchImpl, sleep: noSleep, log: null });
    const res = await adapter.backfill();
    assert.equal(n, 2);
    assert.equal(res.pages, 1);
  });
});

// ---------------------------------------------------------- identities ----
describe('mapMembers', () => {
  test('maps members through a handle->email map and upserts identities', async () => {
    const db = makeDb();
    const adapter = createDiscordAdapter({ db, env: ENV, log: null });
    const res = await adapter.mapMembers(
      [
        { user: { id: '42', username: 'alice', global_name: 'Alice A' }, nick: 'Ali' },
        { user: { id: '43', username: 'bob' } },
      ],
      { 42: 'alice@example.com', bob: 'nobody@example.com' },
    );
    assert.deepEqual(res.mapped, [{ handle: '42', display: 'Ali', profile_id: 'profile-alice' }]);
    assert.deepEqual(res.unmapped, [{ handle: '43', display: 'bob', email: 'nobody@example.com' }]);
    assert.equal(db.calls.upsertProfileIdentity[0].provider, 'discord');
    assert.equal(db.calls.upsertProfileIdentity[0].handle, '42');
    assert.equal(db.calls.upsertProfileIdentity[0].profile_id, 'profile-alice');
  });
});

// ------------------------------------------------------------- default ----
describe('default export', () => {
  test('exposes the four verbs and provider', async () => {
    const mod = await import('../src/adapters/discord.mjs');
    const a = mod.default;
    assert.equal(a.provider, 'discord');
    for (const verb of ['connect', 'ingest', 'send', 'backfill']) assert.equal(typeof a[verb], 'function', verb);
    assert.deepEqual(a.requiredEnv, requiredEnv);
  });
});
