import { describe, expect, it } from 'vitest';
import { answersToIntake, intakeProgress, nextIntakeQuestion, normaliseAnswer, type IntakeQuestion } from './intake';

const script: IntakeQuestion[] = [
	{ key: 'brand_name', ask: 'Brand?', type: 'text', required: true },
	{ key: 'primary_url', ask: 'URL?', type: 'url', required: true },
	{ key: 'competitors', ask: '3 competitors', type: 'list', min: 3, required: true },
	{ key: 'access', ask: 'Access?', type: 'multi', options: ['gbp', 'analytics'], required: false },
	{ key: 'sme_email', ask: 'SME email', type: 'email', required: false },
];

describe('nextIntakeQuestion', () => {
	it('walks the script by answered keys (skips count as answered)', () => {
		expect(nextIntakeQuestion(script, {})?.key).toBe('brand_name');
		expect(nextIntakeQuestion(script, { brand_name: 'MINT' })?.key).toBe('primary_url');
		expect(nextIntakeQuestion(script, { brand_name: 'MINT', primary_url: 'https://x', competitors: ['a', 'b', 'c'], access: [], sme_email: null })).toBeNull();
	});
});

describe('normaliseAnswer', () => {
	it('splits lists on newline or comma and enforces min', () => {
		expect(normaliseAnswer(script[2], 'a\nb, c')).toEqual({ ok: true, value: ['a', 'b', 'c'] });
		expect(normaliseAnswer(script[2], 'a, b').ok).toBe(false);
	});
	it('validates url + email, allows blank optionals', () => {
		expect(normaliseAnswer(script[1], 'mint.com').ok).toBe(false);
		expect(normaliseAnswer(script[1], 'https://mint.com')).toEqual({ ok: true, value: 'https://mint.com' });
		expect(normaliseAnswer(script[4], '')).toEqual({ ok: true, value: null });
		expect(normaliseAnswer(script[4], 'nope').ok).toBe(false);
	});
	it('rejects unknown multi options', () => {
		expect(normaliseAnswer(script[3], ['gbp', 'x']).ok).toBe(false);
		expect(normaliseAnswer(script[3], ['gbp'])).toEqual({ ok: true, value: ['gbp'] });
	});
});

describe('answersToIntake + progress', () => {
	it('drops empties and counts required only', () => {
		const a = { brand_name: 'MINT', primary_url: null, competitors: [], access: ['gbp'] };
		expect(answersToIntake(a)).toEqual({ brand_name: 'MINT', access: ['gbp'] });
		expect(intakeProgress(script, a)).toBe(33);
	});
});
