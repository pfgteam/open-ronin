// /clients/tickets — list of client tickets (org-aware, matches other list pages).
//
// URL-driven filters: ?org=<slug>&status=<slug>&priority=<slug>&assignee=<id>&q=<search>
// Matches the filter pattern used by /the-work/client-work and /the-work/priorities
// (comma-separated accumulative values, server-side PostgREST filter, not client-side).

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { createClient } from '@/lib/supabase/server';
import ClientTicketsList from './ClientTicketsList';

export const metadata = { title: 'Client Tickets' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    org?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    q?: string;
    client?: string;
    view?: string;
  }>;
}

function splitParam(v?: string): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

const STATUS_ORDER = ['open', 'in_progress', 'waiting_on_client', 'resolved', 'closed'] as const;
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_client: 'Waiting on client',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export default async function ClientTicketsPage({ searchParams }: PageProps) {
  const {
    org: orgParam,
    status: statusParam,
    priority: priorityParam,
    assignee: assigneeParam,
    q: qParam,
    client: clientParam,
  } = await searchParams;

  const filterOrg = splitParam(orgParam);
  const filterStatus = splitParam(statusParam);
  const filterPriority = splitParam(priorityParam);
  const filterAssignee = splitParam(assigneeParam);
  const filterClient = splitParam(clientParam);
  const search = (qParam ?? '').trim();

  const supabase = await createClient();

  // Base query. Pull org_slug + assignee display name so the list can render
  // org filters and the assignee chip without a second round trip per row.
  const base = supabase
    .from('client_tickets_view')
    .select(`id, client_id, client_display_name, contact_id, contact_display_name,
            org_tag_id, org_slug, kind, status, priority, assignee_id,
            assignee_display_name, is_assigned_to_me, linked_task_id,
            linked_conversation_id, created_by, created_at, updated_at`)
    .order('created_at', { ascending: false });

  if (filterOrg.length > 0) base.in('org_slug', filterOrg);
  if (filterStatus.length > 0) base.in('status', filterStatus);
  if (filterPriority.length > 0) base.in('priority', filterPriority);
  if (filterAssignee.length > 0) base.in('assignee_id', filterAssignee);
  if (filterClient.length > 0) base.in('client_id', filterClient);

  // Text search over the two names (PostgREST ilike chain).
  if (search.length > 0) {
    base.or(`client_display_name.ilike.%${search},contact_display_name.ilike.%${search}`);
  }

  const { data: rows } = await base.limit(500);

  // Distinct filter options for the filter chips (same shape as other list pages).
  const [orgOptions, statusOptions, priorityOptions, assigneeOptions, clientOptions] =
    await Promise.all([
      supabase
        .from('tags')
        .select('slug, label')
        .eq('category', 'org')
        .order('position'),
      Promise.resolve(
        STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))
      ),
      Promise.resolve(
        ['urgent', 'high', 'medium', 'low'].map((p) => ({
          value: p,
          label: PRIORITY_LABELS[p] ?? p,
        }))
      ),
      supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('is_active', true)
        .order('first_name'),
      supabase
        .from('clients_v2')
        .select('id, display_name')
        .order('display_name'),
    ]);

  const itemList = (rows ?? []) as Array<{
    id: string;
    client_id: string;
    client_display_name: string | null;
    contact_id: string | null;
    contact_display_name: string | null;
    org_tag_id: string | null;
    org_slug: string | null;
    kind: string;
    status: string;
    priority: string | null;
    assignee_id: string | null;
    assignee_display_name: string | null;
    is_assigned_to_me: boolean;
    linked_task_id: string | null;
    linked_conversation_id: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
  }>;

  const orgRows = (orgOptions.data ?? []) as Array<{ slug: string; label: string }>;
  const assigneeRows = (assigneeOptions.data ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
  }>;
  const clientRows = (clientOptions.data ?? []) as Array<{
    id: string;
    display_name: string | null;
  }>;

  const orgFilterItems = orgRows.map((o) => ({
    value: o.slug,
    label: o.label,
    count:
      itemList.filter((r) => r.org_slug === o.slug).length,
  }));
  const statusFilterItems = statusOptions.map((s) => ({
    ...s,
    count: itemList.filter((r) => r.status === s.value).length,
  }));
  const priorityFilterItems = priorityOptions.map((p) => ({
    ...p,
    count: itemList.filter((r) => r.priority === p.value).length,
  }));
  const assigneeFilterItems = assigneeRows.map((a) => ({
    value: a.id,
    label: a.first_name && a.last_name ? `${a.first_name} ${a.last_name}` : a.first_name ?? a.id,
    count:
      itemList.filter((r) => r.assignee_id === a.id).length +
      (a.id === '' ? 0 : 0),
  }));
  const clientFilterItems = clientRows
    .filter((c) => c.display_name)
    .map((c) => ({
      value: c.id,
      label: c.display_name ?? c.id,
      count: itemList.filter((r) => r.client_id === c.id).length,
    }));

  const totals = {
    open: itemList.filter((r) => r.status === 'open').length,
    in_progress: itemList.filter((r) => r.status === 'in_progress').length,
    waiting_on_client: itemList.filter((r) => r.status === 'waiting_on_client').length,
    resolved: itemList.filter((r) => r.status === 'resolved').length,
    closed: itemList.filter((r) => r.status === 'closed').length,
    me: itemList.filter((r) => r.is_assigned_to_me).length,
  };

  return (
    <>
      <PageHeader
        title="Client Tickets"
        description={`${itemList.length} tickets · internal filing only (no client portal yet)`}
      />
      <Card className="mb-6">
        <ClientTicketsList
          items={itemList}
          orgFilter={filterOrg}
          statusFilter={filterStatus}
          priorityFilter={filterPriority}
          assigneeFilter={filterAssignee}
          clientFilter={filterClient}
          search={search}
          orgFilterItems={orgFilterItems}
          statusFilterItems={statusFilterItems}
          priorityFilterItems={priorityFilterItems}
          assigneeFilterItems={assigneeFilterItems}
          clientFilterItems={clientFilterItems}
          totals={totals}
        />
      </Card>
    </>
  );
}
