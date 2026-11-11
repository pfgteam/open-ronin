// Shared navigation config + visibility rules for TopNav, SideNav, the
// page tab strip, the "+ New" menu and the global search index.
//
// SOURCE OF TRUTH (Alex, 2026-11-10): the "Alex draft (original)" tab of
// the sheet "Open Ronin Menu Restructure" (MENU_SHEET_URL below; snapshot
// Vault/code/openronin/alex-draft-menu-2026-11-10.csv, copied into
// navDraft.fixture.csv next to this file). Every row of that tab is built
// here exactly as written: same name, same menu, same section, same level,
// same order. Each entry carries `row`, its row number in the tab, and
// navSheet.test.ts compares this file against the fixture row by row. Where
// the rework plan (D5, D15) or nav spec v2 disagree with the tab, the tab
// wins.
//
// The tab's columns, in Alex's words:
//   Menu            — the top menu: Work, Clients, Growth, Studio, Team,
//                     Management.
//   Section Heading — "Title inline with horizontal line, except for major
//                     titles (bold) from top menu." The first heading of each
//                     menu is the bold major title; the others sit inline on
//                     a divider line. Headings are clickable (they open the
//                     first page under them, or their own page: `link`).
//   Primary Menu    — level 1: icon + label; the column collapses to icons
//   Item              only when a sub menu opens. Not duplicated from the
//                     section heading.
//   Sub Menu Item   — level 2: text rows in the second column that opens
//                     from the primary item. Two levels max.
//   Items On Screen — what is ON the page (tabs, tiles), never menu rows.
//                     The only tabs here are pages that ARE tabs: Internal
//                     Work (the hub draws its own strip) and Dashboards
//                     ("tabs at top to switch between areas, general first").
//   Notes           — followed literally.
//
// "Honest nav" (12-week plan, S1) still applies: pages that are not built
// are flagged `wip` and hidden from regular users; visible (badged) to
//   - role 'admin' or 'exec', OR
//   - department 'Dev'.
// Rows the tab names that have no page yet point at /soon/<slug>, a
// placeholder that names the row and links to the sheet; they ride the same
// wip flag and render a "Soon" badge. The registry is COMING_SOON below.
// When a page ships: give the row its real href, delete the registry row and
// the wip flag.
//
// Routes stay reachable by direct URL either way; this only shapes the nav.

import type { Profile } from '@/stores/auth';
import {
	legacyDefaultModules,
	type CapabilityKey,
	type ModuleKey,
} from '@/lib/permissions/constants';

/** Alex's menu spec. Linked from every /soon placeholder. */
export const MENU_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ejvZLQKWLZePXy_da22_oD6liAgm2K4_-j5QgUgddq4';

export type NavVisibility = 'wip' | 'admin' | 'manager' | 'cycle';

/** Who may see a link. All omitted = everyone. */
export interface NavGate {
	/** Omitted = visible to everyone. 'cycle' = only while a calibration cycle is open (0118). */
	visibility?: NavVisibility;
	/** Module key from the role_permissions matrix (0024). Omitted = ungated. */
	module?: ModuleKey;
	/**
	 * Per-person capability (user_capabilities, 0055). "Only available to
	 * direct permission access users" (Growth › Acquisitions): the viewer must
	 * hold the row; there is no admin floor for it.
	 */
	capability?: CapabilityKey;
}

/**
 * One destination: a level-1 or level-2 row, or a tab. Also the flat shape
 * the search index, sectionForPath and the tests read (sideNavMap).
 */
export interface SideNavItem extends NavGate {
	label: string;
	href: string;
	/** Extra path prefixes (optionally with ?query) that light this entry: child pages that do not live under its href. */
	activeFor?: string[];
	/** Light only on the href's own path, never on pages beneath it. */
	exact?: boolean;
}

/** A tab ON a page (the sheet's "Items On Screen"), never a menu row. */
export type NavTab = SideNavItem;

/** Icon names for level-1 rows (navIcons.ts maps them to lucide). */
export type NavIconName =
	// Work
	| 'overview' | 'my-work' | 'planning' | 'internal-work' | 'bot-work' | 'calendars'
	| 'client-work' | 'media-outlets' | 'media-members' | 'pr' | 'social' | 'writing' | 'flywheel' | 'beacon'
	// Clients
	| 'clients-overview' | 'clients' | 'contacts' | 'tickets' | 'payments' | 'portals' | 'proof'
	// Growth
	| 'growth-overview' | 'prospects' | 'pipeline' | 'calls' | 'people' | 'referrals' | 'acquisitions'
	// Studio
	| 'post-ideas' | 'post-creator' | 'podcast-studio' | 'podcast-distribution'
	| 'copy' | 'scrapers' | 'workflows' | 'products' | 'forms' | 'listening'
	| 'media-requests' | 'lists' | 'ideation' | 'autopitch' | 'send-pitch'
	// Team
	| 'directory' | 'performance' | 'knowledge' | 'hiring'
	// Management
	| 'dashboards' | 'requests-desk' | 'team-systems' | 'users' | 'platform' | 'data';

interface NavRowFields extends NavGate {
	label: string;
	/** Row number in the "Alex draft (original)" tab. */
	row: number;
}

/** Level 2: text-only row in the second column. Never has children or tabs. */
export interface NavSub extends NavRowFields {
	href: string;
	activeFor?: string[];
	exact?: boolean;
}

interface NavTopBase extends NavRowFields {
	icon: NavIconName;
}

/** Level 1 with a page of its own. */
interface NavTopLink extends NavTopBase {
	href: string;
	activeFor?: string[];
	exact?: boolean;
	tabs?: undefined;
	ownTabs?: undefined;
	children?: undefined;
}

