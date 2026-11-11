// Offer + hire vocabulary (0133, H6). No server imports.

import { usd } from './shared';

export const OFFER_STATUSES = ['draft', 'approved', 'sent', 'accepted', 'declined', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const OFFER_STATUS_COLORS: Record<OfferStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent'> = { draft: 'default', approved: 'primary', sent: 'warning', accepted: 'success', declined: 'danger', withdrawn: 'default' };

export const DOC_STATUSES = ['draft', 'sent', 'viewed', 'signed', 'declined', 'void'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const DOC_STATUS_COLORS: Record<DocStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = { draft: 'default', sent: 'primary', viewed: 'warning', signed: 'success', declined: 'danger', void: 'default' };

export const REGIONS = ['us', 'os'] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_LABELS: Record<Region, string> = { us: 'US', os: 'International (OS)' };

export const WORK_MODES = ['remote', 'in_person', 'hybrid'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export interface OfferVars {
	date: string;
	position: string;
	candidate_name: string;
	candidate_first_name: string;
	candidate_location: string;
	manager_name: string;
	manager_title: string;
	annual_target: string;
	annual_base: string;
	monthly_target: string;
	monthly_base: string;
	start_date: string;
	work_mode: string;
	hours: string;
	contact_phone: string;
	brand: string;
	[k: string]: string;
}

export function renderDocument(template: string, vars: OfferVars): string {
	return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

export function offerVars(input: {
	position: string;
	candidate_name: string;
	candidate_location?: string | null;
	manager_name?: string | null;
	manager_title?: string | null;
	annual_target_cents?: number | null;
	annual_base_cents?: number | null;
	monthly_target_cents?: number | null;
	monthly_base_cents?: number | null;
	start_on?: string | null;
	work_mode: WorkMode;
	hours_per_week: number;
	brand: string;
	contact_phone?: string | null;
}): OfferVars {
	const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '<Start Date>');
	return {
		date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
		position: input.position,
		candidate_name: input.candidate_name,
		candidate_first_name: input.candidate_name.trim().split(/\s+/)[0] ?? input.candidate_name,
		candidate_location: input.candidate_location ?? '',
		manager_name: input.manager_name ?? '<Lead>',
		manager_title: input.manager_title ?? '',
		annual_target: input.annual_target_cents != null ? usd(input.annual_target_cents) : '<Total Annual Comp USD>',
		annual_base: input.annual_base_cents != null ? usd(input.annual_base_cents) : '<Base Comp USD>',
		monthly_target: input.monthly_target_cents != null ? usd(input.monthly_target_cents) : '<Monthly Target USD>',
		monthly_base: input.monthly_base_cents != null ? usd(input.monthly_base_cents) : '<Monthly Base USD>',
		start_date: fmtDate(input.start_on),
		work_mode: input.work_mode === 'in_person' ? 'in person' : input.work_mode === 'hybrid' ? 'in a hybrid arrangement' : 'remotely',
		hours: String(input.hours_per_week),
		contact_phone: input.contact_phone ?? '+1 (555) 010-2309',
		brand: input.brand,
	};
}

/** Default template keys per employment type + region (round 2 #10: 1099 uses the same process with the 1099 NDA). */
export function defaultTemplates(employment: string, region: Region): { offer: string; nda: string } {
	if (region === 'os') return { offer: 'offer_os', nda: 'nda_os' };
	if (employment === 'contractor') return { offer: 'offer_os', nda: 'nda_1099' };
	return { offer: 'offer_us', nda: 'nda_us_employee' };
}

export const PROVISIONING_STATUSES = ['todo', 'in_progress', 'done', 'skipped', 'failed'] as const;
export const PROVISIONING_OWNER_LABELS: Record<string, string> = { ops: 'Ops', manager: 'Hiring manager', it: 'IT / Workspace admin', hr: 'HR', alex: 'Alex', new_hire: 'New hire' };
