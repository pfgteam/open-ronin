// client-pulse: the first internal chat agent (brief: "what is going on with
// client X" — read only, internal audience, Auto reply).
//
// Two pure functions the worker composes:
//   extractClientQuery(body, agent)  — pull the client name out of the mention
//   renderPulse(reader, opts)        — deterministic markdown from the reader's
//                                      JSON. This is the answer when no model
//                                      key is configured, and the grounding the
//                                      model gets when one is. The facts in the
//                                      reply never come from anywhere but the
//                                      identity-owned reader; the model only
//                                      rephrases.

const STOP = /^(what|whats|what's|is|are|going|on|with|about|status|of|the|update|how|doing|for|me|please|tell|give|latest|any|news|there|client|re)$/i;

/** "@client_pulse what is going on with Acme Foods?" -> "Acme Foods". */
export function extractClientQuery(body, { slug = 'client_pulse', displayName = 'Client Pulse' } = {}) {
  if (!body) return null;
  let text = String(body)
    .replace(new RegExp(`@${slug}\\b`, 'gi'), ' ')
    .replace(new RegExp(`@${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), ' ');
  // Quoted name wins: "client X" / 'client X'.
  const quoted = text.match(/["“]([^"”]{2,80})["”]/) ?? text.match(/'([^']{2,80})'/);
  if (quoted) return quoted[1].trim();
  // "with <name>" / "about <name>" first (the phrasing in the hint), then
  // "on/for <name>" — "going on with X" must not stop at "on".
  const prep = text.match(/\b(?:with|about|re:?)\s+([^?.!,\n]{2,80})/i) ?? text.match(/\b(?:on|for)\s+([^?.!,\n]{2,80})/i);
  if (prep) {
    const cand = prep[1].trim().replace(/\s+(today|this week|lately|right now|now|please)$/i, '').trim();
    if (cand && !STOP.test(cand)) return cand;
  }
  // Fallback: the remaining words minus stopwords.
  const words = text.replace(/[?.!,]/g, ' ').split(/\s+/).filter((w) => w && !STOP.test(w));
  return words.length ? words.join(' ').trim().slice(0, 80) : null;
}

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

function bullet(items, fn, max = 6) {
  const lines = (items ?? []).slice(0, max).map(fn).filter(Boolean);
  return lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- none on record';
}

/** Deterministic digest. `reader` is the jsonb returned by
 *  spine.agent_client_pulse__read_client_pulse (via spine.gateway_read). */
export function renderPulse(reader, { query = null } = {}) {
  if (!reader || reader.resolved === false) {
    const q = query ?? reader?.query ?? null;
    if (!q) return 'Which client? Try `@client_pulse what is going on with <client name>?`';
    const cands = reader?.candidates ?? [];
    if (cands.length) return `I could not settle on one client for "${q}". Did you mean: ${cands.map((c) => c.display_name).join(', ')}?`;
    return `I could not find a client matching "${q}". Check the spelling or use the name as it appears in Clients.`;
  }
  const c = reader.client ?? {};
  const ow = reader.open_work ?? {};
  const health = reader.health ?? null;
  const meta = reader.meta ?? {};
  const out = [];
  out.push(`**${c.display_name ?? 'Client'}**${c.status ? ` · ${c.status}` : ''}${health?.total_score != null ? ` · health ${Number(health.total_score).toFixed(0)} (${fmtDate(health.period_month)})` : ''}`);
  out.push('');
  out.push(`**Open work** — ${ow.open_task_count ?? 0} open task${ow.open_task_count === 1 ? '' : 's'} across ${(ow.projects ?? []).length} active item${(ow.projects ?? []).length === 1 ? '' : 's'}`);
  out.push(bullet(ow.projects, (p) => `${p.name}${p.kind ? ` (${p.kind})` : ''}${p.status ? ` — ${p.status}` : ''}${p.owner ? `, ${p.owner}` : ''}${p.ends_at ? `, due ${fmtDate(p.ends_at)}` : ''}`));
  if ((ow.tasks ?? []).length) {
    out.push('');
    out.push('**Next tasks**');
    out.push(bullet(ow.tasks, (t) => `${t.title}${t.assignee ? ` — ${t.assignee}` : ''}${t.due_at ? `, due ${fmtDate(t.due_at)}` : ''}${t.status ? ` (${t.status})` : ''}`, 5));
  }
  out.push('');
  out.push('**Recent calls**');
  out.push(bullet(reader.recent_calls, (k) => {
    const head = `${fmtDate(k.occurred_at)}${k.call_type ? ` ${k.call_type}` : ''}${k.duration_minutes ? `, ${k.duration_minutes} min` : ''}${k.score != null ? `, score ${k.score}` : ''}`;
    const sum = k.summary ? ` — ${String(k.summary).replace(/\s+/g, ' ').slice(0, 220)}` : '';
    return head + sum;
  }, 3));
  out.push('');
  out.push('**Live links**');
  out.push(bullet(reader.live_links, (l) => `${fmtDate(l.live_date) ?? ''} ${l.outlet ?? ''}${l.headline ? ` — ${l.headline}` : ''}${l.is_national ? ' (national)' : ''}`.trim(), 4));
  if (meta?.pr_goals) {
    out.push('');
    out.push(`**PR goals** — ${String(meta.pr_goals).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  if ((reader.candidates ?? []).length > 1) {
    out.push('');
    out.push(`_Also matched: ${reader.candidates.slice(1, 4).map((x) => x.display_name).join(', ')}. Say the full name if I picked the wrong one._`);
  }
  return out.join('\n');
}

/** Prompt for the model path (only when ANTHROPIC_API_KEY is configured). */
export function pulsePrompt({ skillMd, thread, reader, query }) {
  return [
    'You are executing the skill "client-pulse" for Open Ronin as the Client Pulse agent. Follow the skill document exactly.',
    `Question asked (client query extracted: ${JSON.stringify(query)}).`,
    `Conversation thread read through the spine (most recent last):\n${JSON.stringify(thread?.messages ?? [], null, 0)}`,
    `Client data read through the spine reader (the ONLY source of facts):\n${JSON.stringify(reader ?? {}, null, 0)}`,
    'Produce the reply as plain markdown. Output ONLY the reply.',
    '--- SKILL DOCUMENT ---',
    skillMd,
  ].join('\n\n');
}
