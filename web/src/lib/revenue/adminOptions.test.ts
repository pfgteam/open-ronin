import { describe, expect, it } from 'vitest';
import {
	ADMIN_SECTIONS, COUNTS_AS_OPTIONS, INTAKE_KEY_GROUPS, REQUIRED_FIELD_OPTIONS, TRACKED_METRICS, isHttpUrl, isIntakeKey, isKnownPipeline,
	isValidDomain, normalizeGhlSetting, parseCriteria, parseScoringValue, rescoreProgress, scoringKind, scoringKindForKey, sectionForTab, serializeRows, tierOptions,
} from './adminOptions';

describe('sectionForTab', () => {
	it('maps every old ?tab= onto its new section', () => {
		expect(sectionForTab(undefined)).toBe('pipelines');
		expect(sectionForTab('pipelines')).toBe('pipelines');
		expect(sectionForTab('dispositions')).toBe('pipelines');
		expect(sectionForTab('products')).toBe('catalog');
		expect(sectionForTab('templates')).toBe('catalog');
		expect(sectionForTab('scoring')).toBe('scoring');
		expect(sectionForTab('forms')).toBe('scoring');
		expect(sectionForTab('rubrics')).toBe('scoring');
		expect(sectionForTab('connectors')).toBe('integrations');
		expect(sectionForTab('ghl')).toBe('integrations');
		expect(sectionForTab('team')).toBe('team');
		expect(sectionForTab('nope')).toBe('pipelines');
		expect(ADMIN_SECTIONS.map((s) => s.key)).toEqual(['pipelines', 'catalog', 'scoring', 'integrations', 'team', 'duplicates']);
	});
});

describe('option lists', () => {
	it('required fields are real deal columns with labels', () => {
		expect(REQUIRED_FIELD_OPTIONS.map((o) => o.value)).toContain('est_mrr_cents');
		expect(REQUIRED_FIELD_OPTIONS.every((o) => /^[a-z_]+$/.test(o.value) && o.label)).toBe(true);
	});
	it('counts-as buckets are the ones the metrics read (no dial)', () => {
		expect(COUNTS_AS_OPTIONS.map((o) => o.value)).toEqual(['answer', 'conversation', 'set', 'show', 'no_show', 'offer', 'close']);
	});
	it('tracked metrics include every emitted key plus derived sales_taken', () => {
		const keys = TRACKED_METRICS.map((m) => m.value);
		for (const k of ['dials', 'answers', 'conversations', 'sets', 'shows', 'no_shows', 'offers', 'closes', 'dms', 'sends', 'emails_sent', 'replies', 'positive_replies', 'follow_ups', 'meetings', 'discovery_booked', 'discovery_taken', 'sales_booked', 'offers_sent', 'contracts_sent', 'agreements_signed', 'handoffs', 'won', 'new_leads', 'sales_taken']) {
			expect(keys).toContain(k);
		}
	});
	it('budget tiers 1-5 carry the band labels', () => {
		expect(tierOptions()[0]).toEqual({ value: '1', label: 'Tier 1 · No budget' });
		expect(tierOptions()).toHaveLength(5);
	});
});

describe('intake keys', () => {
	it('accepts known keys, fit.*, activity.*, meta.* and rejects the rest', () => {
		expect(isIntakeKey('email')).toBe(true);
		expect(isIntakeKey('fit.budget_band')).toBe(true);
		expect(isIntakeKey('fit.interest_pr')).toBe(true);
		expect(isIntakeKey('fit.made_up')).toBe(false);
		expect(isIntakeKey('activity.is_positive')).toBe(true);
		expect(isIntakeKey('meta.ghl_contact_id')).toBe(true);
		expect(isIntakeKey('meta.')).toBe(false);
		expect(isIntakeKey('external_id')).toBe(true);
		expect(isIntakeKey('drop table')).toBe(false);
		expect(INTAKE_KEY_GROUPS.map((g) => g.group)).toEqual(['Person', 'Brand', 'Deal', 'Fit signals', 'Activity']);
	});
});

