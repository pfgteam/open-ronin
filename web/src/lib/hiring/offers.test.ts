import { describe, expect, it } from 'vitest';
import { defaultTemplates, offerVars, renderDocument } from './offers';

describe('offers', () => {
	it('fills the 2026 offer letter placeholders from the ladder figures', () => {
		const vars = offerVars({ position: 'Publicist', candidate_name: 'Ana Lima', manager_name: 'Lee Park', manager_title: 'People Operations', annual_target_cents: 1116000, annual_base_cents: 949200, monthly_target_cents: 93000, monthly_base_cents: 79100, start_on: '2026-11-03', work_mode: 'remote', hours_per_week: 40, brand: 'Open Ronin' });
		const out = renderDocument('Dear {{candidate_first_name}}, role of {{position}} reporting to {{manager_name}}, {{manager_title}}. {{annual_target}} / base {{annual_base}}. Start {{start_date}}, working {{work_mode}}. {{nope}}', vars);
		expect(out).toBe('Dear Ana, role of Publicist reporting to Lee Park, People Operations. $11,160 / base $9,492. Start November 3, 2026, working remotely. ');
	});
	it('leaves angle placeholders when figures are missing so a reviewer sees the gap', () => {
		const vars = offerVars({ position: 'X', candidate_name: 'A B', work_mode: 'in_person', hours_per_week: 40, brand: 'Main' });
		expect(vars.annual_target).toBe('<Total Annual Comp USD>');
		expect(vars.start_date).toBe('<Start Date>');
		expect(vars.work_mode).toBe('in person');
	});
	it('picks templates by employment + region (1099 gets the 1099 NDA)', () => {
		expect(defaultTemplates('full_time', 'us')).toEqual({ offer: 'offer_us', nda: 'nda_us_employee' });
		expect(defaultTemplates('contractor', 'us')).toEqual({ offer: 'offer_os', nda: 'nda_1099' });
		expect(defaultTemplates('full_time', 'os')).toEqual({ offer: 'offer_os', nda: 'nda_os' });
	});
});
