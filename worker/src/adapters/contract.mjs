// Channel adapter contract for the comms bridge (worker/src/adapters/*).
// ----------------------------------------------------------------------
// Every provider adapter (Slack today; Teams/email/SMS later) exposes the SAME
// four verbs so the worker loop can drive any of them without knowing the
// provider:
//
//   connect(opts)   -> establish the live transport (Socket Mode ws, webhook,
//                      IMAP idle...). Resolves to a handle with close().
//   ingest(event)   -> normalize ONE inbound provider event into the canonical
//                      inbound record and hand it to db.ingestBridgeMessage.
//                      Resolves to the db result or { skipped, reason }.
//   send(opts)      -> drain db.outboundForProvider(<provider>) and post each
//                      row out through the provider, marking each bridged.
//   backfill(src)   -> replay historical provider data (export files, archive
//                      API) through db.ingestBridgeMessage, resumable via
//                      db.setLinkCursor.
//
// Canonical inbound record (what ingest/backfill hand to db.ingestBridgeMessage):
//   {
//     provider:            'slack' | 'teams' | ...,
//     external_ref:        provider channel/conversation id,
//     provider_message_id: provider message id (Slack ts),
//     provider_thread_id:  provider thread id or null,
//     sender_handle:       provider user id,
//     sender_display:      human display name (best effort),
//     body:                markdown,
//     sent_at:             ISO 8601,
//     attachments:         [{ name, mime, size, url_private }],
//     payload:             { ...provider-specific extras (raw subtype, team) },
//   }
//
// The adapter never imports a database client: `db` is injected (the RPC
// wrappers the orchestrator built) so unit tests run against a fake.

export const ADAPTER_VERBS = ['connect', 'ingest', 'send', 'backfill'];

/** Throw unless `adapter` has the four verbs as functions plus a `provider` string. */
export function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter must be an object');
  if (typeof adapter.provider !== 'string' || !adapter.provider) throw new Error('adapter.provider must be a non-empty string');
  for (const verb of ADAPTER_VERBS) {
    if (typeof adapter[verb] !== 'function') throw new Error(`adapter "${adapter.provider}" is missing verb ${verb}()`);
  }
  return true;
}

// ------------------------------------------------------------ helpers ----
// Bot identity minimization: ONE bot per workspace carries the bridge. An
// agent reply is posted through that bot with the acting agent named in the
// text, never as a second bot user. This is the prefix line every provider
// uses so the label looks identical everywhere.
export const AGENT_LABEL_SUFFIX = '(Open Ronin agent)';

export function formatAgentLabel({ agentName, body }) {
  const name = (agentName ?? 'Agent').trim() || 'Agent';
  const text = body ?? '';
  return `**${name}** ${AGENT_LABEL_SUFFIX}\n${text}`;
}

/** Split `body` into chunks of at most `max` chars, preferring newline then
 *  space boundaries so words are not cut mid-way. Always returns >= 1 chunk. */
export function chunkText(body, max = 4000) {
  const text = String(body ?? '');
  if (max < 1) throw new Error('chunkText: max must be >= 1');
  if (text.length <= max) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[ \n]/, '');
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}
