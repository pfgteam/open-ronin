// Client-safe permission constants — shared by the server helpers
// (lib/permissions/modules.ts), the auth store and navConfig.
// No server imports here: this file is bundled into client components.

export const MODULE_KEYS = [
	'dashboard',
	'the_work',
	'clients',
	// Prospects (0121): the revenue engine. Seeded allowed for every role
	// (spec §12: everyone sees everything today; tighten in Admin -> Roles).
	'prospects',
	// Hiring (0128): the talent engine. Seeded allowed for exec/admin/manager,
	// NOT contributor (people managers and execs only; contributors who sit in
	// people_managers pass through can_view_hiring() in SQL and the layout).
	'hiring',
	// Flywheel (0136): the delivery system. Seeded allowed for every role.
	'flywheel',
	'media',
	'social',
	'team',
	'data',
	'admin',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Per-person capabilities (migration 0055) — grants that sit OUTSIDE the role
 * matrix, for permissions that must go to named individuals rather than to a
 * whole role.
 *
 * `run_scrapers` (0055) exists because scraped_records holds third-party PII,
 * so access is granted person by person rather than by widening a role.
 * `import_data` (0068) exists because the Data Imports wizard writes business
 * tables in bulk; seeded to Alex.
 * `acquisitions` (0060) gates the acquisition scraper AND its rows: one key
 * covers what the spec calls view_acquisitions and run_acquisition_scraper,
 * because can_view_acquisitions() is the single SQL gate for both. Seeded to
 * Alex and Jamie.
 * `review_media_records` (0102) lets the media team queue journalist/outlet
 * scrapes and review their rows without holding run_scrapers (which would
 * also open the lead-side PII). can_review_media_records() is the SQL gate;
 * admin/exec and run_scrapers grantees pass it too.
 *
 * Admin and exec pass every capability in CAPABILITIES_WITH_ADMIN_FLOOR
 * without holding a row — the anti-lockout floor has_module_access() uses,
 * mirrored from can_run_scrapers() in 0055. `acquisitions` is deliberately
 * NOT on that floor: can_view_acquisitions() has no is_admin() shortcut, so an
 * admin without the row must not be shown a tab the database will refuse.
 */
export const CAPABILITIES = ['run_scrapers', 'import_data', 'acquisitions', 'manage_work_engine', 'manage_automations', 'review_media_records', 'manage_revenue', 'manage_hiring', 'manage_flywheel'] as const;
export type CapabilityKey = (typeof CAPABILITIES)[number];

/** Capabilities admin/exec hold implicitly. Everything else needs a row for
 *  everyone, elevated or not — keep this in step with the SQL gate functions. */
export const CAPABILITIES_WITH_ADMIN_FLOOR: readonly CapabilityKey[] = ['run_scrapers', 'import_data', 'manage_work_engine', 'manage_automations', 'review_media_records', 'manage_revenue', 'manage_hiring', 'manage_flywheel'];

export function hasAdminFloor(capability: CapabilityKey): boolean {
	return CAPABILITIES_WITH_ADMIN_FLOOR.includes(capability);
}

/**
 * R6 (0060): capabilities that are need-to-know. They are listed only to the
 * people named here and grantable or revocable only by the first of them
 * (Alex); the user_capabilities_r6_guard trigger in 0072 enforces the same
 * rule in SQL, so this is the honest UI, not the boundary.
 */
export const OWNER_ID = 'a0c633df-d69c-45b6-800a-73679692c645';
export const HEATHER_ID = 'ab767186-c4c5-49c5-b62f-256a8f76311a';
export const RESTRICTED_CAPABILITIES: Record<string, { visibleTo: readonly string[]; grantableBy: readonly string[] }> = {
	acquisitions: { visibleTo: [OWNER_ID, HEATHER_ID], grantableBy: [OWNER_ID] },
};

export function canSeeCapability(capability: CapabilityKey, viewerId: string | null | undefined): boolean {
	const rule = RESTRICTED_CAPABILITIES[capability];
	return !rule || (!!viewerId && rule.visibleTo.includes(viewerId));
}

export function canGrantCapability(capability: CapabilityKey, viewerId: string | null | undefined): boolean {
	const rule = RESTRICTED_CAPABILITIES[capability];
	return !rule || (!!viewerId && rule.grantableBy.includes(viewerId));
}

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
	run_scrapers: 'Run the Lead Scraper',
	import_data: 'Run Data Imports',
	acquisitions: 'Acquisition sourcing',
	manage_work_engine: 'Manage the Work Engine',
	manage_automations: 'Build automations',
	review_media_records: 'Run and review the Media Scraper',
	manage_revenue: 'Configure the Revenue Engine',
	manage_hiring: 'Build positions (Hiring)',
	manage_flywheel: 'Configure Flywheel delivery',
};

