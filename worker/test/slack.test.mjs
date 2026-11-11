// Unit tests for the Slack adapter. Everything is mocked: no network, no
// slack.com, no database. Run: node --test worker/test/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { assertAdapter, formatAgentLabel, chunkText } from '../src/adapters/contract.mjs';
import {
  createSlackAdapter,
  slackApi,
  verifySlackSignature,
  mrkdwnToMarkdown,
  markdownToMrkdwn,
  mapUsersToProfiles,
  requiredEnv,
} from '../src/adapters/slack.mjs';

// ------------------------------------------------------------- fakes ----
function fakeDb() {
  const calls = { ingest: [], bridged: [], cursors: [], identities: [], connections: [] };
  return {
    calls,
    links: [],
    outbound: [],
    emails: {},
    async ingestBridgeMessage(record) { calls.ingest.push(record); return { status: 'inserted', message_id: `m${calls.ingest.length}` }; },
    async linksForProvider() { return this.links; },
    async outboundForProvider() { return this.outbound; },
    async markBridged(message_id, prov, ext, error) { calls.bridged.push({ message_id, prov, ext, error }); },
    async upsertConnection(c) { calls.connections.push(c); },
    async upsertLink() {},
    async setLinkCursor(link_id, cursor) { calls.cursors.push({ link_id, cursor }); },
    async upsertProfileIdentity(i) { calls.identities.push(i); },
    async profileIdForEmail(email) { return this.emails[email] ?? null; },
  };
}

/** fetch fake: routes by Slack method, records every call. */
function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    const method = url.replace('https://slack.com/api/', '');
    const body = JSON.parse(init.body);
    const token = init.headers.authorization.replace('Bearer ', '');
    calls.push({ method, body, token });
    const h = handlers[method];
    const out = typeof h === 'function' ? h(body, token, calls) : (h ?? { ok: true });
    if (out?.__status) return { status: out.__status, headers: new Map([['retry-after', out.retryAfter ?? '1']]), json: async () => out.json ?? {} };
    return { status: 200, headers: new Map(), json: async () => out };
  };
  fn.calls = calls;
  return fn;
}

class FakeWebSocket extends EventTarget {
  constructor(url) { super(); this.url = url; this.sent = []; this.closed = false; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  push(obj) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) })); }
}

const ENV = { SLACK_APP_TOKEN: 'xapp-test', SLACK_BOT_TOKEN: 'xoxb-test', SLACK_BOT_USER_ID: 'UBOT' };
const quiet = { error() {}, warn() {}, log() {} };
const noSleep = async () => {};

function build(over = {}) {
  const db = fakeDb();
  const fetch = fakeFetch(over.handlers ?? {});
  const adapter = createSlackAdapter({ db, env: ENV, fetchImpl: fetch, log: quiet, sleep: noSleep, users: { U123: 'alex', U456: 'sam' }, ...over.opts });
  return { db, fetch, adapter };
}

// ---------------------------------------------------------- contract ----
describe('contract', () => {
  test('assertAdapter passes on the exported adapter object', () => {
    const { adapter } = build();
    assert.equal(assertAdapter(adapter), true);
    assert.throws(() => assertAdapter({ provider: 'x', connect() {} }), /missing verb ingest/);
  });
  test('formatAgentLabel and chunkText', () => {
    assert.equal(formatAgentLabel({ agentName: 'Friday', body: 'hi' }), '**Friday** (Open Ronin agent)\nhi');
    assert.deepEqual(chunkText('short', 10), ['short']);
    const chunks = chunkText('aaaa bbbb cccc dddd', 10);
    assert.deepEqual(chunks, ['aaaa bbbb', 'cccc dddd']);
    assert.ok(chunks.every((c) => c.length <= 10));
  });
  test('requiredEnv names', () => {
    assert.deepEqual(requiredEnv, ['SLACK_APP_TOKEN', 'SLACK_BOT_TOKEN']);
  });
});

