'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function createClientTicket({
  clientId,
  contactId,
  kind,
  priority,
}: {
  clientId: string;
  contactId?: string | null;
  kind: 'bug' | 'question' | 'request' | 'billing' | 'other';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('client_ticket_create', {
    p_client_id: clientId,
    p_contact_id: contactId ?? null,
    p_kind: kind,
    p_priority: (priority ?? 'medium') as 'urgent' | 'high' | 'medium' | 'low',
  });
  if (error) return { error: error.message };
  revalidatePath('/clients/tickets');
  return { ticketId: (data as string) ?? null };
}

export async function assignClientTicket({
  ticketId,
  assigneeId,
  linkedTaskId,
}: {
  ticketId: string;
  assigneeId?: string | null;
  linkedTaskId?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('client_ticket_assign', {
    p_id: ticketId,
    p_assignee_id: assigneeId ?? null,
    p_linked_task_id: linkedTaskId ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath('/clients/tickets');
  revalidatePath('/the-work/my-work');
  return { ok: true };
}

export async function updateTicketStatus({
  ticketId,
  status,
}: {
  ticketId: string;
  status: 'open' | 'in_progress' | 'waiting_on_client' | 'resolved' | 'closed';
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('client_ticket_update_status', {
    p_id: ticketId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath('/clients/tickets');
  return { ok: true };
}

export async function createTicketConversation({
  ticketId,
  title,
}: {
  ticketId: string;
  title?: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('client_ticket_create_conversation', {
    p_ticket_id: ticketId,
    p_title: title ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath('/clients/tickets');
  return { conversationId: (data as string) ?? null };
}
