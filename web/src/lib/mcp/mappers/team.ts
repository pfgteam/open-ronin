// Pure allowlist mapper for the team:read tool. `profiles` carries several
// sensitive columns (pap_position, disc, birthday, bio_md, why_us_md,
// photo_url, can_view_comp, hourly_rate_cents, role) that must never leave
// the server — only the fields named here are ever emitted.
import { formatPosition } from '@/lib/people/position';

export type ProfileRow = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	department: string | null;
	department_tag_id: string | null;
	position_track: string | null;
	position_level: number | null;
	job_role: string | null;
	manager_id: string | null;
	employment_status: string | null;
	date_started: string | null;
	in_office: boolean;
	is_active: boolean;
};

export type PersonRow = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	department: string | null;
	position: string | null;
	job_role: string | null;
	manager_name: string | null;
	employment_status: string | null;
	date_started: string | null;
	in_office: boolean;
	url: string;
};

/**
 * Maps one profiles row + resolved labels to the allowlisted shape.
 * `department` mirrors team/page.tsx:69 — canon tag label when
 * department_tag_id is set, else the legacy free-text column.
 */
export function mapPerson(
	raw: ProfileRow,
	labels: { departmentLabel: string | null; trackLabel: string | null; managerName: string | null },
): PersonRow {
	const department = (raw.department_tag_id ? labels.departmentLabel : null) ?? raw.department;
	return {
		id: raw.id,
		first_name: raw.first_name,
		last_name: raw.last_name,
		email: raw.email,
		department,
		position: formatPosition(labels.departmentLabel, labels.trackLabel, raw.position_level),
		job_role: raw.job_role,
		manager_name: labels.managerName,
		employment_status: raw.employment_status,
		date_started: raw.date_started,
		in_office: raw.in_office,
		url: `/team/${raw.id}`,
	};
}