// ------------------------------------------------------------ ingest ----
describe('ingest', () => {
  const base = { token: 'x', team_id: 'T1', type: 'event_callback' };

  test('normalizes a channel message', async () => {
    const { db, adapter } = build();
    const res = await adapter.ingest({ ...base, event: { type: 'message', channel: 'C1', user: 'U123', text: 'hey <@U456> see <https://x.io|the doc> and *this*', ts: '1700000000.000100', team: 'T1', channel_type: 'channel', user_profile: { display_name: 'Alex' } } });
    assert.equal(res.status, 'inserted');
    const r = db.calls.ingest[0];
    assert.equal(r.provider, 'slack');
    assert.equal(r.external_ref, 'C1');
    assert.equal(r.provider_message_id, '1700000000.000100');
    assert.equal(r.provider_thread_id, null);
    assert.equal(r.sender_handle, 'U123');
    assert.equal(r.sender_display, 'Alex');
    assert.equal(r.body, 'hey @sam see [the doc](https://x.io) and **this**');
    assert.equal(r.sent_at, '2023-11-14T22:13:20.000Z');
    assert.deepEqual(r.attachments, []);
    assert.deepEqual(r.payload, { subtype: null, team: 'T1', channel_type: 'channel' });
  });

  test('normalizes a thread reply', async () => {
    const { db, adapter } = build();
    await adapter.ingest({ ...base, event: { type: 'message', channel: 'G1', user: 'U456', text: 'reply', ts: '1700000001.000200', thread_ts: '1700000000.000100', channel_type: 'group' } });
    const r = db.calls.ingest[0];
    assert.equal(r.provider_thread_id, '1700000000.000100');
    assert.equal(r.sender_display, 'sam'); // resolver map fallback
  });

  test('file_share keeps attachments as metadata only', async () => {
    const { db, adapter } = build();
    await adapter.ingest({ ...base, event: { type: 'message', subtype: 'file_share', channel: 'C1', user: 'U123', text: 'here', ts: '1700000002.000300', files: [{ name: 'a.pdf', mimetype: 'application/pdf', size: 1234, url_private: 'https://files.slack.com/a.pdf', title: 'A' }] } });
    const r = db.calls.ingest[0];
    assert.deepEqual(r.attachments, [{ name: 'a.pdf', mime: 'application/pdf', size: 1234, url_private: 'https://files.slack.com/a.pdf' }]);
    assert.equal(r.payload.subtype, 'file_share');
  });

  test('skips own echo by bot user id and by openronin metadata', async () => {
    const { db, adapter } = build();
    const a = await adapter.ingest({ ...base, event: { type: 'message', channel: 'C1', user: 'UBOT', text: 'me', ts: '1.1' } });
    const b = await adapter.ingest({ ...base, event: { type: 'message', channel: 'C1', user: 'U999', text: 'me', ts: '1.2', metadata: { event_type: 'openronin_message', event_payload: { message_id: 'abc' } } } });
    assert.equal(a.skipped, 'own_echo');
    assert.equal(b.skipped, 'own_echo');
    assert.equal(db.calls.ingest.length, 0);
  });

  test('skips message_changed / message_deleted / foreign bot_message with a reason', async () => {
    const { db, adapter } = build();
    const c = await adapter.ingest({ ...base, event: { type: 'message', subtype: 'message_changed', channel: 'C1', ts: '1.3', message: {} } });
    const d = await adapter.ingest({ ...base, event: { type: 'message', subtype: 'message_deleted', channel: 'C1', ts: '1.4' } });
    const e = await adapter.ingest({ ...base, event: { type: 'message', subtype: 'bot_message', bot_id: 'BOTHER', channel: 'C1', ts: '1.5', text: 'x' } });
    assert.deepEqual(c, { skipped: true, reason: 'message_changed' });
    assert.deepEqual(d, { skipped: true, reason: 'message_deleted' });
    assert.deepEqual(e, { skipped: true, reason: 'bot_message' });
    assert.equal(db.calls.ingest.length, 0);
  });
});

// -------------------------------------------------------- formatting ----
describe('mrkdwn <-> markdown', () => {
  test('round trip', () => {
    const md = 'Hi **there** read [docs](https://d.io/a?b=1) now';
    const mrk = markdownToMrkdwn(md);
    assert.equal(mrk, 'Hi *there* read <https://d.io/a?b=1|docs> now');
    assert.equal(mrkdwnToMarkdown(mrk), md);
  });
  test('mentions, bare links and entities', () => {
    assert.equal(mrkdwnToMarkdown('<@U123> &amp; <https://a.io> <!here>', { U123: 'alex' }), '@alex & https://a.io @here');
    assert.equal(markdownToMrkdwn('a < b & c'), 'a &lt; b &amp; c');
    assert.equal(markdownToMrkdwn('ping @alex', { alex: 'U123' }), 'ping <@U123>');
  });
});

