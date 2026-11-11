// Meeting-prep email parsers (t_98fa6769, migration 0150).
//
// Alex's live per-meeting source is AlterCall: one "Your VITA/LARA Scores
// Are In" email per processed Zoom session, sent to owner@example.com
// (Zoom cloud recording is off for his account, and Read AI only sends a
// weekly digest and joins no meetings any more). Two shapes exist:
//
//   host        "Alex Morgan, your latest session, <TITLE>, has been processed"
//               link altercall.ai/host/session/<KEY>
//   participant "Hi Alex Morgan, the session <TITLE> has been processed"
//               link altercall.ai/participant/session/<KEY>
//
// <KEY> = <Host>.<Host>_<P1>__<P2>__…_<TitleSlug>.<YYYY-MM-DDTHH-MM-SS-mmmZ>Z.<zoomUuid>.zoom
// where every non [A-Za-z0-9] character of a name or the title is replaced by
// ONE underscore (so "Toni" -> "Ta_za", "A+P" -> "A_P"), participants are
// joined by exactly two underscores, and the link is URL-encoded twice inside
// an awstrack redirect. The timestamp is when AlterCall finished the session
// (about the end of the meeting); the uuid is Zoom's meeting instance uuid,
// the same id /api/ingest/sessions stores as external_call_id 'zoom:<uuid>'.
//
// Pure functions only: no I/O, no Supabase. The SQL side (meeting_ingest_altercall)
// does matching, linking and typing so it runs in one transaction.

export const MEETING_EMAIL_SOURCES = ['altercall', 'read_ai'] as const;
export type MeetingEmailSource = (typeof MEETING_EMAIL_SOURCES)[number];

export const MEETING_EMAIL_SENDERS: Record<string, MeetingEmailSource> = {
	'noreply@altercallai.com': 'altercall',
	'support@altercall.com': 'altercall',
	'executiveassistant@e.read.ai': 'read_ai',
};

export type AlterCallScore = { label: string; delta: number | null; deltaPct: number | null };

export type AlterCallSession = {
	kind: 'session';
	role: 'host' | 'participant';
	title: string;
	sessionKey: string | null;
	zoomUuid: string | null;
	recordedAt: string | null; // ISO
	hostName: string | null; // display form, "Alex Morgan"
	recipientName: string | null; // whose inbox it landed in, from the greeting
	participantKeys: string[]; // raw underscored form, "Toni_Keller"
	participantNames: string[]; // display form, "Toni Keller"
	scoreKind: 'LARA' | 'VITA' | null;
	scores: AlterCallScore[];
	items: Array<{ text: string; ownerName: string | null }>;
};

export type ParsedMeetingEmail =
	| AlterCallSession
	| { kind: 'weekly_digest'; source: MeetingEmailSource; meetings: ReadAiDigestMeeting[] }
	| { kind: 'other'; source: MeetingEmailSource; reason: string };

export type ReadAiDigestMeeting = {
	title: string;
	whenText: string;
	actionItems: number | null;
	questions: number | null;
	summaryTeaser: string | null;
};

/** Names AlterCall puts in the participant list that are not people. */
const NOT_A_PERSON = /^(Open Ronin|unknown client|read ai meeting notes|virtual coach|notetaker|otter ai|fireflies ai|(\S+ s )?(iphone|ipad|android|galaxy)( \d+)?)$/i;

const ENTITY: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
	ndash: '–', mdash: '—', hellip: '…',
};

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
		if (code[0] === '#') {
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) ? String.fromCodePoint(n) : m;
		}
		return ENTITY[code.toLowerCase()] ?? m;
	});
}

/** HTML email body -> plain text with one line per block, list items as "- ". */
export function htmlToText(html: string): string {
	let s = html.replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
	s = s.replace(/<br\s*\/?>/gi, '\n');
	s = s.replace(/<li[^>]*>/gi, '\n- ');
	s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|td)>/gi, '\n');
	s = s.replace(/<[^>]+>/g, ' ');
	s = decodeEntities(s);
	s = s.replace(/[\u00a0\u200b\u200c\u034f\u00ad]/g, ' ');
	return s
		.split('\n')
		.map((l) => l.replace(/[ \t\r]+/g, ' ').trim())
		.filter((l) => l.length > 0)
		.join('\n');
}

