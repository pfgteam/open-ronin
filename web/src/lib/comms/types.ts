// Row shapes for the comms_* PostgREST views and the profile picker.
// These mirror the SQL views one-to-one; keep them in sync with the migration
// rather than inventing client-side fields.

export type ConversationKind =
	| 'channel'
	| 'dm'
	| 'group'
	| 'client_thread'
	| 'contact_thread'
	| 'ticket_thread';

export type ConversationAudience = 'internal' | 'client' | 'external';

export interface Conversation {
	id: string;
	kind: ConversationKind;
	audience: ConversationAudience;
	slug: string | null;
	title: string | null;
	topic: string | null;
	client_id: string | null;
	contact_id: string | null;
	work_item_id: string | null;
	is_private: boolean;
	created_by: string | null;
	created_at: string;
	updated_at: string;
	last_message_at: string | null;
	archived_at: string | null;
	/** False for public internal channels the viewer can see but hasn't joined. */
	is_member: boolean;
	participant_count: number;
	unread_count: number;
	last_message_preview: string | null;
}

export type ParticipantType = 'user' | 'client_contact' | 'external_contact' | 'agent' | 'external_app';

export interface Participant {
	id: string;
	conversation_id: string;
	participant_type: ParticipantType;
	profile_id: string | null;
	contact_id: string | null;
	agent_identity_slug: string | null;
	external_app: string | null;
	role: string | null;
	notify_level: string | null;
	joined_at: string;
	left_at: string | null;
	last_read_at: string | null;
	display_name: string | null;
	avatar_url: string | null;
	subtitle: string | null;
}

export type MessageVisibility = 'all' | 'staff_only';

/** Agent messages may carry an audit trail; anything else is opaque. */
export interface MessagePayload {
	agent?: string;
	audit_id?: string;
	why?: unknown;
	failure?: boolean;
	[key: string]: unknown;
}

export interface Message {
	id: string;
	conversation_id: string;
	sender_participant_id: string | null;
	connection_id: string | null;
	body: string;
	body_format: string;
	payload: MessagePayload | null;
	direction: string | null;
	visibility: MessageVisibility;
	provider: string;
	provider_message_id: string | null;
	in_reply_to_message_id: string | null;
	attachments: unknown[] | null;
	sent_at: string;
	edited_at: string | null;
	deleted_at: string | null;
	sender_type: ParticipantType | null;
	sender_profile_id: string | null;
	sender_agent_slug: string | null;
	sender_name: string | null;
	sender_avatar_url: string | null;
	is_mine: boolean;
	/** Client-only: set on optimistic rows until the server echo replaces them. */
	pending?: boolean;
}

export interface Agent {
	slug: string;
	display_name: string;
	blurb: string | null;
	avatar_url: string | null;
	conversation_kinds: string[] | null;
	tier: string | null;
	enabled: boolean;
}

export interface ProfileOption {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	photo_url: string | null;
	avatar_url: string | null;
	title: string | null;
}

export function profileName(p: ProfileOption): string {
	const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
	return name || p.email;
}