// -------------------------------------------------------------- send ----
describe('send', () => {
  test('agent message goes through the single bot with the label; user message gets username override; error path recorded', async () => {
    let n = 0;
    const { db, fetch, adapter } = build({
      handlers: {
        'chat.postMessage': (body) => {
          n++;
          if (body.channel === 'CFAIL') return { ok: false, error: 'channel_not_found' };
          return { ok: true, ts: `170000000${n}.0001` };
        },
      },
    });
    db.outbound = [
      { message_id: 'm-agent', external_ref: 'C1', body: 'Draft **ready** at [here](https://p.fg/1)', sender_type: 'agent', sender_name: 'Friday', sender_agent_slug: 'friday', in_reply_to_external_id: null },
      { message_id: 'm-user', external_ref: 'C1', body: 'thanks', sender_type: 'user', sender_name: 'Alex', sender_profile_id: 'p-1', in_reply_to_external_id: '1699999999.0001' },
      { message_id: 'm-bad', external_ref: 'CFAIL', body: 'nope', sender_type: 'user', sender_name: 'Sam' },
    ];
    const results = await adapter.send();

    const [agent, user, bad] = fetch.calls;
    assert.equal(agent.method, 'chat.postMessage');
    assert.equal(agent.token, 'xoxb-test');
    assert.equal(agent.body.text, '*Friday* (Open Ronin agent)\nDraft *ready* at <https://p.fg/1|here>');
    assert.equal(agent.body.username, undefined); // never a separate identity
    assert.deepEqual(agent.body.metadata, { event_type: 'openronin_message', event_payload: { message_id: 'm-agent' } });
    assert.equal(agent.body.thread_ts, undefined);

    assert.equal(user.token, 'xoxb-test'); // resolveUserToken returns null today -> bot + customize
    assert.equal(user.body.username, 'Alex');
    assert.equal(user.body.thread_ts, '1699999999.0001');
    assert.equal(user.body.text, 'thanks');

    assert.equal(bad.body.channel, 'CFAIL');
    assert.deepEqual(db.calls.bridged, [
      { message_id: 'm-agent', prov: 'slack', ext: '1700000001.0001', error: null },
      { message_id: 'm-user', prov: 'slack', ext: '1700000002.0001', error: null },
      { message_id: 'm-bad', prov: 'slack', ext: null, error: 'slack chat.postMessage: channel_not_found' },
    ]);
    assert.equal(results.length, 3);
    assert.ok(results[2].error);
  });

  test('per-user token is used when resolveUserToken returns one', async () => {
    const { db, fetch, adapter } = build({ handlers: { 'chat.postMessage': { ok: true, ts: '1.0' } }, opts: { resolveUserToken: async (pid) => (pid === 'p-1' ? 'xoxp-user' : null) } });
    db.outbound = [{ message_id: 'm1', external_ref: 'C1', body: 'as me', sender_type: 'user', sender_name: 'Alex', sender_profile_id: 'p-1' }];
    await adapter.send();
    assert.equal(fetch.calls[0].token, 'xoxp-user');
    assert.equal(fetch.calls[0].body.username, undefined);
  });

  test('paces 1 msg/sec per channel', async () => {
    let clock = 0;
    const sleeps = [];
    const { db, adapter } = build({ handlers: { 'chat.postMessage': { ok: true, ts: '1.0' } }, opts: { now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } } });
    db.outbound = [
      { message_id: 'a', external_ref: 'C1', body: '1', sender_type: 'agent', sender_name: 'F' },
      { message_id: 'b', external_ref: 'C1', body: '2', sender_type: 'agent', sender_name: 'F' },
      { message_id: 'c', external_ref: 'C2', body: '3', sender_type: 'agent', sender_name: 'F' },
    ];
    await adapter.send();
    assert.deepEqual(sleeps, [1000]); // second post to C1 waits; C2 does not
  });
});

