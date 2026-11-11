'use client';

import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import { useState } from 'react';

// Lightweight status + priority chips matching UI_GUIDELINES (colored dot +
// humanized label in text-2xs, not a solid pill).
function StatusDot({ status }: { status: string }) {
  const color =
    status === 'open'
      ? 'bg-green-500'
      : status === 'in_progress'
      ? 'bg-primary-500'
      : status === 'waiting_on_client'
      ? 'bg-amber-500'
      : status === 'resolved'
      ? 'bg-slate-400'
      : 'bg-slate-300 dark:bg-slate-600';
  const label =
    status === 'open'
      ? 'Open'
      : status === 'in_progress'
      ? 'In progress'
      : status === 'waiting_on_client'
      ? 'Waiting on client'
      : status === 'resolved'
      ? 'Resolved'
      : 'Closed';
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-slate-600 dark:text-slate-400">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function PriorityChip({ priority }: { priority: string | null | undefined }) {
  if (!priority) return <span className="text-2xs text-slate-400">—</span>;
  const color =
    priority === 'urgent'
      ? 'text-red-700 dark:text-red-300'
      : priority === 'high'
      ? 'text-amber-700 dark:text-amber-300'
      : priority === 'medium'
      ? 'text-primary-700 dark:text-primary-300'
      : 'text-slate-600 dark:text-slate-400';
  return (
    <span className={`text-2xs font-medium uppercase tracking-wide ${color}`}>
      {priority}
    </span>
  );
}

interface FilterItem {
  value: string;
  label: string;
  count: number;
}

interface Props {
  items: Array<{
    id: string;
    client_display_name: string | null;
    contact_display_name: string | null;
    org_slug: string | null;
    kind: string;
    status: string;
    priority: string | null;
    assignee_display_name: string | null;
    is_assigned_to_me: boolean;
    linked_task_id: string | null;
    linked_conversation_id: string | null;
    created_at: string;
  }>;
  orgFilter: string[];
  statusFilter: string[];
  priorityFilter: string[];
  assigneeFilter: string[];
  clientFilter: string[];
  search: string;
  orgFilterItems: FilterItem[];
  statusFilterItems: FilterItem[];
  priorityFilterItems: FilterItem[];
  assigneeFilterItems: FilterItem[];
  clientFilterItems: FilterItem[];
  totals: {
    open: number;
    in_progress: number;
    waiting_on_client: number;
    resolved: number;
    closed: number;
    me: number;
  };
}