/** Level 1 whose page IS its tabs (opens the first visible tab). */
interface NavTopTabbed extends NavTopBase {
	href?: undefined;
	activeFor?: undefined;
	exact?: undefined;
	tabs: NavTab[];
	/**
	 * The page draws this tab strip itself (The Work hub: tabs carry their
	 * true filtered counts, rework D2), so PageTabs stays out and the strip
	 * never renders twice. The tabs still drive the sidebar highlight,
	 * landing and search.
	 */
	ownTabs?: boolean;
	children?: undefined;
}

/** Level 1 with a sub menu: opens the second column and its first visible row. */
interface NavTopParent extends NavTopBase {
	href?: undefined;
	activeFor?: undefined;
	exact?: undefined;
	tabs?: undefined;
	ownTabs?: undefined;
	children: NavSub[];
}

export type NavTop = NavTopLink | NavTopTabbed | NavTopParent;

/** A sheet Section Heading and the primary rows under it. */
export interface NavGroup {
	/** The heading text, exactly as the sheet writes it. */
	title: string;
	/** Row number of the heading in the tab. */
	row: number;
	/** The bold title at the top of the menu (the first heading of each menu). Others draw inline on a line. */
	major?: boolean;
	/**
	 * The heading opens a page of its own instead of its first row (Alex
	 * 11/10, row 23: the Client Work heading opens the Client Work table; no
	 * duplicate primary row). Gated by `module`; lit by `activeFor`.
	 */
	link?: { href: string; module?: ModuleKey; activeFor?: string[] };
	items: NavTop[];
}

export type NavSectionKey = 'work' | 'clients' | 'growth' | 'studio' | 'team' | 'management';

export interface TopNavItem {
	key: NavSectionKey;
	label: string;
	/**
	 * Static landing (search index, fallback). TopNav and the major title
	 * open the first page the VIEWER can see instead (navModel.landing).
	 */
	href: string;
	/** Module key from the role_permissions matrix (0024). Omitted = ungated. */
	module?: ModuleKey;
	/** Omitted = visible to everyone. See the rules below. */
	visibility?: NavVisibility;
}

export interface NavSection extends TopNavItem {
	/** Row number of the menu name in the tab. */
	row: number;
	/**
	 * URL prefixes whose UNLISTED pages (record pages, settings subroutes,
	 * wizards) belong to this menu. A page listed under some other menu wins
	 * over the prefix owner — see sectionForPath.
	 */
	owns: string[];
	/** The sidebar: section headings with their level-1 rows. */
	groups: NavGroup[];
}

// ---------------------------------------------------------------------------
// Coming-soon registry: rows the tab names that have no page yet. The slug is
// the /soon/<slug> URL; `menu` is the breadcrumb the placeholder shows;
// `note` carries the sheet's Notes / Items On Screen for the row, or the open
// question when the row is ambiguous.
// ---------------------------------------------------------------------------

export interface ComingSoonEntry {
	label: string;
	menu: string;
	note?: string;
}

export const COMING_SOON: Record<string, ComingSoonEntry> = {
	// Work
	'bot-work': { label: 'Bot Work', menu: 'Work › The Work' },
	'writing-assignments': { label: 'Writing Assignments', menu: 'Work › Client Work › Writing' },
	'seo-geo-health': { label: 'SEO/GEO Health', menu: 'Work › Client Work › Flywheel' },
	'beacon-reports': { label: 'Reports', menu: 'Work › Client Work › Beacon' },
	// Clients
	'clients-overview': { label: 'Overview', menu: 'Clients › Client Information', note: 'Clients lands here, no title. On screen: number of clients in each package, client health, upcoming major items, and probably some more key tiles.' },
	// Growth
	'call-tracker': { label: 'Call Tracker', menu: 'Growth › Revenue Growth' },
	// Studio
	'post-ideas': { label: 'Post Ideas', menu: 'Studio › Content', note: 'Links to Post Scheduler as Tasks. After created and Scheduled goes to client portal for approval.' },
	'podcast-distribution': { label: 'Podcast Distribution', menu: 'Studio › Content' },
	'copy-creation': { label: 'Copy Creation', menu: 'Studio › Tools' },
	// Management
	'agentic-approval': { label: 'Agentic Approval', menu: 'Management › Admin › Platform', note: 'Approval Rules for Bots.' },
	'routing-rules': { label: 'Routing rules', menu: 'Management › Admin › Platform' },
	'analytics-costs': { label: 'Analytics and costs', menu: 'Management › Admin › Platform' },
	// + New (Request Types tab)
	'ask-a-bot': { label: 'Ask a bot', menu: '+ New › Create', note: 'Bots PROPOSE; if that action type was previously approved, they EXECUTE. Scout routes/assigns and asks a human only when in doubt.' },
	'request-project': { label: 'Project / task for another team', menu: '+ New › Request', note: 'Routes to Planning & Priorities; a manager prioritizes it and it becomes a work item.' },
	'request-access': { label: 'Access / tool', menu: '+ New › Request', note: 'Routes to Admin and becomes an admin task.' },
	'request-purchase': { label: 'Purchase / expense', menu: '+ New › Request', note: 'Manager + Finance approve; becomes a finance task.' },
};

export function soonHref(slug: keyof typeof COMING_SOON | string): string {
	return `/soon/${slug}`;
}

/** True for a placeholder href (renders the "Soon" badge instead of "WIP"). */
export function isSoonHref(href: string): boolean {
	return href.startsWith('/soon/');
}

