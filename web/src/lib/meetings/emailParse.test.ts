import { describe, expect, it } from 'vitest';
import {
	alterCallSlug,
	findSessionLink,
	htmlToText,
	keyToName,
	ownerFromItem,
	parseAlterCallEmail,
	parseMeetingEmail,
	parseReadAiEmail,
	parseSessionKey,
	sourceForSender,
} from './emailParse';

// Shapes copied from real AlterCall / Read AI emails (structure only; names
// and items are made up). The session link sits inside an awstrack redirect
// and is URL-encoded twice, exactly as delivered.
const hostLink =
	'https://abc.r.us-east-1.awstrack.me/L0/https:%2F%2Faltercall.ai%2Fhost%2Fsession%2FAlex_Morgan.Alex_Morgan_Toni_Keller__Cal___Open_Ronin__Jane_Doe_A_P.2026-10-02T20-23-52-140ZZ.00WMSBBkRbODkyY%252F%252BkwJJg%253D%253D.zoom/1/0100-abc/xyz=473';

const hostHtml = `<html><head><style>.x{}</style></head><body>
<div>Your Latest Session Has Been</div><div>Processed</div>
<p>Alex Morgan, your latest session, A+P, has been processed, and here&rsquo;s how your LARA scores compare to your previous session:</p>
<table><tr><td>-4</td></tr><tr><td>-7%</td></tr><tr><td>Listening</td></tr>
<tr><td>+10</td></tr><tr><td>+20%</td></tr><tr><td>Affirming</td></tr>
<tr><td>-</td></tr><tr><td>-%</td></tr><tr><td>Overall</td></tr></table>
<a href="${hostLink}">Reveal My Communication Report</a>
<div>Actions</div><div>3 Actions Added</div><div>Take a moment to review &amp; assign due dates to stay on track.</div>
<ul><li>Discuss the rollout with Chris and identify any missing pieces.</li>
<li>Jane Doe to send the deck by Friday.</li>
<li>Contact Jamie to confirm the budget.</li></ul>
<a href="https://abc.r.us-east-1.awstrack.me/L0/https:%2F%2Faltercall.ai%2Fgoals-actions/1/x">Follow Up On Latest Actions</a>
<div>Keep leading with impact!</div></body></html>`;

const participantHtml = `<div>Session Results Are</div><div>Ready</div>
<p>Hi Alex Morgan, the session Nicholas Mercer X Jamie  has been processed, and here's how your VITA scores compare to your previous session:</p>
<a href="https://x.awstrack.me/L0/https:%2F%2Faltercall.ai%2Fparticipant%2Fsession%2FJamie_Rivera.Jamie_Rivera_read_ai_meeting_notes__Nick_Mercer__Jamie_Rivera_Nicholas_Mercer_X_Jamie_.2026-09-23T22-52-09-142ZZ.EpGtFaJBTo6Z8XZmaaJBsA%253D%253D.zoom/1/x">View My Communication Report</a>
<div>2 Actions For You</div><ul><li>Alex Morgan to prepare a 5-minute AI update for the next monthly call</li><li>Confirm the cost of the placement</li></ul>
<div>View Your Action Items</div>`;

describe('htmlToText', () => {
	it('drops style blocks, decodes entities and keeps list items as "- "', () => {
		const t = htmlToText('<style>a{}</style><p>A &amp; B&rsquo;s</p><ul><li>one</li><li>two</li></ul>');
		expect(t.split('\n')).toEqual(['A & B’s', '- one', '- two']);
	});
});

describe('alterCallSlug / keyToName', () => {
	it('replaces every non-alphanumeric character with one underscore', () => {
		expect(alterCallSlug('Leadership + Strategy')).toBe('Leadership___Strategy');
		expect(alterCallSlug('Gabe 1:1')).toBe('Gabe_1_1');
	});
	it('keeps the person part of "Name | Brand"', () => {
		expect(keyToName('Cal___Open_Ronin')).toBe('Cal');
		expect(keyToName('Toni_Keller')).toBe('Toni Keller');
	});
});