// ---------------------------------------------------------- slackApi ----
describe('slackApi', () => {
  test('throws on ok:false and retries 429 once', async () => {
    let hits = 0;
    const fetch = fakeFetch({ 'x.y': () => (++hits === 1 ? { __status: 429, retryAfter: '2' } : { ok: true, hit: hits }) });
    const slept = [];
    const res = await slackApi('x.y', {}, 'tok', fetch, { sleep: async (ms) => slept.push(ms) });
    assert.equal(res.hit, 2);
    assert.deepEqual(slept, [2000]);
    await assert.rejects(slackApi('z', {}, 'tok', fakeFetch({ z: { ok: false, error: 'invalid_auth' } })), /slack z: invalid_auth/);
  });
});

// ------------------------------------------------------- socket mode ----
describe('connect (Socket Mode)', () => {
  test('hello resolves, events_api envelope is acked and routed to ingest', async () => {
    const sockets = [];
    const { db, fetch, adapter } = build({
      handlers: { 'apps.connections.open': { ok: true, url: 'wss://fake/1' } },
      opts: { wsFactory: (url) => { const ws = new FakeWebSocket(url); sockets.push(ws); return ws; } },
    });
    const p = adapter.connect();
    await new Promise((r) => setImmediate(r));
    assert.equal(fetch.calls[0].method, 'apps.connections.open');
    assert.equal(fetch.calls[0].token, 'xapp-test');
    assert.equal(sockets[0].url, 'wss://fake/1');
    sockets[0].push({ type: 'hello' });
    const handle = await p;

    sockets[0].push({ type: 'events_api', envelope_id: 'env-1', payload: { team_id: 'T1', event: { type: 'message', channel: 'C1', user: 'U123', text: 'yo', ts: '1700000000.5' } } });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(sockets[0].sent, [{ envelope_id: 'env-1' }]);
    assert.equal(db.calls.ingest.length, 1);
    assert.equal(db.calls.ingest[0].body, 'yo');

    // disconnect -> reconnect opens a second socket
    sockets[0].push({ type: 'disconnect', reason: 'refresh_requested' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(sockets.length, 2);
    handle.close();
    assert.equal(sockets[1].closed, true);
    assert.equal(sockets.length, 2); // no reconnect after an explicit close
  });

  test('auth.test fills bot user id when SLACK_BOT_USER_ID is unset', async () => {
    const db = fakeDb();
    const fetch = fakeFetch({ 'auth.test': { ok: true, user_id: 'UAUTO', bot_id: 'B1', team_id: 'T1', team: 'Main' }, 'apps.connections.open': { ok: true, url: 'wss://f' } });
    const adapter = createSlackAdapter({ db, env: { SLACK_APP_TOKEN: 'xapp', SLACK_BOT_TOKEN: 'xoxb' }, fetchImpl: fetch, log: quiet, sleep: noSleep, wsFactory: (u) => { const ws = new FakeWebSocket(u); setImmediate(() => ws.push({ type: 'hello' })); return ws; } });
    const h = await adapter.connect();
    assert.equal(h.botUserId, 'UAUTO');
    assert.equal(db.calls.connections[0].external_account_id, 'T1');
    assert.equal((await adapter.ingest({ event: { type: 'message', channel: 'C1', user: 'UAUTO', text: 'x', ts: '1.0' } })).skipped, 'own_echo');
    h.close();
  });
});

// ---------------------------------------------------------- backfill ----
describe('backfill', () => {
  function memReader(files) {
    return {
      async readdir(dir) { const out = new Set(); for (const k of Object.keys(files)) if (k.startsWith(dir + '/')) out.add(k.slice(dir.length + 1).split('/')[0]); if (!out.size) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return [...out]; },
      async readFile(p) { if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return JSON.stringify(files[p]); },
    };
  }
  const NOW = Date.parse('2026-09-10T00:00:00Z');
  const ts = (iso, frac = '000100') => `${Math.floor(Date.parse(iso) / 1000)}.${frac}`;
  const files = {
    'exp/users.json': [
      { id: 'U123', name: 'alex', real_name: 'Alex A', profile: { email: 'alex@example.com', display_name: 'Alex' } },
      { id: 'U456', name: 'sam', profile: { email: 'sam@example.com', display_name: 'Sam' } },
      { id: 'UBOT', name: 'bridge', is_bot: true, profile: { email: '' } },
      { id: 'U789', name: 'gone', deleted: true, profile: { email: 'gone@example.com' } },
    ],
    'exp/channels.json': [{ id: 'C1', name: 'general' }, { id: 'C2', name: 'random' }],
    'exp/general/2026-09-02.json': [
      { type: 'message', user: 'U456', text: 'second', ts: ts('2026-09-02T10:00:00Z', '000200') },
      { type: 'message', user: 'U123', text: 'first', ts: ts('2026-09-02T09:00:00Z', '000100') },
    ],
    'exp/general/2026-09-01.json': [{ type: 'message', user: 'U123', text: 'zeroth', ts: ts('2026-09-01T09:00:00Z') }],
    'exp/general/2024-01-01.json': [{ type: 'message', user: 'U123', text: 'ancient', ts: ts('2024-01-01T09:00:00Z') }],
    'exp/random/2026-09-02.json': [{ type: 'message', user: 'U456', text: 'unlinked', ts: ts('2026-09-02T09:00:00Z') }],
  };

  test('maps users by email, ingests only linked channels in order, sets the cursor, resumes', async () => {
    const { db, adapter } = build({ opts: { now: () => NOW } });
    db.emails = { 'alex@example.com': 'p-alex', 'sam@example.com': 'p-sam', 'gone@example.com': 'p-gone' };
    db.links = [{ id: 'L1', conversation_id: 'conv1', external_ref: 'C1', external_name: 'general', sync_mode: 'two_way', cursor: null, status: 'active' }];

    const summary = await adapter.backfill('exp', { reader: memReader(files), months: 12 });
    assert.equal(summary.users_mapped, 2);
    assert.deepEqual(db.calls.identities.map((i) => [i.handle, i.profile_id, i.display]), [['U123', 'p-alex', 'Alex'], ['U456', 'p-sam', 'Sam']]);
    assert.deepEqual(db.calls.ingest.map((r) => r.body), ['zeroth', 'first', 'second']);
    assert.ok(db.calls.ingest.every((r) => r.external_ref === 'C1'));
    assert.equal(db.calls.ingest[1].sender_display, 'Alex');
    const last = db.calls.cursors.at(-1);
    assert.equal(last.link_id, 'L1');
    assert.equal(last.cursor.backfill_last_ts, ts('2026-09-02T10:00:00Z', '000200'));
    assert.equal(summary.ingested, 3);

    // resume from cursor: nothing new
    db.links[0].cursor = last.cursor;
    db.calls.ingest.length = 0;
    const again = await adapter.backfill('exp', { reader: memReader(files) });
    assert.equal(again.ingested, 0);
    assert.equal(db.calls.ingest.length, 0);
  });

  test('mapUsersToProfiles is exported standalone', async () => {
    const db = fakeDb();
    db.emails = { 'sam@example.com': 'p-sam' };
    const mapped = await mapUsersToProfiles(files['exp/users.json'], db);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].handle, 'U456');
    assert.equal(mapped[0].provider, 'slack');
  });
});

// --------------------------------------------------------- signature ----
describe('verifySlackSignature', () => {
  const vector = {
    signingSecret: '8f742231b10e8888abcd99yyyzzz85a5',
    timestamp: '1531420618',
    body: 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=coverbands&channel_id=C2147483705&channel_name=test&user_id=U2147483697&user_name=Steve&command=%2Fweather&text=94070&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2F1234%2F5678&trigger_id=13345224609.738474920.8088930838d88f008e0',
    signature: 'v0=9ba8f118554e726caf9366ea6ad77a51a47d2ab2b176d09b9d1141ef00356a76',
  };
  test('accepts the HMAC v0 vector and rejects tampering / stale timestamps', () => {
    const now = 1531420618 * 1000;
    assert.equal(verifySlackSignature({ ...vector, now }), true);
    assert.equal(verifySlackSignature({ ...vector, body: vector.body + 'x', now }), false);
    assert.equal(verifySlackSignature({ ...vector, signature: 'v0=00', now }), false);
    assert.equal(verifySlackSignature({ ...vector, now: now + 10 * 60 * 1000 }), false);
  });
});