// ---------------------------------------------------------------------------
// Management › Dashboards: "Tabs at top to switch between areas, general is
// first" (sheet row 106, Items On Screen). The department dashboards follow.
// ---------------------------------------------------------------------------

export const DEPARTMENT_TABS: { label: string; href: string }[] = [
	{ label: 'Delivery', href: '/dashboard/delivery' },
	{ label: 'Social', href: '/dashboard/social' },
	{ label: 'Dev', href: '/dashboard/dev' },
	{ label: 'Ops', href: '/dashboard/ops' },
	{ label: 'Sales', href: '/dashboard/sales' },
	{ label: 'Lead Gen', href: '/dashboard/leadgen' },
	{ label: 'Marketing', href: '/dashboard/marketing' },
];

export const DASHBOARD_TABS: { label: string; href: string; exact?: boolean }[] = [
	{ label: 'General', href: '/dashboard', exact: true },
	...DEPARTMENT_TABS,
];

// ---------------------------------------------------------------------------
// Module settings: an index page (/admin/settings) plus a gear inside each
// tool. `tool` is the page whose header shows the gear. Not menu rows: the
// sheet puts "settings/tools in every area not on the menus" on Management ›
// Admin › Platform › Admin Overview (row 124), which the /admin prefix lights.
// ---------------------------------------------------------------------------

export interface ModuleSetting {
	label: string;
	/** The settings page. */
	href: string;
	/** The tool whose header carries the gear. */
	tool: string;
	toolLabel: string;
	description: string;
}

export const MODULE_SETTINGS: ModuleSetting[] = [
	{ label: 'Pipeline', href: '/admin/pipeline', tool: '/data/pipeline', toolLabel: 'Management › Admin › Data › Imports', description: 'Connections, import targets and natural keys for the data pipeline.' },
	{ label: 'Prospects', href: '/admin/prospects', tool: '/prospects', toolLabel: 'Growth › Pipeline', description: 'Pipelines, stages, product catalog, call outcomes, scoring.' },
	{ label: 'Hiring', href: '/admin/hiring', tool: '/hiring', toolLabel: 'Team › Hiring', description: 'Pay ladder, brand About Us, consent text.' },
	{ label: 'Flywheel', href: '/admin/flywheel', tool: '/flywheel', toolLabel: 'Work › Client Work › Flywheel', description: 'Package templates, the 8-channel template, SLA.' },
	{ label: 'Lead Scraper', href: '/admin/lead-scraper', tool: '/media/lead-scraper', toolLabel: 'Studio › Tools › Scrapers', description: 'Scraper presets and budgets (the media scraper settings sit next to it).' },
	{ label: 'Innovation Desk', href: '/admin/innovation-desk', tool: '/the-work/innovation-desk', toolLabel: 'Profile › Requests', description: 'Desk reviewers and intake.' },
];

/** The settings entry for a tool page (the gear's target), or null. */
export function settingsForTool(pathname: string): ModuleSetting | null {
	return MODULE_SETTINGS.find((m) => m.tool === pathname) ?? null;
}

// ---------------------------------------------------------------------------
// The six menus, row for row from the tab. Order = header order.
// ---------------------------------------------------------------------------

