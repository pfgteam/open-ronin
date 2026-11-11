import { describe, expect, it } from 'vitest';
import { aiTextHeuristic, honeypotHits, isVideoLink, mergeDraftIntoConfig, toE164, validateAnswer, validateConfig, validateSection, type ApplicationConfig } from './application';

const cfg: ApplicationConfig = {
	version: 2,
	sections: [
		{ key: 'contact', kind: 'contact', title: 'About you', questions: [{ key: 'full_name', type: 'short_text', label: 'Name', required: true }, { key: 'email', type: 'email', label: 'Email', required: true }, { key: 'phone', type: 'phone', label: 'Phone', required: true }] },
		{ key: 'skills', kind: 'skills', title: 'Skills', questions: [{ key: 'skill_a', type: 'rating_1_5', label: 'A', required: true }, { key: 'skill_fake', type: 'rating_1_5', label: 'FakeTool Pro', required: true, honeypot: true, honeypot_threshold: 3 }] },
		{ key: 'challenge', kind: 'challenge', title: 'Timed', questions: [{ key: 'c1', type: 'timed_text', label: 'Q', required: true, paste: 'block', time_limit_s: 180, max_chars: 100 }] },
	],
};

describe('validateConfig', () => {
	it('accepts a well-formed config', () => {
		expect(validateConfig(cfg)).toBeNull();
	});
	it('mirrors the SQL check: bad kind, duplicate key, short timer, select without options', () => {
		expect(validateConfig({ version: 2, sections: [{ key: 'x', kind: 'nope', questions: [] }] })).toMatch(/kind invalid/);
		expect(validateConfig({ version: 2, sections: [{ key: 'a', kind: 'custom', questions: [{ key: 'q', type: 'short_text', label: '' }, { key: 'q', type: 'short_text', label: '' }] }] })).toMatch(/duplicate/);
		expect(validateConfig({ version: 2, sections: [{ key: 'a', kind: 'challenge', questions: [{ key: 'q', type: 'timed_text', label: '', time_limit_s: 10 }] }] })).toMatch(/time_limit_s/);
		expect(validateConfig({ version: 2, sections: [{ key: 'a', kind: 'custom', questions: [{ key: 'q', type: 'select', label: '' }] }] })).toMatch(/options/);
		expect(validateConfig(null)).toMatch(/object/);
	});
});

describe('validateAnswer / validateSection', () => {
	it('requires required fields and checks formats', () => {
		expect(validateAnswer(cfg.sections[0].questions[0], undefined)).toBe('Required.');
		expect(validateAnswer(cfg.sections[0].questions[1], { value: 'nope' })).toMatch(/valid email/);
		expect(validateAnswer(cfg.sections[0].questions[1], { value: 'a@b.co' })).toBeNull();
		expect(validateAnswer(cfg.sections[0].questions[2], { value: '555' })).toMatch(/country code/);
		expect(validateAnswer(cfg.sections[0].questions[2], { value: '+1 615 555 0100' })).toBeNull();
		expect(validateAnswer(cfg.sections[2].questions[0], { value: 'x'.repeat(101) })).toMatch(/under 100/);
		expect(validateAnswer({ key: 'b', type: 'boolean', label: '', required: true }, { value: false })).toBe('Please confirm.');
		expect(validateAnswer({ key: 'r', type: 'rating_1_5', label: '', required: true }, { value: 7 })).toMatch(/1 to 5/);
		expect(validateAnswer({ key: 's', type: 'statement', label: '', required: true }, undefined)).toBeNull();
	});
	it('collects section errors by key', () => {
		expect(Object.keys(validateSection(cfg.sections[0], { full_name: { value: 'A' } }))).toEqual(['email', 'phone']);
	});
});