describe('findSessionLink', () => {
	it('finds and fully decodes the double-encoded key', () => {
		const l = findSessionLink(`<a href="${hostLink}">x</a>`);
		expect(l?.role).toBe('host');
		expect(l?.key).toContain('.00WMSBBkRbODkyY/+kwJJg==.zoom');
	});
	it('returns null when there is no session link', () => {
		expect(findSessionLink('<a href="https://altercall.ai/goals-actions">x</a>')).toBeNull();
	});
});

describe('parseSessionKey', () => {
	it('splits host, participants (double underscore), timestamp and zoom uuid', () => {
		const p = parseSessionKey(
			'Alex_Morgan.Alex_Morgan_Sam_Carter__Taylor_Cordell_Beacon_Open_Ronin_Product_Feature.2026-10-02T18-26-49-120ZZ.VJ454AlrS8uJuD6gEeJjOQ==.zoom',
			'Beacon+Open Ronin Product+Feature',
		);
		expect(p.hostKey).toBe('Alex_Morgan');
		expect(p.participantKeys).toEqual(['Sam_Carter', 'Taylor_Cordell']);
		expect(p.recordedAt).toBe('2026-10-02T18:26:49.120Z');
		expect(p.zoomUuid).toBe('VJ454AlrS8uJuD6gEeJjOQ==');
	});
	it('uses the title to cut a single participant off the title slug', () => {
		const p = parseSessionKey('Alex_Morgan.Alex_Morgan_Sam_Carter_Gabe_1_1.2026-09-25T16-01-12-782ZZ.XTzy==.zoom', 'Gabe 1:1');
		expect(p.participantKeys).toEqual(['Sam_Carter']);
	});
	it('handles a trailing space in the Zoom topic and drops non-people and duplicates', () => {
		const p = parseSessionKey(
			'Jamie_Rivera.Jamie_Rivera_read_ai_meeting_notes__Nick_Mercer__Jamie_Rivera_Nicholas_Mercer_X_Jamie_.2026-09-23T22-52-09-142ZZ.EpGt==.zoom',
			'Nicholas Mercer X Jamie ',
		);
		expect(p.participantKeys).toEqual(['Nick_Mercer']);
	});
	it('keeps a "Name | Brand" participant whole (three underscores are not a separator)', () => {
		const p = parseSessionKey('Jamie_Rivera.Jamie_Rivera_Cal___Open_Ronin__Taylor_Cordell_Sales_Daily.2026-09-24T15-23-24-836ZZ.Fl==.zoom', 'Sales Daily');
		expect(p.participantKeys).toEqual(['Cal___Open_Ronin', 'Taylor_Cordell']);
	});
	it('returns nothing useful for a key without a timestamp', () => {
		expect(parseSessionKey('garbage', 'x')).toEqual({ hostKey: null, participantKeys: [], recordedAt: null, zoomUuid: null });
	});
});

describe('ownerFromItem', () => {
	const names = ['Alex Morgan', 'Jane Doe', 'Jamie Rivera'];
	it('reads "<Name> to …" when the name is somebody on the call', () => {
		expect(ownerFromItem('Jane Doe to send the deck by Friday.', names)).toBe('Jane Doe');
		expect(ownerFromItem('Alex will gather the clips.', names)).toBe('Alex');
	});
	it('rejects imperatives that look like "<Verb> <Name> to …"', () => {
		expect(ownerFromItem('Contact Jamie to confirm the budget.', names)).toBeNull();
		expect(ownerFromItem('Schedule a call with Troy.', names)).toBeNull();
	});
});