export const navSections: NavSection[] = [
	{
		key: 'work',
		label: 'Work',
		row: 15,
		href: '/',
		// Unlisted pages under these prefixes (work items /the-work/<id>,
		// programs /flywheel/<id>) stay in Work.
		owns: ['/', '/the-work', '/flywheel', '/media', '/calibration'],
		groups: [
			{
				// Row 15 note: "Goes to Overview" (the heading opens its first row).
				title: 'The Work',
				row: 15,
				major: true,
				items: [
					// "Login lands here, no title."
					{ row: 16, label: 'Overview', icon: 'overview', href: '/' },
					// The personal queue on the Overview page. (Sales "My Day" is
					// Growth › Prospects, row 55.)
					{ row: 17, label: 'My Work', icon: 'my-work', href: '/?tab=work' },
					{ row: 18, label: 'Planning & Priorities', icon: 'planning', href: '/the-work/planning', activeFor: ['/projects', '/priorities'] },
					// The Work hub: one tab per kind, each its own route. The hub
					// draws the strip itself with true counts (ownTabs). The old
					// system board slugs redirect to their tab, so each tab
					// lights on them too.
					{
						row: 19,
						label: 'Internal Work',
						icon: 'internal-work',
						module: 'the_work',
						ownTabs: true,
						tabs: [
							{ label: 'Goals', href: '/the-work/goals', module: 'the_work', activeFor: ['/the-work/b/goals'] },
							{ label: 'Priorities', href: '/the-work/priorities', module: 'the_work', activeFor: ['/the-work/b/goals-priorities', '/the-work/b/priorities'] },
							{ label: 'Projects', href: '/the-work/projects', module: 'the_work', activeFor: ['/the-work/b/projects'] },
							{ label: 'Tasks', href: '/the-work/tasks', module: 'the_work', activeFor: ['/the-work/b/tasks'] },
							{ label: 'Recurring', href: '/the-work/recurring', module: 'the_work', activeFor: ['/the-work/b/recurring-processes', '/the-work/b/recurring'] },
							{ label: 'Process Edits', href: '/the-work/process', module: 'the_work', activeFor: ['/the-work/b/process'] },
							{ label: 'Bugs', href: '/the-work/bugs', module: 'the_work', activeFor: ['/the-work/b/bugs'] },
							{ label: 'Overview', href: '/the-work/overview', module: 'the_work' },
						],
					},
					{ row: 20, label: 'Bot Work', icon: 'bot-work', href: soonHref('bot-work'), visibility: 'wip' },
					// On screen: views for Projects, Events, Individual, Combined
					// Team (OOO, events, etc). The hiring calendar is one of them.
					{ row: 21, label: 'Planning Calendars', icon: 'calendars', href: '/the-work/calendar', module: 'the_work', activeFor: ['/hiring/calendar'] },
				],
			},
			{
				// Alex 11/10 (row 23): the heading itself opens the Client
				// Work table (on screen: Client Work Table); no duplicate
				// primary row.
				title: 'Client Work',
				row: 23,
				link: { href: '/the-work/client-work', module: 'the_work', activeFor: ['/the-work/b/client-work'] },
				items: [
					{ row: 24, label: 'Media Outlets', icon: 'media-outlets', href: '/media/outlets', module: 'media' },
					{ row: 25, label: 'Media Members', icon: 'media-members', href: '/media/members', module: 'media' },
					{
						row: 27,
						label: 'PR',
						icon: 'pr',
						children: [
							{ row: 27, label: 'Deliverables', href: '/clients/deliverables', module: 'clients' },
							{ row: 28, label: 'Media Opps', href: '/media/opps', module: 'media' },
							// /clients/reports is still a ComingSoon page; the
							// analytics page is the live report.
							{ row: 29, label: 'Reports', href: '/clients/analytics', module: 'clients', activeFor: ['/clients/reports'] },
						],
					},
					{
						row: 31,
						label: 'Social',
						icon: 'social',
						children: [
							// The deliverables page with a ?service= view; the
							// query decides which row lights.
							{ row: 31, label: 'Deliverables', href: '/clients/deliverables?service=social', module: 'clients' },
							{ row: 32, label: 'Posts Scheduler', href: '/flywheel/queue', module: 'flywheel' },
							// Also a tab of Management › Dashboards: the menu you
							// came from keeps it (menuPreference.ts).
							{ row: 33, label: 'Reports', href: '/dashboard/social', module: 'dashboard' },
						],
					},
					{
						row: 35,
						label: 'Writing',
						icon: 'writing',
						children: [
							{ row: 35, label: 'Writing Assignments', href: soonHref('writing-assignments'), visibility: 'wip' },
						],
					},
					{
						row: 37,
						label: 'Flywheel',
						icon: 'flywheel',
						children: [
							{ row: 37, label: 'Deliverables', href: '/clients/deliverables?service=flywheel', module: 'clients' },
							{ row: 38, label: 'SEO/GEO Health', href: soonHref('seo-geo-health'), visibility: 'wip' },
							{ row: 39, label: 'Reports', href: '/flywheel/reports', module: 'flywheel' },
						],
					},
					{
						row: 41,
						label: 'Beacon',
						icon: 'beacon',
						children: [
							{ row: 41, label: 'Deliverables', href: '/clients/deliverables?service=beacon', module: 'clients' },
							{ row: 42, label: 'Reports', href: soonHref('beacon-reports'), visibility: 'wip' },
						],
					},
				],
			},
		],
	},
	{
		key: 'clients',
		label: 'Clients',
		row: 44,
		href: '/clients',
		module: 'clients',
		// Client record pages (/clients/<id>/*) stay here.
		owns: ['/clients'],
		groups: [
			{
				title: 'Client Information',
				row: 44,
				major: true,
				items: [
					// "Clients lands here, no title." No page yet.
					{ row: 45, label: 'Overview', icon: 'clients-overview', href: soonHref('clients-overview'), visibility: 'wip' },
					// On screen: Client Table. Note: filter for client type.
					{ row: 46, label: 'All Clients', icon: 'clients', href: '/clients' },
					{ row: 47, label: 'Contacts', icon: 'contacts', href: '/clients/contacts' },
					// On screen: Client Requests (from Sessions/transcripts, Portal or manual add).
					{ row: 48, label: 'Tickets', icon: 'tickets', href: '/clients/tickets' },
					{ row: 49, label: 'Payments', icon: 'payments', href: '/clients/payments' },
					// Note: auto create each as new clients get onboarded.
					{ row: 50, label: 'Portals', icon: 'portals', href: '/clients/portals' },
					// Proof Library (0160): reviews, testimonials, case studies.
					{ row: 51, label: 'Proof Library', icon: 'proof', href: '/prospects/proof', module: 'prospects' },
				],
			},
		],
	},
	{
		key: 'growth',
		label: 'Growth',
		row: 53,
		href: '/prospects/dashboards',
		// Prospects (0121): the revenue engine, its own module key.
		module: 'prospects',
		owns: ['/prospects'],
		groups: [
			{
				title: 'Revenue Growth',
				row: 53,
				major: true,
				items: [
					// "Lands here, no title." On screen: overall metrics,
					// individual team metrics = the Prospects dashboards.
					{ row: 54, label: 'Overview', icon: 'growth-overview', href: '/prospects/dashboards' },
					// Alex 11/10 (row 55): the My Day prospect queue.
					{ row: 55, label: 'Prospects', icon: 'prospects', href: '/prospects/my-day' },
					// Deals is a view of the Pipeline page.
					{ row: 56, label: 'Pipeline', icon: 'pipeline', href: '/prospects', activeFor: ['/prospects/deals'] },
					{ row: 57, label: 'Call Tracker', icon: 'calls', href: soonHref('call-tracker'), visibility: 'wip' },
					// Note: MQL scoring (on this page). People and Brands are one
					// directory; Duplicates is a tool inside it.
					{ row: 58, label: 'People & Brands', icon: 'people', href: '/prospects/contacts', activeFor: ['/prospects/people', '/prospects/brands', '/prospects/duplicates'] },
					{ row: 59, label: 'Referrals & Reviews', icon: 'referrals', href: '/prospects/referrals' },
					// "Only available to direct permission access users": the
					// acquisitions capability (0107), no admin floor.
					{ row: 60, label: 'Acquisitions', icon: 'acquisitions', href: '/the-work/acquisitions', capability: 'acquisitions', activeFor: ['/the-work/b/acquisitions'] },
				],
			},
		],
	},
	{
		key: 'studio',
		label: 'Studio',
		row: 62,
		href: '/social/studio',
		// No menu-level module: Post Creator is `social`, Scrapers `media`,
		// Workflows `prospects`, Forms `data` — each link carries its own.
		owns: ['/social'],
		groups: [
			// Row 62: the major title, no rows of its own; it opens the first
			// page of the menu.
			{ title: 'Studio', row: 62, major: true, items: [] },
			{
				title: 'Content',
				row: 63,
				items: [
					{ row: 63, label: 'Post Ideas', icon: 'post-ideas', href: soonHref('post-ideas'), visibility: 'wip' },
					{ row: 64, label: 'Post Creator', icon: 'post-creator', href: '/social/studio', module: 'social', activeFor: ['/flywheel/studio'] },
					// Podcast Studio (0111): episodes + the release gate.
					{ row: 65, label: 'Podcast Studio', icon: 'podcast-studio', href: '/social/podcast', module: 'social' },
					{ row: 66, label: 'Podcast Distribution', icon: 'podcast-distribution', href: soonHref('podcast-distribution'), visibility: 'wip' },
				],
			},
			{
				title: 'Tools',
				row: 68,
				items: [
					{ row: 68, label: 'Copy Creation', icon: 'copy', href: soonHref('copy-creation'), visibility: 'wip' },
					// Lead scraper + media scraper. Both stay gated by their
					// capability (run_scrapers / review_media_records) on the page.
					{ row: 69, label: 'Scrapers', icon: 'scrapers', href: '/media/lead-scraper', module: 'media', activeFor: ['/media/media-scraper'] },
					{ row: 70, label: 'Workflows', icon: 'workflows', href: '/prospects/workflows', module: 'prospects' },
					{ row: 71, label: 'Products', icon: 'products', href: '/prospects/products', module: 'prospects' },
					// The form builder (0158) + its settings half.
					{ row: 72, label: 'Forms', icon: 'forms', href: '/data/forms', module: 'data', activeFor: ['/admin/forms'] },
					{ row: 73, label: 'Social Listening', icon: 'listening', href: '/clients/social', module: 'clients', visibility: 'wip' },
				],
			},
			{
				// Pitching pages are Labs (product/dev only until ready).
				title: 'Pitching',
				row: 75,
				items: [
					{ row: 75, label: 'Media Requests', icon: 'media-requests', href: '/media/requests', module: 'media', visibility: 'wip' },
					{ row: 76, label: 'Lists', icon: 'lists', href: '/media/lists', module: 'media', visibility: 'wip' },
					{ row: 77, label: 'Ideation', icon: 'ideation', href: '/media/ideation', module: 'media', visibility: 'wip' },
					{ row: 78, label: 'Autopitch', icon: 'autopitch', href: '/media/autopitch', module: 'media', visibility: 'wip' },
					{ row: 79, label: 'Send Pitch', icon: 'send-pitch', href: '/media/send', module: 'media', visibility: 'wip' },
				],
			},
		],
	},
	{
		key: 'team',
		label: 'Team',
		row: 82,
		href: '/team',
		module: 'team',
		// Profile pages (/team/<id>) and position records (/hiring/positions/<id>).
		owns: ['/team', '/hiring'],
		groups: [
			{
				title: 'Team Information',
				row: 82,
				major: true,
				items: [
					// "Team lands here." The org chart is the same row.
					{ row: 83, label: 'Directory / Org Chart', icon: 'directory', href: '/team', activeFor: ['/team/org-chart'] },
					{
						row: 85,
						label: 'Performance',
						icon: 'performance',
						children: [
							// The manager view: the nav cannot express "has direct
							// reports", so manager-and-up; the page gates the rest.
							{ row: 85, label: 'Check-ins', href: '/team/checkins', visibility: 'manager' },
							{ row: 86, label: 'Vantage Point', href: '/team/vantage-point' },
							{ row: 87, label: 'Calibration', href: '/team/calibration' },
							{ row: 88, label: 'Metrics', href: '/team/metrics', activeFor: ['/team/performance'] },
							// PAP hard-locks non-people-managers (honest nav).
							{ row: 89, label: 'PAP', href: '/team/pap', visibility: 'admin' },
							{ row: 90, label: 'Attendance', href: '/team/attendance' },
						],
					},
					{
						row: 92,
						label: 'Knowledge',
						icon: 'knowledge',
						children: [
							{ row: 92, label: 'Knowledge Base', href: '/team/knowledge-base' },
							{ row: 93, label: 'Sessions', href: '/team/sessions' },
							{ row: 94, label: 'Templates', href: '/team/templates' },
							{ row: 95, label: 'Onboarding', href: '/team/onboarding' },
						],
					},
					// Hiring (0128): exec/admin/manager in the matrix.
					{
						row: 97,
						label: 'Hiring',
						icon: 'hiring',
						module: 'hiring',
						children: [
							{ row: 97, label: 'Positions', href: '/hiring/positions', module: 'hiring' },
							{ row: 98, label: 'Requests', href: '/hiring/requests', module: 'hiring' },
							{ row: 99, label: 'Postings', href: '/hiring/postings', module: 'hiring' },
							{ row: 100, label: 'Candidates', href: '/hiring/candidates', module: 'hiring' },
							{ row: 101, label: 'Message review', href: '/hiring/inbox', module: 'hiring' },
							{ row: 102, label: 'Quality', href: '/hiring/quality', module: 'hiring' },
						],
					},
				],
			},
		],
	},
	{
		key: 'management',
		label: 'Management',
		row: 105,
		href: '/dashboard',
		// Managers and admins only (Alex). Links keep their own module gates
		// (Dashboards is open to every role in the matrix, Admin/Data are not).
		visibility: 'manager',
		owns: ['/dashboard', '/admin', '/data'],
		groups: [
			{
				title: 'Organization',
				row: 105,
				major: true,
				items: [
					// "Management lands here." On screen: tabs at top to switch
					// between areas, general first.
					{
						row: 106,
						label: 'Dashboards',
						icon: 'dashboards',
						module: 'dashboard',
						tabs: DASHBOARD_TABS.map((t) => ({ ...t, module: 'dashboard' as const })),
					},
					// On screen: pending requests (filter by type), approval setup
					// per request type = the Innovation Desk pipeline over every
					// staff_requests row.
					{ row: 108, label: 'Requests Desk', icon: 'requests-desk', href: '/admin/innovation-desk', module: 'admin' },
					{
						row: 110,
						label: 'Team Systems',
						icon: 'team-systems',
						children: [
							// The CEO sheet's Daily layout.
							{ row: 110, label: 'KPIs', href: '/dashboard/metrics', module: 'dashboard' },
							// Row 111 "Departments" is deleted from the menu (Alex
							// 11/10): row 117 below is the one Departments row.
							// Sheet spells it "Calibration Cyles" (spelling fixed, see navSheet.test.ts).
							{ row: 112, label: 'Calibration Cycles', href: '/admin/calibration', module: 'admin' },
							// The tool + its settings half.
							{ row: 113, label: 'Time Studies', href: '/social/time-study', module: 'social', activeFor: ['/admin/time-study'] },
							{ row: 114, label: 'Attendance Settings', href: '/admin/attendance', module: 'admin' },
							{ row: 115, label: 'Metrics Catalog', href: '/admin/metrics', module: 'admin' },
							{ row: 116, label: 'Brand', href: '/admin/brand', module: 'admin' },
							// Departments & Sub-Teams.
							{ row: 117, label: 'Departments', href: '/admin/tags', module: 'admin' },
							// Positions & Specialties.
							{ row: 118, label: 'Positions', href: '/admin/positions', module: 'admin' },
						],
					},
				],
			},
			{
				title: 'Admin',
				row: 120,
				items: [
					{
						row: 120,
						label: 'Users',
						icon: 'users',
						children: [
							{ row: 120, label: 'User Management', href: '/admin/users', module: 'admin' },
							{ row: 121, label: 'Roles', href: '/admin/roles', module: 'admin' },
							{ row: 122, label: 'Capabilities', href: '/admin/capabilities', module: 'admin' },
						],
					},
					{
						row: 124,
						label: 'Platform',
						icon: 'platform',
						children: [
							// "The panel for settings/tools in every area not on the
							// menus": Design System settings, AI spend limits,
							// Connections, module settings. The /admin prefix
							// lights it on every admin page no other row lists.
							{ row: 124, label: 'Admin Overview', href: '/admin', module: 'admin' },
							{ row: 125, label: 'Bot roster', href: '/admin/bots', module: 'admin' },
							{ row: 126, label: 'Agentic Approval', href: soonHref('agentic-approval'), visibility: 'wip' },
							{ row: 127, label: 'Routing rules', href: soonHref('routing-rules'), visibility: 'wip' },
							{ row: 128, label: 'AI Providers', href: '/admin/providers', module: 'admin' },
							{ row: 129, label: 'Analytics and costs', href: soonHref('analytics-costs'), visibility: 'wip' },
						],
					},
					// Data: the advanced layer, admin-only by product decision (N2).
					{
						row: 131,
						label: 'Data',
						icon: 'data',
						children: [
							{ row: 131, label: 'Bases', href: '/data', module: 'data' },
							{ row: 132, label: 'Tables', href: '/data/bases', module: 'data' },
							{ row: 133, label: 'Sheets', href: '/data/sheets', module: 'data' },
							// On screen: Import Data Tool. Row 135 note: "Formerly
							// Pipeline", so the pipeline page lights it too.
							{ row: 134, label: 'Imports', href: '/data/imports', module: 'data', activeFor: ['/data/pipeline'] },
						],
					},
				],
			},
		],
	},
];

