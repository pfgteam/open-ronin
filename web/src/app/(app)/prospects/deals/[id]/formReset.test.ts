import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// React 19 resets a <form action={fn}> after it runs, and a reset puts every
// <select> back on its page-load option. The always-open Qualification card
// must submit with onSubmit, or a second Save overwrites the first answers
// (review 2026-10-20, Critical 1).
describe('Qualification card form', () => {
	it('submits with onSubmit, never a form action', () => {
		const src = readFileSync(path.join(import.meta.dirname, 'QualificationCard.tsx'), 'utf8');
		expect(src).toMatch(/onSubmit=\{/);
		expect(src).not.toMatch(/<form[^>]*\baction=\{/);
	});
});
