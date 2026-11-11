// Spine client for the worker (migration 0059). Every call goes through a
// security definer RPC exposed on the public schema; the worker never touches
// spine.* tables directly and never SET ROLEs. The database asserts `act`.

/** Read one transcript as an identity. Returns the gateway's jsonb verbatim:
 *  { status: 'ok'|'denied'|'error', audit_id, act, sub, work_item_id, rows, row?, error? } */
export async function readTranscriptAsIdentity(supabase, { identitySlug, sub, workItemId, eventId, callId }) {
  const { data, error } = await supabase.rpc('spine_gateway_read_transcript', {
    p_identity_slug: identitySlug,
    p_sub: sub,
    p_work_item_id: workItemId,
    p_call_id: callId,
    p_event_id: eventId,
  });
  if (error) throw new Error(`spine_gateway_read_transcript: ${error.message}`);
  return data;
}

/** Land a run's output in spine.proposed_actions. Returns the proposal id. */
export async function proposeAction(supabase, { actionType, identitySlug, skillRunId, workItemId, reasoning, payload }) {
  const { data, error } = await supabase.rpc('spine_propose_action', {
    p_action_type: actionType,
    p_identity_slug: identitySlug,
    p_skill_run_id: skillRunId,
    p_work_item_id: workItemId,
    p_reasoning: reasoning,
    p_payload: payload,
  });
  if (error) throw new Error(`spine_propose_action: ${error.message}`);
  return data;
}

/** Turn unprocessed spine.events into skill_runs. Returns { dispatched, skipped }. */
export async function dispatchSpineEvents(supabase, limit = 50) {
  const { data, error } = await supabase.rpc('spine_dispatch_events', { p_limit: limit });
  if (error) throw new Error(`spine_dispatch_events: ${error.message}`);
  return data ?? { dispatched: 0, skipped: 0 };
}