/** Header tabs, in order. Same objects as navSections minus the sidebar. */
export const topNavItems: TopNavItem[] = navSections.map(({ key, label, href, module, visibility }) => ({
	key,
	label,
	href,
	...(module ? { module } : {}),
	...(visibility ? { visibility } : {}),
}));

/** Where a destination sits: [primary label, sub label?, tab label?]. */
export interface NavLinkEntry extends SideNavItem {
	trail: string[];
	/** The section heading the row sits under. */
	group: string;
	/** 0 = a section heading with its own page, 1 = primary row, 2 = sub menu row, 3 = a tab on a primary's page. */
	level: 0 | 1 | 2 | 3;
	/** Sheet row (a tab carries its primary's row). */
	row: number;
}

/** Every destination of one menu (rows with an href, plus tabs), in order. */
export function menuLinks(groups: NavGroup[]): NavLinkEntry[] {
	const out: NavLinkEntry[] = [];
	// A link inherits the gate of the row it sits in when it has none of its
	// own, so a flat reader never shows a link the sidebar would hide.
	const push = (node: SideNavItem, parent: NavGate | null, trail: string[], group: string, level: 0 | 1 | 2 | 3, row: number) => {
		const visibility = node.visibility ?? parent?.visibility;
		const moduleKey = node.module ?? parent?.module;
		const capability = node.capability ?? parent?.capability;
		out.push({
			label: node.label,
			href: node.href,
			...(node.activeFor ? { activeFor: node.activeFor } : {}),
			...(node.exact ? { exact: true } : {}),
			...(visibility ? { visibility } : {}),
			...(moduleKey ? { module: moduleKey } : {}),
			...(capability ? { capability } : {}),
			trail,
			group,
			level,
			row,
		});
	};
	for (const g of groups) {
		if (g.link) push({ label: g.title, ...g.link }, null, [g.title], g.title, 0, g.row);
		for (const top of g.items) {
			if (top.children) for (const sub of top.children) push(sub, top, [top.label, sub.label], g.title, 2, sub.row);
			else if (top.tabs) for (const t of top.tabs) push(t, top, [top.label, t.label], g.title, 3, top.row);
			else push(top, null, [top.label], g.title, 1, top.row);
		}
	}
	return out;
}

