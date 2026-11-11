// Comms client for the worker (migration 0061). Two things live here:
//
//   1. makeBridgeDb(supabase) — the `db` object the channel adapters
//      (src/adapters/*.mjs) are given. Adapters never import supabase; every
//      call below is a security definer RPC on the public schema that only
//      service_role may execute. Keeping the adapters blind to the database
//      is what makes them unit-testable against a fake and what keeps the
//      "no table, job, or UI element names Slack or Discord" rule honest:
//      the only place a provider name meets a table is the provider column.
//
//   2. The chat-run RPCs the agent path uses: thread_for_identity (the ONLY
//      read an agent has into a conversation; writes the audit triple),
//      gateway_read (identity-owned reader, writes the audit triple),
//      apply_chat_reply (the ONLY way an agent message enters comms.messages;
//      Auto for internal audience, refuses client/external), post_chat_failure.

function rpc(supabase, name, args) {
  return supabase.rpc(name, args).then(({ data, error }) => {
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  });
}

export function makeBridgeDb(supabase) {
  return {
    ingestBridgeMessage: (r) => rpc(supabase, 'comms_ingest_bridge_message', {
      p_provider: r.provider,
      p_external_ref: r.external_ref,
      p_provider_message_id: r.provider_message_id,
      p_provider_thread_id: r.provider_thread_id ?? null,
      p_sender_handle: r.sender_handle ?? null,
      p_sender_display: r.sender_display ?? null,
      p_body: r.body ?? '',
      p_sent_at: r.sent_at ?? new Date().toISOString(),
      p_attachments: r.attachments ?? [],
      p_payload: r.payload ?? {},
    }),
    linksForProvider: (provider) => rpc(supabase, 'comms_links_for_provider', { p_provider: provider }),
    outboundForProvider: (provider, limit = 50) => rpc(supabase, 'comms_outbound_for_provider', { p_provider: provider, p_limit: limit }),
    markBridged: (messageId, provider, externalMessageId, error = null) => rpc(supabase, 'comms_mark_bridged', {
      p_message_id: messageId, p_provider: provider, p_external_message_id: externalMessageId, p_error: error,
    }),
    upsertConnection: (c) => rpc(supabase, 'comms_upsert_connection', {
      p_provider: c.provider, p_scope: c.scope, p_external_account_id: c.external_account_id, p_display_name: c.display_name ?? null,
      // Adapters say 'connected'; the column's vocabulary is pending/active/paused/revoked/error.
      p_status: c.status === 'connected' ? 'active' : (c.status ?? 'active'),
      p_health: c.health && typeof c.health === 'object' ? c.health : { note: c.health ?? null, at: new Date().toISOString() },
      p_credentials_enc: c.credentials_enc ?? null,
    }),
    upsertLink: (l) => rpc(supabase, 'comms_upsert_link', {
      p_provider: l.provider, p_external_ref: l.external_ref, p_conversation_id: l.conversation_id,
      p_external_name: l.external_name ?? null, p_sync_mode: l.sync_mode ?? 'two_way', p_connection_id: l.connection_id ?? null,
    }),
    setLinkCursor: (linkId, cursor, status = null) => rpc(supabase, 'comms_set_link_cursor', { p_link_id: linkId, p_cursor: cursor ?? {}, p_status: status }),
    upsertProfileIdentity: (i) => rpc(supabase, 'comms_upsert_profile_identity', {
      p_provider: i.provider, p_handle: i.handle, p_profile_id: i.profile_id, p_display: i.display ?? null,
      p_source: i.source ?? 'email_match', p_confidence: i.confidence ?? 1.0,
    }),
    profileIdForEmail: (email) => rpc(supabase, 'comms_profile_id_for_email', { p_email: email }),
  };
}

/** The agent's read of a thread. Returns the RPC's jsonb verbatim:
 *  { status: 'ok'|'denied', audit_id, act, sub, conversation, rows, messages, error? } */
export function threadForIdentity(supabase, { identitySlug, sub, conversationId, eventId = null, limit = 40 }) {
  return rpc(supabase, 'comms_thread_for_identity', {
    p_identity_slug: identitySlug, p_sub: sub, p_conversation_id: conversationId, p_event_id: eventId, p_limit: limit,
  });
}

/** Generic identity-owned read (spine.gateway_read). `reader` names
 *  spine.<pg_role>__read_<reader>(jsonb). */
export function gatewayRead(supabase, { identitySlug, sub, reader, arg, workItemId = null, eventId = null }) {
  return rpc(supabase, 'spine_gateway_read', {
    p_identity_slug: identitySlug, p_sub: sub, p_reader: reader, p_arg: arg ?? {}, p_work_item_id: workItemId, p_event_id: eventId,
  });
}

/** Apply a pending chat.reply. { status: 'applied'|'pending'|'rejected', message_id?, audit_id?, reason? } */
export function applyChatReply(supabase, actionId) {
  return rpc(supabase, 'spine_apply_chat_reply', { p_action_id: actionId });
}

export function postChatFailure(supabase, skillRunId, error) {
  return rpc(supabase, 'spine_post_chat_failure', { p_skill_run_id: skillRunId, p_error: String(error ?? 'unknown error').slice(0, 500) });
}
