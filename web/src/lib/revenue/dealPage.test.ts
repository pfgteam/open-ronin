import { describe, expect, it } from 'vitest';
import { briefExcerpt, dealTab, headerFacts, ilikeEscape, qualificationProgress, quickAddError, splitDisplayName, stageUndoable } from './dealPage';
import { FIT_SIGNAL_FIELDS, type DealCard } from './shared';

describe('dealTab', () => {
	it('maps the old Intel and Documents links to the tabs that now hold them', () => {
		expect(dealTab('intel')).toBe('calls');
		expect(dealTab('documents')).toBe('closing');
	});
	it('keeps the three tabs and edit, and falls back to Summary', () => {
		expect(dealTab('calls')).toBe('calls');
		expect(dealTab('closing')).toBe('closing');
		expect(dealTab('edit')).toBe('edit');
		expect(dealTab(undefined)).toBe('summary');
		expect(dealTab('junk')).toBe('summary');
	});
});

describe('briefExcerpt', () => {
	it('keeps the first five content lines and skips headings and blanks', () => {
		expect(briefExcerpt('# Brief\n\n- a\n- b\n- c\n- d\n- e\n- f')).toBe('- a\n- b\n- c\n- d\n- e');
	});
	it('returns everything when the brief is short', () => {
		expect(briefExcerpt('- only one')).toBe('- only one');
	});
});

describe('qualificationProgress', () => {
	it('counts budget, timing and every fit question; false is an answer', () => {
		const p = qualificationProgress({ budget_band: 'b3', timing: null, fit_signals: { interest_pr: false, why_grow: '' } } as never);
		expect(p.total).toBe(2 + FIT_SIGNAL_FIELDS.length);
		expect(p.answered).toBe(2);
		expect(p.missing).toContain('Timing');
		expect(p.missing).toContain('Why do they want to grow?');
		expect(p.missing).not.toContain('Interested in PR');
	});
	it('handles a deal with no fit signals at all', () => {
		expect(qualificationProgress({ budget_band: null, timing: null, fit_signals: null } as never).answered).toBe(0);
	});
});

describe('stageUndoable', () => {
	const open = { pipeline_id: 'p1', handoff_pipeline_id: null, outcome: 'open' } as const;
	it('offers Undo for a plain move inside the same pipeline', () => {
		expect(stageUndoable(open, 'p1')).toBe(true);
	});
	it('offers no Undo for another pipeline, a hand-off or a won/lost stage', () => {
		expect(stageUndoable({ ...open, pipeline_id: 'p2' }, 'p1')).toBe(false);
		expect(stageUndoable({ ...open, handoff_pipeline_id: 'p2' }, 'p1')).toBe(false);
		expect(stageUndoable({ ...open, outcome: 'won' }, 'p1')).toBe(false);
	});
});

describe('headerFacts', () => {
	const deal = { person_name: null, primary_person_id: null, brand_id: 'b1', brand_name: 'Acme', est_mrr_cents: 400000, est_one_time_cents: 0, owner_closer_id: null, owner_setter_id: null, owner_lg_id: null } as unknown as DealCard;
	const who = (id: string | null) => (id === 'u1' ? 'Maria' : null);
	it('lists only the facts that exist — never an empty value or a dash', () => {
		const facts = headerFacts(deal, who, null);
		expect(facts.map((f) => f.label)).toEqual(['Value', 'Brand']);
		expect(facts.every((f) => f.value && f.value !== '—')).toBe(true);
	});
	it('adds the contact, email, phone and owners in order, with links', () => {
		const facts = headerFacts({ ...deal, person_name: 'Jane Doe', primary_person_id: 'p1', owner_closer_id: 'u1' } as DealCard, who, { title: 'CMO', email: 'jane@acme.com', phone: '+1 615 555 0100' });
		expect(facts.map((f) => f.label)).toEqual(['Contact', 'Email', 'Phone', 'Value', 'Closer', 'Brand']);
		expect(facts.find((f) => f.label === 'Email')?.href).toBe('mailto:jane@acme.com');
		expect(facts.find((f) => f.label === 'Phone')?.href).toBe('tel:+16155550100');
		expect(facts.find((f) => f.label === 'Contact')?.value).toBe('Jane Doe · CMO');
	});
});

describe('splitDisplayName', () => {
	it('first word is the first name, the rest the last name', () => {
		expect(splitDisplayName('  Jane  van Doe ')).toEqual({ first_name: 'Jane', last_name: 'van Doe' });
		expect(splitDisplayName('Cher')).toEqual({ first_name: 'Cher', last_name: null });
		expect(splitDisplayName('   ')).toEqual({ first_name: null, last_name: null });
	});
});

describe('quickAddError', () => {
	it('needs a name that is not blank', () => {
		expect(quickAddError({ display_name: '  ', email: 'a@b.co', pipeline: 'lead-gen' })?.field).toBe('display_name');
	});
	it('needs an email or a phone', () => {
		expect(quickAddError({ display_name: 'Jane', pipeline: 'lead-gen' })).toEqual({ field: 'contact', message: 'Add an email or a phone.' });
	});
	it('needs a pipeline', () => {
		expect(quickAddError({ display_name: 'Jane', phone: '615', pipeline: '' })?.field).toBe('pipeline');
	});
	it('accepts a name plus a phone', () => {
		expect(quickAddError({ display_name: 'Jane', phone: '615 555', pipeline: 'lead-gen' })).toBeNull();
	});
});

describe('ilikeEscape', () => {
	it('escapes the ilike wildcards and the escape character, so a brand name matches literally', () => {
		const backslash = String.fromCharCode(92);
		expect(ilikeEscape(`50%_off${backslash}`)).toBe(`50${backslash}%${backslash}_off${backslash}${backslash}`);
		expect(ilikeEscape('Acme')).toBe('Acme');
	});
});

describe('quickAddError — review fixes', () => {
	it('First/Last under More fields count as the name', () => {
		expect(quickAddError({ display_name: '', first_name: 'Jane', email: 'j@a.co', pipeline: 'lead-gen' })).toBeNull();
		expect(quickAddError({ display_name: ' ', last_name: 'Doe', phone: '615', pipeline: 'lead-gen' })).toBeNull();
	});
	it('a form pre-filled from an existing person or brand keeps the old rule: any one identifier', () => {
		expect(quickAddError({ brand_name: 'Acme', pipeline: 'lead-gen', prefilled: true })).toBeNull();
		expect(quickAddError({ linkedin_url: 'https://linkedin.com/in/jane', pipeline: 'lead-gen', prefilled: true })).toBeNull();
		expect(quickAddError({ pipeline: 'lead-gen', prefilled: true })?.field).toBe('display_name');
	});
});