/** "Nicholas Mercer X Jamie" etc. -> the AlterCall slug "Nicholas_Mercer_X_Jamie". */
export function alterCallSlug(s: string): string {
	return s.replace(/[^A-Za-z0-9]/g, '_');
}

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** Finds the session link and returns its decoded key + role. */
export function findSessionLink(html: string): { role: 'host' | 'participant'; key: string } | null {
	const m = /altercall\.ai(?:%2F|\/)(host|participant)(?:%2F|\/)session(?:%2F|\/)([^/"'\s<>]+)/i.exec(html);
	if (!m) return null;
	// Inside the awstrack redirect the key is encoded twice (%253D -> %3D -> =).
	let key = decodeEntities(m[2]);
	for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(key); i++) key = safeDecode(key);
	return { role: m[1].toLowerCase() as 'host' | 'participant', key };
}

/**
 * Splits an AlterCall session key. `title` (from the email body) lets us cut the
 * title slug off the participant segment, which is otherwise ambiguous when
 * there is only one participant ("Alex_Morgan_Sam_Carter_Gabe_1_1").
 */
export function parseSessionKey(key: string, title: string | null): {
	hostKey: string | null;
	participantKeys: string[];
	recordedAt: string | null;
	zoomUuid: string | null;
} {
	const tsRe = /\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z+\./;
	const ts = tsRe.exec(key);
	if (!ts) return { hostKey: null, participantKeys: [], recordedAt: null, zoomUuid: null };
	const head = key.slice(0, ts.index);
	const tail = key.slice(ts.index + ts[0].length);
	const recordedAt = `${ts[1]}T${ts[2]}:${ts[3]}:${ts[4]}.${(ts[5] ?? '0').padEnd(3, '0')}Z`;
	const zoomUuid = tail.replace(/\.zoom$/i, '') || null;

	const dot = head.indexOf('.');
	const hostKey = dot > 0 ? head.slice(0, dot) : null;
	let rest = dot > 0 ? head.slice(dot + 1) : head;
	if (hostKey && rest.startsWith(`${hostKey}_`)) rest = rest.slice(hostKey.length + 1);
	else if (hostKey && rest === hostKey) rest = '';
	// A Zoom topic with a trailing space leaves a trailing underscore.
	rest = rest.replace(/_+$/, '');
	if (title) {
		const slug = alterCallSlug(title.trim()).replace(/^_+|_+$/g, '');
		if (rest === slug) rest = '';
		else if (rest.endsWith(`_${slug}`)) rest = rest.slice(0, -(slug.length + 1));
	}
	// Participants are joined by exactly two underscores; a run of three or
	// more ("Cal___Open_Ronin") belongs to one name.
	const seen = new Set<string>();
	const participantKeys: string[] = [];
	for (const raw of rest.split(/(?<!_)__(?!_)/)) {
		const k = raw.replace(/^_+|_+$/g, '');
		if (!k || k === hostKey) continue;
		const display = keyToName(k);
		if (NOT_A_PERSON.test(display)) continue;
		if (seen.has(k.toLowerCase())) continue;
		seen.add(k.toLowerCase());
		participantKeys.push(k);
	}
	return { hostKey, participantKeys, recordedAt, zoomUuid };
}

export function keyToName(k: string): string {
	// "Cal___Open_Ronin" is "Cal | Open Ronin": keep the person part.
	const person = k.split(/_{3,}/)[0];
	return person.replace(/_+/g, ' ').trim();
}

const OWNER_RE = /^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3})\s+(?:to|will|should|needs to|must)\s+\S/u;

const tokens = (s: string) =>
	s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

/**
 * "Jamie Rivera to share the deck…" -> "Jamie Rivera". The candidate only
 * counts when every one of its words is a word of somebody on the call, which
 * is what keeps imperatives out ("Contact Jamie to confirm…" starts with
 * "Contact", nobody on the call is called Contact). AlterCall replaces accented
 * letters in names with "_", so "Ta za" still matches "Toni" only through
 * the SQL matcher, not here; such items fall back to the host.
 */
export function ownerFromItem(text: string, knownNames: string[]): string | null {
	const m = OWNER_RE.exec(text.trim());
	if (!m) return null;
	const known = new Set(knownNames.flatMap(tokens));
	const cand = tokens(m[1]);
	if (cand.length === 0 || !cand.every((t) => known.has(t))) return null;
	return m[1];
}

function parseScores(lines: string[], start: number, end: number): AlterCallScore[] {
	const out: AlterCallScore[] = [];
	const num = (s: string) => {
		const m = /^([+-]?\d+(?:\.\d+)?)%?$/.exec(s.replace(/\s+/g, ''));
		return m ? Number(m[1]) : null;
	};
	for (let i = start; i + 2 < end; i++) {
		const a = lines[i];
		const b = lines[i + 1];
		const label = lines[i + 2];
		if (/^[+-]?(\d+|-)$/.test(a.replace(/\s+/g, '')) && /%$/.test(b) && /^[A-Z][A-Za-z /]+$/.test(label)) {
			out.push({ label, delta: num(a), deltaPct: num(b) });
			i += 2;
		}
	}
	return out;
}