/** Shown next to the toggle. Says plainly what is being handed over. */
export const CAPABILITY_DESCRIPTIONS: Record<CapabilityKey, string> = {
	run_scrapers:
		'Queue scrapes and review the leads they return. Scraped records hold third-party contact details — name, email, phone, LinkedIn — so grant this only to people whose work needs it.',
	import_data:
		'Upload CSV and XLSX files into contacts, prospects, media outlets, client aliases, manual metrics or an Airtable table, with dry run and rollback. Writes hundreds of rows at a time, so grant it to people who own that data.',
	acquisitions:
		'Run the Acquisitions scraper, review agency owner records and approve them into the acquisition targets list. Confidential M&A sourcing: nobody sees these rows without this grant, not admins, not execs. Only Alex can hand it out.',
	manage_work_engine:
		'See every job and approval across the app on /admin/work-engine (scrapes, content jobs, imports, staff requests, automations) and cancel, retry or decide the ones that are not gated by a reviewer group. Admin and exec hold this already.',
	manage_automations:
		'Create, enable and run native automation rules (trigger → steps). Rules can write rows and send notifications, so grant it to people who own a process end to end. Admin and exec hold this already.',
	review_media_records:
		'Queue journalist and outlet scrapes (Google News by beat, email waterfall, outlet crawl) and approve the results into Contacts with the journalist role and into Media Outlets. Media-side only: does not open lead or acquisition rows. Admin and exec hold it implicitly.',
	manage_revenue:
		'Configure the Revenue Engine: pipelines and stages, the product catalog, call dispositions, scoring weights, and merge or delete prospect records. Every internal employee can already read and work deals; this is the settings key. Seeded to Ryan (marketing) and Drew (lead gen); admin and exec hold it implicitly.',
	manage_hiring:
		'Build positions in the Hiring module: the 4R, the PAP link (multiplier × level), the compensation statement, the application and interview configuration, pay levels and brand profiles. People managers can already read the module and file position requests; Alex alone approves them. Admin and exec hold this implicitly.',
	manage_flywheel:
		'Configure the Flywheel delivery system: package templates (scope of record, fees, SLA days), the 8-channel citation template, execution rules, and delete rows. The delivery team can already read and work every program; this is the settings key. Admin and exec hold it implicitly.',
};

/** Where each capability is used, for the Capabilities admin page. */
export const CAPABILITY_HREFS: Record<CapabilityKey, string> = {
	run_scrapers: '/media/lead-scraper',
	import_data: '/data/imports',
	acquisitions: '/media/lead-scraper',
	manage_work_engine: '/admin/work-engine',
	manage_automations: '/data/pipeline',
	review_media_records: '/media/media-scraper',
	manage_revenue: '/admin/prospects',
	manage_hiring: '/admin/hiring',
	manage_flywheel: '/admin/flywheel',
};

export const ROLES = ['exec', 'admin', 'manager', 'contributor'] as const;
export type RoleKey = (typeof ROLES)[number];

// Display labels shown in permission matrices (e.g. /admin/roles), NOT the
// nav — the nav has its own labels in TopNav.tsx/navConfig.ts. `social` keeps
// its historical key (role_permissions matrix, 0024) but reads "Tools" here
// since that module now backs the Tools tab (renamed 09/09/2026).
export const MODULE_LABELS: Record<ModuleKey, string> = {
	dashboard: 'Dashboards',
	the_work: 'The Work',
	clients: 'Clients',
	prospects: 'Prospects',
	hiring: 'Hiring',
	flywheel: 'Flywheel',
	media: 'Media',
	social: 'Tools',
	team: 'Team',
	data: 'Data',
	admin: 'Admin',
};

/** Route prefix → module key. Keep in sync with app_modules (migration 0024). */
export const ROUTE_MODULES: Record<string, ModuleKey> = {
	'/dashboard': 'dashboard',
	'/the-work': 'the_work',
	'/clients': 'clients',
	'/prospects': 'prospects',
	'/hiring': 'hiring',
	'/flywheel': 'flywheel',
	'/media': 'media',
	'/social': 'social',
	'/team': 'team',
	'/data': 'data',
	'/admin': 'admin',
};

export function moduleForPath(pathname: string): ModuleKey | null {
	for (const [prefix, key] of Object.entries(ROUTE_MODULES)) {
		if (pathname === prefix || pathname.startsWith(prefix + '/')) return key;
	}
	return null; // '/', auth pages, unknown → not module-gated
}

/** Anti-lockout floor — mirrors public.has_module_access(): admin/exec get everything. */
export function isElevatedRole(role: string | null | undefined): boolean {
	return role === 'admin' || role === 'exec';
}

/**
 * Pre-0024 fallback: the honest-nav role rules, used when the matrix can't be
 * read (migration not applied yet, or a transient query failure). Matches the
 * seed in 0024 so behavior is identical either way.
 */
export function legacyDefaultModules(role: string | null | undefined): ModuleKey[] {
	if (!role) return [];
	if (isElevatedRole(role)) return [...MODULE_KEYS];
	// Dashboards opened to everyone on 2026-08-19 (was manager-and-up).
	return ['dashboard', 'the_work', 'clients', 'prospects', 'flywheel', 'media', 'social', 'team'];
}