describe('parseAlterCallEmail', () => {
	it('parses a host session email', () => {
		const p = parseAlterCallEmail('Your LARA Scores Are In – Review Your Progress', hostHtml);
		expect(p.kind).toBe('session');
		if (p.kind !== 'session') return;
		expect(p.role).toBe('host');
		expect(p.title).toBe('A+P');
		expect(p.scoreKind).toBe('LARA');
		expect(p.zoomUuid).toBe('00WMSBBkRbODkyY/+kwJJg==');
		expect(p.recordedAt).toBe('2026-10-02T20:23:52.140Z');
		expect(p.hostName).toBe('Alex Morgan');
		expect(p.recipientName).toBe('Alex Morgan');
		expect(p.participantNames).toEqual(['Toni Keller', 'Cal', 'Jane Doe']);
		expect(p.scores.map((s) => s.label)).toEqual(['Listening', 'Affirming', 'Overall']);
		expect(p.scores[0]).toEqual({ label: 'Listening', delta: -4, deltaPct: -7 });
		expect(p.scores[2]).toEqual({ label: 'Overall', delta: null, deltaPct: null });
		expect(p.items.map((i) => i.text)).toEqual([
			'Discuss the rollout with Chris and identify any missing pieces.',
			'Jane Doe to send the deck by Friday.',
			'Contact Jamie to confirm the budget.',
		]);
		expect(p.items.map((i) => i.ownerName)).toEqual([null, 'Jane Doe', null]);
	});
	it('parses a participant session email', () => {
		const p = parseAlterCallEmail('Your VITA Scores Are In – Review Your Progress', participantHtml);
		expect(p.kind).toBe('session');
		if (p.kind !== 'session') return;
		expect(p.role).toBe('participant');
		expect(p.title).toBe('Nicholas Mercer X Jamie');
		expect(p.hostName).toBe('Jamie Rivera');
		expect(p.participantNames).toEqual(['Nick Mercer']);
		expect(p.items[0].ownerName).toBe('Alex Morgan');
	});
	it('marks non-session AlterCall mail as other', () => {
		const p = parseAlterCallEmail("Here's Your AlterCall Recap of This Week", '<p>recap</p>');
		expect(p.kind).toBe('other');
	});
});

describe('parseReadAiEmail', () => {
	it('lists the notable meetings of a Weekly Kickoff digest', () => {
		const html = `<div>Meeting Notes</div><div>Catch up on notable reports from last week</div>
<div>Nicholas Mercer X Jamie</div><div>Sep 23, 2026 @ 6:00PM</div><div>✅️ 17 Action Items 🤔️ 17 Questions</div>
<div>The meeting focused on cash flow...</div><div>Review report ➔</div><div>View all Meeting Reports</div>`;
		const p = parseReadAiEmail('Weekly Kickoff | Mon, September 21st - Sun, September 27th | Read AI', html);
		expect(p).toEqual({
			kind: 'weekly_digest',
			source: 'read_ai',
			meetings: [{ title: 'Nicholas Mercer X Jamie', whenText: 'Sep 23, 2026 @ 6:00PM', actionItems: 17, questions: 17, summaryTeaser: 'The meeting focused on cash flow...' }],
		});
	});
});

describe('sourceForSender / parseMeetingEmail', () => {
	it('maps the three known senders and nothing else', () => {
		expect(sourceForSender('AlterCall AI <noreply@altercallai.com>')).toBe('altercall');
		expect(sourceForSender('Team AlterCall <support@altercall.com>')).toBe('altercall');
		expect(sourceForSender('Read Assistant <executiveassistant@e.read.ai>')).toBe('read_ai');
		expect(sourceForSender('someone@example.com')).toBeNull();
	});
	it('dispatches by source', () => {
		expect(parseMeetingEmail('read_ai', 'Weekly Kickoff | x', '<div>Meeting Notes</div>').kind).toBe('weekly_digest');
		expect(parseMeetingEmail('altercall', 'Your VITA Scores Are In', participantHtml).kind).toBe('session');
	});
});