/** Parse one AlterCall email. `html` is the text/html part. */
export function parseAlterCallEmail(subject: string, html: string): ParsedMeetingEmail {
	const scoreKind = /\b(LARA|VITA)\s+Scores\b/i.exec(subject)?.[1]?.toUpperCase() as 'LARA' | 'VITA' | undefined;
	if (!scoreKind) return { kind: 'other', source: 'altercall', reason: `not a session email: ${subject.slice(0, 80)}` };

	const text = htmlToText(html);
	const lines = text.split('\n');
	const flat = lines.join(' ');
	const titleMatch =
		/your latest session,\s*(.+?),\s*has been processed/i.exec(flat) ??
		/\bthe session\s+(.+?)\s+has been processed/i.exec(flat);
	const title = titleMatch?.[1]?.trim() ?? null;
	if (!title) return { kind: 'other', source: 'altercall', reason: 'session email without a session title' };

	const link = findSessionLink(html);
	const parts = link ? parseSessionKey(link.key, title) : null;
	const hostName = parts?.hostKey ? keyToName(parts.hostKey) : null;
	const participantNames = (parts?.participantKeys ?? []).map(keyToName);
	// The recipient is named in the greeting ("Alex Morgan, your latest…" /
	// "Hi Alex Morgan, the session…"); they are on the call too.
	const recipient = /^(?:Hi\s+)?([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3}),?\s+(?:your latest session|the session)/mu.exec(lines.find((l) => /(your latest session|the session)\b.*has been processed/i.test(l)) ?? '')?.[1] ?? null;
	const knownNames = [hostName, recipient, ...participantNames].filter((n): n is string => !!n);

	const actionsIdx = lines.findIndex((l) => /^\d+\s+Actions?\s+(Added|For You)$/i.test(l));
	const scoresEnd = lines.findIndex((l) => /^(Reveal|View|Review) My Communication Report$/i.test(l));
	const items: AlterCallSession['items'] = [];
	if (actionsIdx >= 0) {
		for (let i = actionsIdx + 1; i < lines.length; i++) {
			const l = lines[i];
			if (/^(Follow Up On|View Your Action Items|Keep leading|Keep growing)/i.test(l)) break;
			if (!l.startsWith('- ')) continue;
			const t = l.slice(2).trim();
			if (t) items.push({ text: t, ownerName: ownerFromItem(t, knownNames) });
		}
	}

	return {
		kind: 'session',
		role: link?.role ?? (/your latest session/i.test(flat) ? 'host' : 'participant'),
		title,
		sessionKey: link?.key ?? null,
		zoomUuid: parts?.zoomUuid ?? null,
		recordedAt: parts?.recordedAt ?? null,
		hostName,
		recipientName: recipient,
		participantKeys: parts?.participantKeys ?? [],
		participantNames,
		scoreKind,
		scores: scoresEnd > 0 ? parseScores(lines, 0, scoresEnd) : [],
		items,
	};
}

/** Read AI "Weekly Kickoff" digest: the notable meetings of the past week. */
export function parseReadAiEmail(subject: string, html: string): ParsedMeetingEmail {
	if (!/weekly kickoff/i.test(subject)) return { kind: 'other', source: 'read_ai', reason: `not a digest: ${subject.slice(0, 80)}` };
	const lines = htmlToText(html).split('\n');
	const start = lines.findIndex((l) => /^Meeting Notes$/i.test(l));
	const end = lines.findIndex((l, i) => i > start && /^(View all Meeting Reports|Speaker Coach)$/i.test(l));
	const meetings: ReadAiDigestMeeting[] = [];
	if (start >= 0) {
		const block = lines.slice(start + 1, end > start ? end : undefined);
		for (let i = 0; i < block.length; i++) {
			const when = block[i + 1];
			if (when && /\b\d{4}\s*@\s*\d{1,2}:\d{2}\s*[AP]M\b/i.test(when)) {
				const counts = block[i + 2] ?? '';
				const ai = /(\d+)\s+Action Items?/i.exec(counts);
				const qs = /(\d+)\s+Questions?/i.exec(counts);
				const teaser = block[i + 3] && !/^Review report/i.test(block[i + 3]) ? block[i + 3] : null;
				meetings.push({
					title: block[i],
					whenText: when,
					actionItems: ai ? Number(ai[1]) : null,
					questions: qs ? Number(qs[1]) : null,
					summaryTeaser: teaser,
				});
				i += 3;
			}
		}
	}
	return { kind: 'weekly_digest', source: 'read_ai', meetings };
}

export function sourceForSender(from: string): MeetingEmailSource | null {
	const email = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
	return MEETING_EMAIL_SENDERS[email] ?? null;
}

export function parseMeetingEmail(source: MeetingEmailSource, subject: string, html: string): ParsedMeetingEmail {
	return source === 'altercall' ? parseAlterCallEmail(subject, html) : parseReadAiEmail(subject, html);
}
