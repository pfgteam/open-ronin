import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClientQuery, renderPulse } from '../src/pulse.mjs';

test('extractClientQuery pulls the client out of the common phrasings', () => {
  assert.equal(extractClientQuery('@client_pulse what is going on with Tailspin Coffee?'), 'Tailspin Coffee');
  assert.equal(extractClientQuery('@Client Pulse status on Acme Foods please'), 'Acme Foods');
  assert.equal(extractClientQuery('hey @client_pulse, anything about "Blue Sky Bakery" this week?'), 'Blue Sky Bakery');
  assert.equal(extractClientQuery('@client_pulse Tailspin Coffee'), 'Tailspin Coffee');
  assert.equal(extractClientQuery('@client_pulse'), null);
});

test('renderPulse: unresolved and resolved shapes', () => {
  assert.match(renderPulse({ resolved: false, query: 'Nope' }), /could not find a client matching "Nope"/);
  assert.match(renderPulse({ resolved: false, query: 'Ac', candidates: [{ display_name: 'Acme' }, { display_name: 'Acorn' }] }), /Did you mean: Acme, Acorn/);
  const md = renderPulse({
    resolved: true,
    client: { display_name: 'Acme Foods', status: 'active' },
    health: { total_score: 71.4, period_month: '2026-09-01' },
    open_work: { open_task_count: 3, projects: [{ name: 'Q3 launch', kind: 'project', status: 'in_progress', owner: 'Lee', ends_at: '2026-10-01' }], tasks: [{ title: 'Draft pitch', assignee: 'Sam', due_at: '2026-09-12', status: 'todo' }] },
    recent_calls: [{ occurred_at: '2026-09-08T15:00:00Z', call_type: 'check-in', duration_minutes: 30, score: 8, summary: 'Client happy with placements.' }],
    live_links: [{ outlet: 'Forbes', headline: 'Acme rises', live_date: '2026-09-05', is_national: true }],
    candidates: [{ display_name: 'Acme Foods' }, { display_name: 'Acme Farms' }],
  });
  assert.match(md, /\*\*Acme Foods\*\* · active · health 71 \(2026-09-01\)/);
  assert.match(md, /3 open tasks across 1 active item/);
  assert.match(md, /Q3 launch \(project\) — in_progress, Lee, due 2026-10-01/);
  assert.match(md, /2026-09-08 check-in, 30 min, score 8 — Client happy/);
  assert.match(md, /Forbes — Acme rises \(national\)/);
  assert.match(md, /Also matched: Acme Farms/);
});