export default function ClientTicketsList({
  items,
  orgFilter,
  statusFilter,
  priorityFilter,
  assigneeFilter,
  clientFilter,
  search,
  orgFilterItems,
  statusFilterItems,
  priorityFilterItems,
  assigneeFilterItems,
  clientFilterItems,
  totals,
}: Props) {
  const [localSearch, setLocalSearch] = useState(search);

  const clearFilters = () => {
    const params = new URLSearchParams(window.location.search);
    ['org', 'status', 'priority', 'assignee', 'client', 'q'].forEach((k) => params.delete(k));
    window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`);
    window.location.reload();
  };

  const anyFilter =
    orgFilter.length > 0 ||
    statusFilter.length > 0 ||
    priorityFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    clientFilter.length > 0 ||
    localSearch.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search clients, contacts..."
          value={localSearch}
          onChange={(e) => {
            setLocalSearch(e.target.value);
            const params = new URLSearchParams(window.location.search);
            if (e.target.value) params.set('q', e.target.value);
            else params.delete('q');
            window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`);
            window.location.reload();
          }}
          className="w-48"
        />

        <Select
          size="sm"
          value={clientFilter.join(',')}
          onChange={(e) => {
            const v = e.target.value;
            const params = new URLSearchParams(window.location.search);
            if (v) params.set('client', v);
            else params.delete('client');
            window.location.href = `${window.location.pathname}?${params.toString()}`;
          }}
        >
          <option value="">All clients</option>
          {clientFilterItems.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} ({c.count})
            </option>
          ))}
        </Select>

        <Select
          size="sm"
          value={orgFilter.join(',')}
          onChange={(e) => {
            const v = e.target.value;
            const params = new URLSearchParams(window.location.search);
            if (v) params.set('org', v);
            else params.delete('org');
            window.location.href = `${window.location.pathname}?${params.toString()}`;
          }}
        >
          <option value="">All orgs</option>
          {orgFilterItems.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </Select>

        <Select
          size="sm"
          value={statusFilter.join(',')}
          onChange={(e) => {
            const v = e.target.value;
            const params = new URLSearchParams(window.location.search);
            if (v) params.set('status', v);
            else params.delete('status');
            window.location.href = `${window.location.pathname}?${params.toString()}`;
          }}
        >
          <option value="">All statuses</option>
          {statusFilterItems.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({s.count})
            </option>
          ))}
        </Select>

        <Select
          size="sm"
          value={priorityFilter.join(',')}
          onChange={(e) => {
            const v = e.target.value;
            const params = new URLSearchParams(window.location.search);
            if (v) params.set('priority', v);
            else params.delete('priority');
            window.location.href = `${window.location.pathname}?${params.toString()}`;
          }}
        >
          <option value="">All priorities</option>
          {priorityFilterItems.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label} ({p.count})
            </option>
          ))}
        </Select>

        <Select
          size="sm"
          value={assigneeFilter.join(',')}
          onChange={(e) => {
            const v = e.target.value;
            const params = new URLSearchParams(window.location.search);
            if (v) params.set('assignee', v);
            else params.delete('assignee');
            window.location.href = `${window.location.pathname}?${params.toString()}`;
          }}
        >
          <option value="">All assignees</option>
          <option value="me">Me ({totals.me})</option>
          {assigneeFilterItems.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label} ({a.count})
            </option>
          ))}
        </Select>

        {anyFilter && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Counts */}
      <div className="flex flex-wrap gap-4 text-2xs text-slate-500">
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{totals.open}</span> open
        </span>
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{totals.in_progress}</span> in progress
        </span>
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{totals.waiting_on_client}</span> waiting on client
        </span>
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{totals.resolved}</span> resolved
        </span>
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-300">{totals.closed}</span> closed
        </span>
        {totals.me > 0 && (
          <span className="ml-auto">
            <span className="font-medium text-primary-700 dark:text-primary-300">{totals.me}</span> assigned to me
          </span>
        )}
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <Card className="py-8 text-center text-sm text-slate-500">
          {anyFilter ? 'No tickets match the current filters.' : 'No tickets yet.'}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {items.map((t) => (
              <div
                key={t.id}
                className="px-4 py-3 hover:bg-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {t.client_display_name ?? 'Unknown client'}
                      </span>
                      {t.contact_display_name && (
                        <span className="text-2xs text-slate-500">· {t.contact_display_name}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-2xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                        {t.kind}
                      </span>
                      {t.org_slug && (
                        <>
                          <span className="text-slate-300 dark:text-slate-600"> · </span>
                          <span>{t.org_slug.replace(/^org-/, '')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <PriorityChip priority={t.priority} />
                    <StatusDot status={t.status} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-4 text-2xs text-slate-500">
                  {t.assignee_display_name ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                      {t.assignee_display_name}
                      {t.is_assigned_to_me && (
                        <span className="text-primary-600 dark:text-primary-400">(you)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-400">Unassigned</span>
                  )}
                  {t.linked_task_id && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span>Linked task</span>
                    </>
                  )}
                  {t.linked_conversation_id && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span>Thread open</span>
                    </>
                  )}
                  <span>{new Date(t.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Scope note */}
      <p className="text-2xs text-slate-400 pt-2">
        Tickets are filed by staff on a client&apos;s behalf. Client self-filing is comms portal scope, not built yet.
      </p>
    </div>
  );
}
