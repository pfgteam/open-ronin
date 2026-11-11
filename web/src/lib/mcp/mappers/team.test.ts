import { describe, expect, it } from 'vitest';
import { mapPerson } from './team';

describe('mapPerson', () => {
	it('exposes exactly the allowlist — no sensitive fields', () => {
		const raw = {
			id: 'u1',
			first_name: 'Jane',
			last_name: 'Doe',
			email: 'user-8a8dee@example.com',
			department: 'Legacy Dept',
			department_tag_id: 'tag1',
			position_track: 'publicist',
			position_level: 2,
			job_role: 'Lead Publicist',
			manager_id: 'u2',
			employment_status: 'Full-time',
			date_started: '2024-01-01',
			in_office: true,
			is_active: true,
			// Sensitive columns that must never leave the server:
			pap_position: 'secret',
			disc: 'D',
			birthday: '1990-01-01',
			bio_md: 'bio',
			role: 'admin',
			photo_url: 'https://example.com/x.png',
			can_view_comp: true,
			hourly_rate_cents: 5000,
			why_us_md: 'why',
		};
		const row = mapPerson(raw, {
			departmentLabel: 'Delivery',
			trackLabel: 'Publicist',
			managerName: 'Manager Name',
		});
		expect(Object.keys(row).sort()).toEqual(
			[
				'date_started', 'department', 'email', 'employment_status', 'first_name',
				'id', 'job_role', 'last_name', 'manager_name', 'in_office',
				'position', 'url',
			].sort(),
		);
		const json = JSON.stringify(row);
		for (const forbidden of ['pap_position', 'disc', 'birthday', 'bio_md', 'photo_url', 'can_view_comp', 'hourly_rate_cents', 'why_us_md', 'secret']) {
			expect(json).not.toContain(forbidden);
		}
		expect(row).not.toHaveProperty('role');
	});

	it('composes position via formatPosition', () => {
		const raw = {
			id: 'u1', first_name: 'A', last_name: 'B', email: 'a@b.com',
			department: null, department_tag_id: 'tag1', position_track: 'publicist',
			position_level: 2, job_role: null, manager_id: null, employment_status: null,
			date_started: null, in_office: false, is_active: true,
		};
		const row = mapPerson(raw, { departmentLabel: 'Delivery', trackLabel: 'Publicist', managerName: null });
		expect(row.position).toBe('Delivery Publicist II');
	});

	it('department falls back to legacy profiles.department text when department_tag_id is null', () => {
		const raw = {
			id: 'u1', first_name: 'A', last_name: 'B', email: 'a@b.com',
			department: 'Legacy Text Dept', department_tag_id: null, position_track: null,
			position_level: null, job_role: null, manager_id: null, employment_status: null,
			date_started: null, in_office: false, is_active: true,
		};
		const row = mapPerson(raw, { departmentLabel: null, trackLabel: null, managerName: null });
		expect(row.department).toBe('Legacy Text Dept');
	});

	it('url points at /team/<id>', () => {
		const raw = {
			id: 'u1', first_name: 'A', last_name: 'B', email: 'a@b.com',
			department: null, department_tag_id: null, position_track: null,
			position_level: null, job_role: null, manager_id: null, employment_status: null,
			date_started: null, in_office: false, is_active: true,
		};
		const row = mapPerson(raw, { departmentLabel: null, trackLabel: null, managerName: null });
		expect(row.url).toBe('/team/u1');
	});
});
