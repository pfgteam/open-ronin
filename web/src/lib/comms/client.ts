'use client';

// Browser-side helpers for the comms views + RPCs. Every query filters
// explicitly (defense in depth, same rule as NotificationBell): RLS decides
// what the viewer may see, but the client still says what it wants.

import { createClient } from '@/lib/supabase/client';
import type { Agent, Conversation, Message, Participant, ProfileOption } from './types';

export const INITIAL_MESSAGE_LIMIT = 200;

const CONVERSATION_COLUMNS =
	'id, kind, audience, slug, title, topic, client_id, contact_id, work_item_id, is_private, created_by, created_at, updated_at, last_message_at, archived_at, is_member, participant_count, unread_count, last_message_preview';

const PARTICIPANT_COLUMNS =
	'id, conversation_id, participant_type, profile_id, contact_id, agent_identity_slug, external_app, role, notify_level, joined_at, left_at, last_read_at, display_name, avatar_url, subtitle';

const MESSAGE_COLUMNS =
	'id, conversation_id, sender_participant_id, connection_id, body, body_format, payload, direction, visibility, provider, provider_message_id, in_reply_to_message_id, attachments, sent_at, edited_at, deleted_at, sender_type, sender_profile_id, sender_agent_slug, sender_name, sender_avatar_url, is_mine';

function fail(context: string, error: { message: string } | null): never {
	throw new Error(`${context}: ${error?.message ?? 'unknown error'}`);
}

/** Everything the viewer can see: member conversations + public internal channels. */
export async function listConversations(): Promise<Conversation[]> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('comms_conversations')
		.select(CONVERSATION_COLUMNS)
		.is('archived_at', null)
		.order('last_message_at', { ascending: false, nullsFirst: false });
	if (error) fail('listConversations', error);
	return (data ?? []) as unknown as Conversation[];
}

export async function getConversation(id: string): Promise<Conversation | null> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('comms_conversations')
		.select(CONVERSATION_COLUMNS)
		.eq('id', id)
		.maybeSingle();
	if (error) fail('getConversation', error);
	return (data as unknown as Conversation | null) ?? null;
}

export async function listParticipants(conversationId: string): Promise<Participant[]> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('comms_participants')
		.select(PARTICIPANT_COLUMNS)
		.eq('conversation_id', conversationId)
		.is('left_at', null)
		.order('joined_at', { ascending: true });
	if (error) fail('listParticipants', error);
	return (data ?? []) as unknown as Participant[];
}

/** First page: the most recent INITIAL_MESSAGE_LIMIT rows, returned oldest → newest. */
export async function listMessages(conversationId: string): Promise<Message[]> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('comms_messages')
		.select(MESSAGE_COLUMNS)
		.eq('conversation_id', conversationId)
		.is('deleted_at', null)
		.order('sent_at', { ascending: false })
		.limit(INITIAL_MESSAGE_LIMIT);
	if (error) fail('listMessages', error);
	return ((data ?? []) as unknown as Message[]).reverse();
}

/** Incremental poll: rows newer than the last one we hold, oldest → newest. */
export async function listMessagesAfter(conversationId: string, afterSentAt: string): Promise<Message[]> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('comms_messages')
		.select(MESSAGE_COLUMNS)
		.eq('conversation_id', conversationId)
		.is('deleted_at', null)
		.gt('sent_at', afterSentAt)
		.order('sent_at', { ascending: true })
		.limit(INITIAL_MESSAGE_LIMIT);
	if (error) fail('listMessagesAfter', error);
	return (data ?? []) as unknown as Message[];
}

export async function listAgents(): Promise<Agent[]> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('comms_agents')
		.select('slug, display_name, blurb, avatar_url, conversation_kinds, tier, enabled')
		.eq('enabled', true)
		.order('display_name', { ascending: true });
	if (error) fail('listAgents', error);
	return (data ?? []) as unknown as Agent[];
}

export async function listActiveProfiles(): Promise<ProfileOption[]> {
	const supabase = createClient();
	const { data, error } = await supabase
		.from('profiles')
		.select('id, first_name, last_name, email, photo_url, avatar_url, title')
		.eq('is_active', true)
		.order('first_name', { ascending: true });
	if (error) fail('listActiveProfiles', error);
	return (data ?? []) as ProfileOption[];
}

// ---- RPCs ------------------------------------------------------------------

export interface CreateConversationInput {
	kind: 'channel' | 'dm' | 'group';
	title: string;
	slug?: string | null;
	isPrivate?: boolean;
	memberIds?: string[];
	agentSlugs?: string[];
	clientId?: string | null;
}

export async function createConversation(input: CreateConversationInput): Promise<string> {
	const supabase = createClient();
	const { data, error } = await supabase.rpc('comms_create_conversation', {
		p_kind: input.kind,
		p_title: input.title,
		p_slug: input.slug ?? null,
		p_is_private: input.isPrivate ?? false,
		p_member_ids: input.memberIds ?? [],
		p_agent_slugs: input.agentSlugs ?? [],
		p_client_id: input.clientId ?? null,
	});
	if (error) fail('createConversation', error);
	return data as string;
}

export async function sendMessage(input: {
	conversationId: string;
	body: string;
	inReplyTo?: string | null;
	visibility?: 'all' | 'staff_only';
	mentions?: string[] | null;
}): Promise<string> {
	const supabase = createClient();
	const { data, error } = await supabase.rpc('comms_send_message', {
		p_conversation_id: input.conversationId,
		p_body: input.body,
		p_in_reply_to: input.inReplyTo ?? null,
		p_visibility: input.visibility ?? 'all',
		p_mentions: input.mentions && input.mentions.length > 0 ? input.mentions : null,
	});
	if (error) fail('sendMessage', error);
	return data as string;
}

export async function addAgent(conversationId: string, agentSlug: string): Promise<string> {
	const supabase = createClient();
	const { data, error } = await supabase.rpc('comms_add_agent', {
		p_conversation_id: conversationId,
		p_agent_slug: agentSlug,
	});
	if (error) fail('addAgent', error);
	return data as string;
}

export async function addMember(conversationId: string, profileId: string): Promise<string> {
	const supabase = createClient();
	const { data, error } = await supabase.rpc('comms_add_member', {
		p_conversation_id: conversationId,
		p_profile_id: profileId,
	});
	if (error) fail('addMember', error);
	return data as string;
}

export async function joinConversation(conversationId: string): Promise<string> {
	const supabase = createClient();
	const { data, error } = await supabase.rpc('comms_join_conversation', {
		p_conversation_id: conversationId,
	});
	if (error) fail('joinConversation', error);
	return data as string;
}

/** Without an agent slug the viewer leaves; with one, that agent is removed. */
export async function leaveConversation(conversationId: string, agentSlug: string | null = null): Promise<boolean> {
	const supabase = createClient();
	const { data, error } = await supabase.rpc('comms_leave_conversation', {
		p_conversation_id: conversationId,
		p_agent_slug: agentSlug,
	});
	if (error) fail('leaveConversation', error);
	return Boolean(data);
}

/** Best-effort: a failed mark-read only means the badge lingers until the next poll. */
export async function markRead(conversationId: string): Promise<void> {
	const supabase = createClient();
	await supabase.rpc('comms_mark_read', { p_conversation_id: conversationId });
}
