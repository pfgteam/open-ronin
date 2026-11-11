// The work-item detail page's Activity card merges four separate histories
// (status changes, health updates, comments, attachments) plus the item's
// own creation into one chronological feed. This is that merge, pulled out
// so it can be unit-tested without a database or React — the rendering task
// calls composeActivity() and hands the result straight to the card.
//
// Pure by construction: every timestamp comes from the caller. No
// Date.now(), no formatting of "3h ago" (that is formatRelative's job in
// web/src/lib/format.ts) — this only decides WHAT happened and WHEN, sorted
// newest-first.

export type ActivityTone = 'success' | 'primary' | 'default';

export interface ActivityEntry {
	tone: ActivityTone;
	text: string;
	at: string;
}

interface StatusLogEntry {
	from_status: string | null;
	to_status: string;
	created_at: string;
	actorName: string | null;
}

interface UpdateEntry {
	health: string;
	created_at: string;
	authorName: string | null;
}

interface CommentEntry {
	created_at: string;
	authorName: string | null;
}

interface AttachmentEntry {
	file_name: string | null;
	is_deliverable: boolean;
	created_at: string;
	uploaderName: string | null;
}

export interface ComposeActivityInput {
	createdAt: string;
	createdByName: string | null;
	parentName: string | null;
	statusLog: StatusLogEntry[];
	updates: UpdateEntry[];
	comments: CommentEntry[];
	attachments: AttachmentEntry[];
}

// Health arrives as a raw slug (no label field on the update row), so this
// is the one spot allowed to prettify — everywhere else (status strings)
// the caller already hands over a human label, per the brief.
function healthLabel(health: string): string {
	switch (health) {
		case 'on_track':
			return 'On track';
		case 'at_risk':
			return 'At risk';
		case 'off_track':
			return 'Off track';
		default:
			return health.replace(/_/g, ' ');
	}
}

// Internal entry shape carries a `kind` so ties on `at` (same millisecond,
// different histories) sort deterministically instead of depending on
// object insertion order. The order below is otherwise an arbitrary but
// fixed choice: comment, attachment, update, status, then creation — creation
// only competes on a tie if some other event shares its exact timestamp.
const KIND_ORDER = ['comment', 'attachment', 'update', 'status', 'creation'] as const;
type Kind = (typeof KIND_ORDER)[number];

interface RankedEntry extends ActivityEntry {
	kind: Kind;
}

export function composeActivity(input: ComposeActivityInput): ActivityEntry[] {
	const entries: RankedEntry[] = [];

	for (const s of input.statusLog) {
		entries.push({
			kind: 'status',
			tone: 'primary',
			text: `Status: ${s.from_status ?? 'New'} → ${s.to_status}`,
			at: s.created_at,
		});
	}

	for (const u of input.updates) {
		entries.push({
			kind: 'update',
			tone: u.health === 'on_track' ? 'success' : 'primary',
			text: `Update: ${healthLabel(u.health)}`,
			at: u.created_at,
		});
	}

	for (const c of input.comments) {
		entries.push({
			kind: 'comment',
			tone: 'default',
			text: c.authorName ? `Comment from ${c.authorName}` : 'Comment',
			at: c.created_at,
		});
	}

	for (const a of input.attachments) {
		const name = a.file_name ?? 'a file';
		const from = a.uploaderName ? ` from ${a.uploaderName}` : '';
		entries.push({
			kind: 'attachment',
			tone: a.is_deliverable ? 'success' : 'default',
			text: a.is_deliverable ? `Deliverable: ${name}${from}` : `Attachment: ${name}${from}`,
			at: a.created_at,
		});
	}

	const creationText = input.createdByName
		? input.parentName
			? `Created by ${input.createdByName} in ${input.parentName}`
			: `Created by ${input.createdByName}`
		: 'Created';
	entries.push({
		kind: 'creation',
		tone: 'default',
		text: creationText,
		at: input.createdAt,
	});

	entries.sort((x, y) => {
		if (x.at !== y.at) return x.at < y.at ? 1 : -1;
		return KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind);
	});

	return entries.map((e) => ({ tone: e.tone, text: e.text, at: e.at }));
}