/** Destinations per menu key, flat — the shape the tests and the search index read. */
export const sideNavMap: Record<NavSectionKey, NavLinkEntry[]> = Object.fromEntries(
	navSections.map((s) => [s.key, menuLinks(s.groups)]),
) as Record<NavSectionKey, NavLinkEntry[]>;

// ---------------------------------------------------------------------------
// Top buttons (sheet rows 2-10), right side, left to right: Search,
// Calendar, Notifications, Profile. The Profile menu shows Name, Email, Role,
// then My Profile / Requests / Settings / Sign Out (Sign Out is a button in
// TopNav). '{me}' is replaced by the signed-in profile id at render time.
// ---------------------------------------------------------------------------

export interface ProfileMenuItem extends SideNavItem {
	row: number;
}

export const profileMenuItems: ProfileMenuItem[] = [
	{ row: 7, label: 'My Profile', href: '/team/{me}' },
	// Every request the viewer has filed (staff_requests: time off,
	// innovation ideas, positions, the old /team/requests kinds).
	{ row: 8, label: 'Requests', href: '/the-work/innovation-desk' },
	// On screen: Light/Dark, Connections.
	{ row: 9, label: 'Settings', href: '/settings' },
];

/** Row 10: the Profile menu's last entry (a button, not a link). */
export const SIGN_OUT_LABEL = 'Sign Out';

