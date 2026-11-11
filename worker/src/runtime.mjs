// Run execution for the Open Ronin worker — everything index.mjs's loop calls,
// factored out so the smoke test (src/smoke-comms.mjs) can drive one tick
// without the polling loop or the Agent SDK.
//
// Two kinds of run:
//   * legacy / transcript runs (0020, 0059): executeRun -> proposeAction
//   * chat runs (0061): executeChatRun — thread read (audit) -> reader
//     (audit) -> reply -> chat.reply proposal -> apply (Auto for internal)
//
// Without ANTHROPIC_API_KEY, chat replies are the deterministic digest —
// identical facts, no rephrasing — so the audit round trip is exercised end
// to end before a model key exists.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readTranscriptAsIdentity, proposeAction } from './spine.mjs';
import { threadForIdentity, gatewayRead, applyChatReply, postChatFailure } from './comms.mjs';
import { extractClientQuery, renderPulse, pulsePrompt } from './pulse.mjs';

export const RUN_TIMEOUT_MS = 10 * 60 * 1000; // hard stop per run

export function createRuntime({ supabase, skillsDir = './skills', runtimeName = 'agent-sdk-worker-v1', hasModel = Boolean(process.env.ANTHROPIC_API_KEY), log = console }) {
  // Lazy: the Agent SDK is only loaded when a model key exists, so a box
  // without one (or the smoke test) never pays for it.
  let agentQuery = null;
  async function getAgentQuery() {
    if (!agentQuery) ({ query: agentQuery } = await import('@anthropic-ai/claude-agent-sdk'));
    return agentQuery;
  }

  // Atomic claim: UPDATE ... WHERE status='queued' guarantees two workers never
  // grab the same row (the second UPDATE matches nothing).
  async function claimNextRun({ onlyId = null } = {}) {
    let q = supabase
      .from('skill_runs')
      .select('id, skill, context, identity_slug, triggered_by_event_id, requested_by')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);
    if (onlyId) q = q.eq('id', onlyId);
    const { data: candidates } = await q;
    const run = candidates?.[0];
    if (!run) return null;
    const { data: claimed } = await supabase
      .from('skill_runs')
      .update({ status: 'running', started_at: new Date().toISOString(), runtime: runtimeName })
      .eq('id', run.id)
      .eq('status', 'queued') // the atomicity guard
      .select('id')
      .single();
    return claimed ? run : null;
  }

  // Identity-tagged runs get their inputs from the gateway, not from a table
  // read. Fail closed: no row -> never reaches the model.
  async function gatherSpineInputs(run) {
    if (!run.identity_slug) return null;
    const callId = run.context?.call_id;
    if (!callId) throw new Error(`identity run ${run.id} has no call_id in context; refusing to run without gateway inputs`);
    const read = await readTranscriptAsIdentity(supabase, {
      identitySlug: run.identity_slug, sub: run.requested_by,
      workItemId: run.context?.work_item_id ?? null, eventId: run.triggered_by_event_id ?? null, callId,
    });
    if (read.status !== 'ok') throw new Error(`spine gateway ${read.status}: ${read.error ?? 'unknown'}`);
    if (!read.rows || !read.row) throw new Error(`spine gateway returned no row for call ${callId} (audit ${read.audit_id}); nothing to summarize`);
    return { audit_id: read.audit_id, transcript: read.row };
  }

  async function runModel(prompt, { tools = false } = {}) {
    const query = await getAgentQuery();
    let resultMd = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
    // Identity-tagged runs get NO tools: inputs arrived through the gateway and
    // output goes through proposed_actions. Legacy runs keep the v1 Airtable MCP.
    const toolOpts = tools
      ? { allowedTools: ['mcp__airtable'], mcpServers: { airtable: { command: 'npx', args: ['-y', 'airtable-mcp-server'], env: { AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY } } } }
      : { tools: [], allowedTools: [], mcpServers: {} };
    try {
      for await (const message of query({ prompt, options: { abortController: controller, ...toolOpts, disallowedTools: ['Bash', 'Write', 'Edit'] } })) {
        if (message.type === 'result') resultMd = message.result ?? '';
      }
    } finally {
      clearTimeout(timer);
    }
    if (!resultMd.trim()) throw new Error('Skill produced an empty result.');
    return resultMd;
  }

  async function executeRun(run) {
    const skillMd = await readFile(path.join(skillsDir, run.skill, 'SKILL.md'), 'utf8');
    const spineInputs = await gatherSpineInputs(run);
    const prompt = [
      `You are executing the skill "${run.skill}" for Open Ronin. Follow the skill document below exactly.`,
      `Request context (JSON): ${JSON.stringify(run.context)}`,
      spineInputs ? `Inputs read through the spine as ${run.identity_slug} (audit ${spineInputs.audit_id}):\n${JSON.stringify(spineInputs.transcript)}` : '',
      `Produce the final deliverable as clean markdown. Output ONLY the deliverable.`,
      `--- SKILL DOCUMENT ---`,
      skillMd,
    ].filter(Boolean).join('\n\n');
    const resultMd = await runModel(prompt, { tools: !run.identity_slug });
    return { resultMd, spineInputs };
  }

  // A chat run is any identity run whose event kind starts with 'chat.'. The
  // flow is fixed regardless of agent; adding a second chat agent = a new
  // reader in SQL + a case in the switch below.
  function isChatRun(run) {
    return Boolean(run.identity_slug) && String(run.context?.event_kind ?? '').startsWith('chat.');
  }

  async function executeChatRun(run) {
    const conversationId = run.context?.conversation_id;
    if (!conversationId) throw new Error(`chat run ${run.id} has no conversation_id`);
    const thread = await threadForIdentity(supabase, {
      identitySlug: run.identity_slug, sub: run.requested_by, conversationId, eventId: run.triggered_by_event_id ?? null,
    });
    if (thread.status !== 'ok') throw new Error(`thread read ${thread.status}: ${thread.error ?? 'unknown'}`);

    const skillMd = await readFile(path.join(skillsDir, run.skill, 'SKILL.md'), 'utf8');
    const why = { thread_audit_id: thread.audit_id, reads: [] };
    let body;

    switch (run.skill) {
      case 'client-pulse': {
        const query = extractClientQuery(run.context?.body ?? '');
        const read = await gatewayRead(supabase, {
          identitySlug: run.identity_slug, sub: run.requested_by, reader: 'client_pulse', arg: { client_query: query },
          workItemId: thread.conversation?.work_item_id ?? null, eventId: run.triggered_by_event_id ?? null,
        });
        if (read.status !== 'ok') throw new Error(`reader ${read.status}: ${read.error ?? 'unknown'}`);
        why.reads.push({ reader: 'client_pulse', audit_id: read.audit_id, query, resolved: read.row?.resolved ?? false, client: read.row?.client?.display_name ?? null });
        const useModel = hasModel && Boolean(read.row?.resolved);
        body = useModel ? await runModel(pulsePrompt({ skillMd, thread, reader: read.row, query })) : renderPulse(read.row, { query });
        why.model = useModel ? 'anthropic' : 'deterministic';
        break;
      }
      default:
        throw new Error(`no chat handler for skill ${run.skill}`);
    }

    const proposedId = await proposeAction(supabase, {
      actionType: 'chat.reply', identitySlug: run.identity_slug, skillRunId: run.id,
      workItemId: thread.conversation?.work_item_id ?? null,
      reasoning: `Reply to mention in ${thread.conversation?.title ?? conversationId} (thread audit ${thread.audit_id})`,
      payload: { conversation_id: conversationId, in_reply_to_message_id: run.context?.message_id ?? null, body, why },
    });
    const applied = await applyChatReply(supabase, proposedId);
    const resultMd = `Proposed chat.reply ${proposedId}: ${applied.status}${applied.message_id ? ` (message ${applied.message_id}, audit ${applied.audit_id})` : applied.reason ? ` — ${applied.reason}` : ''}`;
    return { resultMd, proposedId, applied, why };
  }

  /** Claim and execute one run. Returns null when the queue is empty. */
  async function runOne({ onlyId = null } = {}) {
    const run = await claimNextRun({ onlyId });
    if (!run) return null;
    log.log?.(`[${runtimeName}] running ${run.id} (${run.skill}${run.identity_slug ? ` as ${run.identity_slug}` : ''})`);
    try {
      if (isChatRun(run)) {
        const out = await executeChatRun(run);
        await supabase.from('skill_runs').update({ status: 'done', result_md: out.resultMd, finished_at: new Date().toISOString() }).eq('id', run.id);
        log.log?.(`[${runtimeName}] done ${run.id}: ${out.resultMd}`);
        return { run, ...out, status: 'done' };
      }
      if (run.identity_slug && !hasModel) throw new Error('ANTHROPIC_API_KEY is not configured; identity runs that need a model stay for a worker that has one');
      const { resultMd, spineInputs } = await executeRun(run);
      let storedResult = resultMd;
      if (run.identity_slug) {
        // Output is a proposal, never a direct write; skill_runs gets only a
        // pointer so an unapproved draft is not readable from the run row.
        const proposedId = await proposeAction(supabase, {
          actionType: run.context?.action_type ?? run.skill.replace(/-/g, '.'), identitySlug: run.identity_slug, skillRunId: run.id,
          workItemId: run.context?.work_item_id ?? null,
          reasoning: `Produced by ${run.skill} from spine audit ${spineInputs?.audit_id ?? 'n/a'}`, payload: { result_md: resultMd },
        });
        storedResult = `Proposed action ${proposedId} (pending review in spine.proposed_actions).`;
      }
      await supabase.from('skill_runs').update({ status: 'done', result_md: storedResult, finished_at: new Date().toISOString() }).eq('id', run.id);
      log.log?.(`[${runtimeName}] done ${run.id}`);
      return { run, resultMd: storedResult, status: 'done' };
    } catch (err) {
      await supabase.from('skill_runs').update({ status: 'failed', error: String(err?.message ?? err), finished_at: new Date().toISOString() }).eq('id', run.id);
      if (isChatRun(run)) {
        // Silence is never ambiguous: a staff-only note lands in the thread.
        try { await postChatFailure(supabase, run.id, err?.message ?? err); } catch (e2) { log.error?.(`[${runtimeName}] failure note error:`, e2?.message ?? e2); }
      }
      log.error?.(`[${runtimeName}] failed ${run.id}:`, err?.message ?? err);
      return { run, status: 'failed', error: String(err?.message ?? err) };
    }
  }

  return { claimNextRun, executeRun, executeChatRun, isChatRun, runOne };
}