describe('helpers', () => {
	it('normalises phones to E.164 (US default for bare 10 digits)', () => {
		expect(toE164('(615) 555-0100')).toBe('+16155550100');
		expect(toE164('+63 917 123 4567')).toBe('+639171234567');
		expect(toE164('12')).toBeNull();
	});
	it('recognises video links', () => {
		expect(isVideoLink('https://www.loom.com/share/abc')).toBe(true);
		expect(isVideoLink('https://youtu.be/xyz')).toBe(true);
		expect(isVideoLink('https://example.com/me.mp4')).toBe(true);
		expect(isVideoLink('https://example.com/')).toBe(false);
	});
	it('flags honeypot ratings at or above the threshold', () => {
		expect(honeypotHits(cfg, { skill_a: { value: 5 }, skill_fake: { value: 4 } })).toEqual([{ key: 'skill_fake', label: 'FakeTool Pro', value: 4 }]);
		expect(honeypotHits(cfg, { skill_fake: { value: 2 } })).toEqual([]);
	});
	it('scores LLM-flavoured prose higher than human prose', () => {
		const llm = 'In today\'s fast-paced environment, it is important to note that I leverage robust and comprehensive strategies to deliver seamless results. Furthermore, I utilize dynamic frameworks to drive holistic outcomes. Moreover, I am passionate about delivering value. Additionally, my approach is comprehensive and robust. It is important to note that results matter.';
		const human = "Honestly? Last Friday a reporter wanted a quote in 30 min and the founder wasn't picking up. I grabbed the two most recent quotes she'd approved, stitched a new one that didn't invent anything, texted her 'ok to send?' and sent at minute 28 when she thumbs-upped. Messy, but it ran.";
		expect(aiTextHeuristic(llm)).toBeGreaterThanOrEqual(0.6);
		expect(aiTextHeuristic(human)).toBeLessThan(0.4);
		expect(aiTextHeuristic('short')).toBe(0);
	});
});

describe('mergeDraftIntoConfig', () => {
	const base: ApplicationConfig = {
		version: 2,
		sections: [
			{ key: 'consent', kind: 'consent', title: 'C', questions: [{ key: 'consent_accept', type: 'boolean', label: 'ok', required: true }] },
			{ key: 'screening', kind: 'screening', title: 'S', questions: [{ key: 'hours_ok', type: 'boolean', label: 'hours', required: true }, { key: 'old_specific', type: 'short_text', label: 'old' }] },
			{ key: 'skills', kind: 'skills', title: 'K', questions: [{ key: 'skill_google_workspace', type: 'rating_1_5', label: 'GW' }, { key: 'skill_pressfusion', type: 'rating_1_5', label: 'PF', honeypot: true }] },
			{ key: 'challenge', kind: 'challenge', title: 'T', questions: [{ key: 'challenge_1', type: 'timed_text', label: 'old q', time_limit_s: 180 }] },
		],
	};
	it('keeps knockout screening, swaps skills with honeypots interleaved, replaces challenges, keeps the config valid', () => {
		const merged = mergeDraftIntoConfig(base, {
			screening: [{ key: 'pr_years', type: 'select', label: 'PR years', options: ['0-1', '1+'] }],
			skills: [{ key: 'skill_cision', label: 'Cision' }, { key: 'skill_pitching', label: 'Pitching' }, { key: 'skill_airtable', label: 'Airtable' }, { key: 'skill_slack', label: 'Slack' }],
			honeypots: [{ key: 'skill_mediasync', label: 'MediaSync Enterprise' }, { key: 'skill_presswave', label: 'PressWave 360' }],
			challenges: [{ key: 'challenge_a', label: 'Scenario A', time_limit_s: 120 }],
			scoring: [{ key: 'writing', label: 'Writing', weight: 50 }, { key: 'judgment', label: 'Judgment', weight: 50 }],
		});
		expect(validateConfig(merged)).toBeNull();
		const screening = merged.sections.find((s) => s.kind === 'screening')!;
		expect(screening.questions.map((q) => q.key)).toEqual(['hours_ok', 'pr_years']);
		const skills = merged.sections.find((s) => s.kind === 'skills')!;
		expect(skills.questions).toHaveLength(6);
		expect(skills.questions.filter((q) => q.honeypot)).toHaveLength(2);
		// honeypots are not all bunched at the end
		const hpIdx = skills.questions.map((q, i) => (q.honeypot ? i : -1)).filter((i) => i >= 0);
		expect(hpIdx[0]).toBeLessThan(skills.questions.length - 1);
		const ch = merged.sections.find((s) => s.kind === 'challenge')!;
		expect(ch.questions).toEqual([expect.objectContaining({ key: 'challenge_a', type: 'timed_text', paste: 'block', time_limit_s: 120 })]);
		expect(merged.scoring?.reduce((n, s) => n + s.weight, 0)).toBe(100);
	});
	it('dedupes keys that collide with existing questions', () => {
		const merged = mergeDraftIntoConfig(base, { screening: [{ key: 'consent_accept', type: 'boolean', label: 'dup' }] });
		expect(validateConfig(merged)).toBeNull();
		expect(merged.sections.find((s) => s.kind === 'screening')!.questions.some((q) => q.key === 'consent_accept_2')).toBe(true);
	});
});