/** My Calendar — same engine as Work › Planning Calendars (row 4). */
export const calendarItem: SideNavItem = { label: 'Calendar', href: '/the-work/calendar' };

// ---------------------------------------------------------------------------
// "+ New" (row 12: top of the side menu). CREATE and REQUEST groups from the
// sheet's Request Types tab. `href` opens the existing creation page or form;
// `event` fires a window event instead (Task → the NewItemModal that boards
// and Self already use). Options without a page point at /soon.
// ---------------------------------------------------------------------------

export interface NewMenuOption {
	label: string;
	/** One line: who it goes to / what it becomes. */
	hint: string;
	href?: string;
	/** window event to dispatch instead of navigating. */
	event?: 'or-quick-add';
	module?: ModuleKey;
	visibility?: NavVisibility;
}

export interface NewMenuGroup {
	title: 'Create' | 'Request';
	options: NewMenuOption[];
}

export const newMenuGroups: NewMenuGroup[] = [
	{
		title: 'Create',
		options: [
			{ label: 'Task', hint: 'Own work, no approval', event: 'or-quick-add' },
			{ label: 'Project', hint: 'Planning & Priorities', href: '/the-work/planning', module: 'the_work' },
			{ label: 'Post', hint: 'Post Creator; client approves in the portal', href: '/social/studio', module: 'social' },
			{ label: 'Client', hint: 'New client record', href: '/clients', module: 'clients' },
			{ label: 'Prospect', hint: 'Growth › Pipeline', href: '/prospects/deals/new', module: 'prospects' },
			{ label: 'Ask a bot', hint: 'Scout routes it; pre-approved actions auto-execute', href: soonHref('ask-a-bot'), visibility: 'wip' },
		],
	},
	{
		title: 'Request',
		options: [
			{ label: 'Content', hint: 'Content team queue; content lead accepts', href: '/the-work/content-requests' },
			{ label: 'Innovation idea', hint: 'Innovation Desk reviews', href: '/the-work/innovation-desk', module: 'the_work' },
			{ label: 'Time off', hint: 'Your manager approves', href: '/team/{me}?tab=timeoff' },
			{ label: 'Project / task for another team', hint: 'Manager prioritizes', href: soonHref('request-project'), visibility: 'wip' },
			{ label: 'New position', hint: 'Execs approve', href: '/hiring/requests?new=1', module: 'hiring' },
			{ label: 'Access / tool', hint: 'Admin task', href: soonHref('request-access'), visibility: 'wip' },
			{ label: 'Purchase / expense', hint: 'Manager + Finance', href: soonHref('request-purchase'), visibility: 'wip' },
			{ label: 'Client ticket', hint: "On behalf of a client; the account team works it", href: '/clients/tickets', module: 'clients' },
		],
	},
];

/**
 * Work › Overview "Ask for…" tiles (sheet: Content, Time off, Idea, Project,
 * Position, Access/Purchase). Each names the + New › Request option it
 * stands for; `also` = a second option the tile covers (Access / Purchase).
 */