describe('validators', () => {
	it('isKnownPipeline catches lead_gen vs lead-gen', () => {
		expect(isKnownPipeline('lead-gen', ['marketing', 'lead-gen'])).toBe(true);
		expect(isKnownPipeline('lead_gen', ['marketing', 'lead-gen'])).toBe(false);
		expect(isKnownPipeline(null, ['lead-gen'])).toBe(false);
	});
	it('domains and urls', () => {
		expect(isValidDomain('gmail.com')).toBe(true);
		expect(isValidDomain('mail.co.uk')).toBe(true);
		expect(isValidDomain('gmail')).toBe(false);
		expect(isValidDomain('a b.com')).toBe(false);
		expect(isHttpUrl('https://app.gohighlevel.com')).toBe(true);
		expect(isHttpUrl('javascript:alert(1)')).toBe(false);
	});
});

describe('scoring values', () => {
	it('kind follows the stored value', () => {
		expect(scoringKind(['a'])).toBe('list');
		expect(scoringKind(3)).toBe('number');
	});
	it('numbers reject non-numbers instead of becoming arrays', () => {
		expect(parseScoringValue('number', '4')).toEqual({ ok: true, value: 4 });
		expect(parseScoringValue('number', -5)).toEqual({ ok: true, value: -5 });
		expect(parseScoringValue('number', 'abc').ok).toBe(false);
		expect(parseScoringValue('number', '').ok).toBe(false);
	});
	it('lists stay string arrays and may be empty', () => {
		expect(parseScoringValue('list', [' CPG ', 'Food', ''])).toEqual({ ok: true, value: ['CPG', 'Food'] });
		expect(parseScoringValue('list', [])).toEqual({ ok: true, value: [] });
		expect(parseScoringValue('list', 'CPG').ok).toBe(false);
	});
});

describe('normalizeGhlSetting', () => {
	it('keeps the suffix leading space', () => {
		expect(normalizeGhlSetting('opportunity_name_suffix', ' · Open Ronin')).toEqual({ ok: true, value: ' · Open Ronin' });
	});
	it('trims ordinary keys, validates the URL, parses the stage list', () => {
		expect(normalizeGhlSetting('source_tag', ' openronin ')).toEqual({ ok: true, value: 'openronin' });
		expect(normalizeGhlSetting('app_base_url', 'ftp://x').ok).toBe(false);
		expect(normalizeGhlSetting('push_min_stage_slugs', '["booked","won"]')).toEqual({ ok: true, value: ['booked', 'won'] });
		expect(normalizeGhlSetting('push_min_stage_slugs', 'booked').ok).toBe(false);
	});
});

describe('serializeRows', () => {
	it('skips blank rows and rejects duplicate keys', () => {
		expect(serializeRows([{ key: 'email', value: 'email' }, { key: '', value: '' }, { key: 'fit.budget_band', value: 'budget' }]))
			.toEqual({ ok: true, map: { email: 'email', 'fit.budget_band': 'budget' } });
		expect(serializeRows([{ key: 'email', value: 'a' }, { key: 'email', value: 'b' }]).ok).toBe(false);
		expect(serializeRows([{ key: 'email', value: '' }]).ok).toBe(false);
	});
});

describe('parseCriteria (rubric preview)', () => {
	it('reads "- **Name** (weight)" lines like the server parser and sums them', () => {
		const body = '## Criteria\n- **Opener and permission** (10): asks first\n- **Discovery** (60.5): depth\n- not a criterion\n- **Close** (29.5)';
		expect(parseCriteria(body)).toEqual({ criteria: [{ name: 'Opener and permission', weight: 10 }, { name: 'Discovery', weight: 60.5 }, { name: 'Close', weight: 29.5 }], total: 100 });
		expect(parseCriteria('nothing').total).toBe(0);
	});
});

describe('scoringKindForKey (declared, not inferred from the stored value)', () => {
	it('only the two list keys are lists; a weight broken into an array or null is still a number', () => {
		expect(scoringKindForKey('industry_fit')).toBe('list');
		expect(scoringKindForKey('free_email_domains')).toBe('list');
		expect(scoringKindForKey('q_budget')).toBe('number');
		expect(scoringKindForKey('h_no_show')).toBe('number');
	});
});

describe('rescoreProgress', () => {
	it('counts processed and failed pages, keeps the first error, finishes on the last page', () => {
		let s = rescoreProgress(undefined, { done: 198, failed: 2, firstError: 'boom', finished: false });
		expect(s).toEqual({ processed: 200, failed: 2, firstError: 'boom', finished: false });
		s = rescoreProgress(s, { done: 50, failed: 1, firstError: 'later', finished: true });
		expect(s).toEqual({ processed: 251, failed: 3, firstError: 'boom', finished: true });
	});
});