export const ASK_FOR_TILES: { label: string; option: string; also?: string }[] = [
	{ label: 'Content', option: 'Content' },
	{ label: 'Time off', option: 'Time off' },
	{ label: 'Idea', option: 'Innovation idea' },
	{ label: 'Project', option: 'Project / task for another team' },
	{ label: 'Position', option: 'New position' },
	{ label: 'Access / Purchase', option: 'Access / tool', also: 'Purchase / expense' },
];

/** The + New option a label names (Create or Request), or undefined. */
export function newMenuOption(label: string): NewMenuOption | undefined {
	for (const g of newMenuGroups) {
		const hit = g.options.find((o) => o.label === label);
		if (hit) return hit;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Visibility rules
// ---------------------------------------------------------------------------

/** Runtime facts the nav cannot read from the profile alone. */
export interface NavFlags {
	/** A calibration cycle is open right now (SideNav polls calibration_cycles). */
	calibrationOpen?: boolean;
	/** The viewer's own user_capabilities rows (SideNav reads them). Unknown = none. */
	capabilities?: readonly string[];
}

/** WIP pages: visible to admins/execs and the Dev department. */
export function canSeeWip(profile: Profile | null): boolean {
	if (!profile) return false;
	return profile.role === 'admin' || profile.role === 'exec' || profile.department === 'Dev';
}

/** Managers and up (Management menu, Check-ins). */
export function isManagerOrAbove(profile: Profile | null): boolean {
	if (!profile) return false;
	return profile.role === 'manager' || profile.role === 'exec' || profile.role === 'admin';
}

/**
 * Module access for nav filtering. `modules` comes from the auth store
 * (seeded by AppLayout from role_permissions — migration 0024). While the
 * matrix is unresolved (null) we fall back to the legacy role rules so the
 * nav never flashes wrong entries pre-hydration or pre-migration.
 */
export function canAccessModule(
	profile: Profile | null,
	modules: ModuleKey[] | null,
	moduleKey: ModuleKey,
): boolean {
	if (!profile) return false;
	const effective = modules ?? legacyDefaultModules(profile.role);
	return effective.includes(moduleKey);
}

export function isItemVisible(
	item: NavGate,
	profile: Profile | null,
	modules: ModuleKey[] | null = null,
	flags: NavFlags = {},
): boolean {
	if (item.module && !canAccessModule(profile, modules, item.module)) return false;
	if (item.capability && (!profile || !(flags.capabilities ?? []).includes(item.capability))) return false;
	if (!item.visibility) return true;
	if (item.visibility === 'wip') return canSeeWip(profile);
	// Calibration (0118) exists only while a cycle is open; the page itself
	// says "no cycle open" if reached by URL.
	if (item.visibility === 'cycle') return !!profile && !!flags.calibrationOpen;
	if (item.visibility === 'manager') return isManagerOrAbove(profile);
	return canAccessModule(profile, modules, 'admin');
}

// ---------------------------------------------------------------------------
// Which menu a pathname belongs to
// ---------------------------------------------------------------------------

function pathOf(href: string): string {
	return href.split('?')[0];
}

function under(pathname: string, prefix: string): boolean {
	if (prefix === '/') return pathname === '/';
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The menus that list a page for this pathname, best match first, or [] —
 * `len` is the length of the matching href / activeFor path. A menu is not a
 * URL prefix, so the LISTED pages decide: the destination whose href (or
 * activeFor prefix) matches the longest wins, and deeper pages under it count
 * too (opening a session from Team, /team/sessions/<id>, keeps Team). '/'
 * never participates in prefix matching — every path starts with it — and is
 * only ever an exact match.
 */
function listedMatches(pathname: string): { key: NavSectionKey; len: number }[] {
	const best = new Map<NavSectionKey, number>();
	for (const section of navSections) {
		for (const item of sideNavMap[section.key]) {
			for (const c of [pathOf(item.href), ...(item.activeFor ?? []).map(pathOf)]) {
				if (c.includes('{me}')) continue;
				if (under(pathname, c) && c.length > (best.get(section.key) ?? -1)) best.set(section.key, c.length);
			}
		}
	}
	return [...best.entries()].map(([key, len]) => ({ key, len })).sort((a, b) => b.len - a.len);
}

/**
 * Which top menu a pathname belongs to ('' when none — /auth, /chat,
 * /settings).
 *
 * Listed pages first (see listedMatches). A page two menus list equally
 * well (/dashboard/social: Work › Client Work › Social › Reports and a
 * Management › Dashboards tab) goes to `prefer` when it is one of them — the
 * menu the viewer came from (menuPreference.ts) — else to the first menu.
 * Then the `owns` prefixes as a fallback for unlisted pages (record pages,
 * wizards), longest first.
 */
export function sectionForPath(pathname: string, prefer?: NavSectionKey | '' | null): NavSectionKey | '' {
	if (pathname === '/') return 'work';

	const listed = listedMatches(pathname);
	if (listed.length) {
		const top = listed.filter((m) => m.len === listed[0].len);
		const preferred = prefer ? top.find((m) => m.key === prefer) : undefined;
		return (preferred ?? top[0]).key;
	}

	let owner: { key: NavSectionKey; len: number } | null = null;
	for (const section of navSections) {
		for (const prefix of section.owns) {
			if (under(pathname, prefix) && (!owner || prefix.length > owner.len)) owner = { key: section.key, len: prefix.length };
		}
	}
	return owner?.key ?? '';
}

export function sectionByKey(key: string): NavSection | undefined {
	return navSections.find((s) => s.key === key);
}
