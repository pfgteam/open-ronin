// Prospects list URL contracts (spec 2026-10-15-prospects-lists-design.md
// §4.1, §5): the Pipeline screen (/prospects) and Contacts
// (/prospects/contacts). Pure, shared by the pages, the filter bar and the
// tests. Defaults are omitted from hrefs so links stay short.

import { PAGE_SIZE, PAGE_SIZES } from '@/lib/pagination';
import { SOURCES, type Source } from './shared';

export { PAGE_SIZE, PAGE_SIZES, pageWindow } from '@/lib/pagination';
export type StatusFilter = 'open' | 'won' | 'lost' | 'all';
export type PipelineView = 'board' | 'table';
export type DealSort = 'recent' | 'title' | 'value' | 'heat' | 'touch' | 'next';
export const SORT_DEFAULT_DIR: Record<DealSort, 'asc' | 'desc'> = { recent: 'desc', title: 'asc', value: 'desc', heat: 'desc', touch: 'desc', next: 'asc' };
const SORTS = Object.keys(SORT_DEFAULT_DIR) as DealSort[];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]+$/;

export interface PipelineFilters {
	view: PipelineView;
	pipeline: string | null;
	stage: string | null;
	/** 'me' or a profile uuid; null = anyone. */
	owner: string | null;
	/** What `owner` is when the URL names none: 'me' for reps (Toni 2026-10-22, each rep works their own leads), null for everyone else. */
	defaultOwner: 'me' | null;
	source: Source | null;
	status: StatusFilter;
	q: string | null;
	sort: DealSort;
	dir: 'asc' | 'desc';
	page: number;
	size: number;
}

function int(v: string | undefined, min: number): number | null {
	const n = Number.parseInt(v ?? '', 10);
	return Number.isFinite(n) && n >= min ? n : null;
}
function pageSize(v: string | undefined): number {
	const n = int(v, 1);
	return n && (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZE;
}
/** Every pipeline opens on the board (Toni, 2026-10-22); the table is one click away. */
const DEFAULT_VIEW: PipelineView = 'board';

export function parsePipelineFilters(sp: Record<string, string | undefined>, defaultOwner: 'me' | null = null): PipelineFilters {
	const pipeline = sp.pipeline && SLUG_RE.test(sp.pipeline) ? sp.pipeline : null;
	const sort = (SORTS as string[]).includes(sp.sort ?? '') ? (sp.sort as DealSort) : 'recent';
	return {
		view: sp.view === 'board' || sp.view === 'table' ? sp.view : DEFAULT_VIEW,
		pipeline,
		stage: sp.stage && UUID_RE.test(sp.stage) ? sp.stage : null,
		owner: sp.owner === 'all' ? null : sp.owner === 'me' || (sp.owner && UUID_RE.test(sp.owner)) ? sp.owner : defaultOwner,
		defaultOwner,
		source: (SOURCES as readonly string[]).includes(sp.source ?? '') ? (sp.source as Source) : null,
		status: sp.status === 'won' || sp.status === 'lost' || sp.status === 'all' ? sp.status : 'open',
		q: sp.q?.trim() ? sp.q.trim() : null,
		sort,
		dir: sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : SORT_DEFAULT_DIR[sort],
		page: int(sp.page, 2) ?? 1,
		size: pageSize(sp.size),
	};
}

export function pipelineHref(f: PipelineFilters, patch: Partial<PipelineFilters> = {}): string {
	const pipelineChanged = 'pipeline' in patch && patch.pipeline !== f.pipeline;
	const n: PipelineFilters = { ...f, page: 1, ...(pipelineChanged ? { stage: null } : {}), ...patch };
	const u = new URLSearchParams();
	if (n.pipeline) u.set('pipeline', n.pipeline);
	if (n.view !== DEFAULT_VIEW) u.set('view', n.view);
	if (n.stage) u.set('stage', n.stage);
	// ?owner=all is how a rep asks for everyone when their default is 'me'.
	if (n.owner !== n.defaultOwner) u.set('owner', n.owner ?? 'all');
	if (n.source) u.set('source', n.source);
	if (n.status !== 'open') u.set('status', n.status);
	if (n.q) u.set('q', n.q);
	if (n.sort !== 'recent') u.set('sort', n.sort);
	if (n.dir !== SORT_DEFAULT_DIR[n.sort]) u.set('dir', n.dir);
	if (n.page > 1) u.set('page', String(n.page));
	if (n.size !== PAGE_SIZE) u.set('size', String(n.size));
	const s = u.toString();
	return `/prospects${s ? `?${s}` : ''}`;
}

/** The board shows one pipeline: the requested one when active, else the first active. */
export function resolveBoardPipeline(f: PipelineFilters, activeSlugs: string[]): string | null {
	if (f.pipeline && activeSlugs.includes(f.pipeline)) return f.pipeline;
	return activeSlugs[0] ?? null;
}

/**
 * /prospects/deals (All prospects, P0) → the Pipeline table. A lane maps to
 * its pipeline only when it has exactly one; the view is always the table,
 * which is what All prospects was.
 */
export function legacyDealsHref(sp: Record<string, string | undefined>, pipelinesByLane: Record<string, string[]>): string {
	const lanePipes = sp.lane ? (pipelinesByLane[sp.lane] ?? []) : [];
	const f = parsePipelineFilters({ ...sp, pipeline: lanePipes.length === 1 ? lanePipes[0] : undefined, view: 'table' });
	return pipelineHref(f, { page: f.page });
}

// ------------------------------------------------------------ contacts

export type ContactsTab = 'people' | 'brands';
export type ContactsHas = 'all' | 'open' | 'none';
export interface ContactsFilters {
	tab: ContactsTab;
	has: ContactsHas;
	q: string | null;
	sort: 'updated' | 'name';
	page: number;
	size: number;
}

export function parseContactsFilters(sp: Record<string, string | undefined>): ContactsFilters {
	return {
		tab: sp.tab === 'brands' ? 'brands' : 'people',
		has: sp.has === 'open' || sp.has === 'none' ? sp.has : 'all',
		q: sp.q?.trim() ? sp.q.trim() : null,
		sort: sp.sort === 'name' ? 'name' : 'updated',
		page: int(sp.page, 2) ?? 1,
		size: pageSize(sp.size),
	};
}

export function contactsHref(f: ContactsFilters, patch: Partial<ContactsFilters> = {}): string {
	const n: ContactsFilters = { ...f, page: 1, ...patch };
	const u = new URLSearchParams();
	if (n.tab !== 'people') u.set('tab', n.tab);
	if (n.has !== 'all') u.set('has', n.has);
	if (n.q) u.set('q', n.q);
	if (n.sort !== 'updated') u.set('sort', n.sort);
	if (n.page > 1) u.set('page', String(n.page));
	if (n.size !== PAGE_SIZE) u.set('size', String(n.size));
	const s = u.toString();
	return `/prospects/contacts${s ? `?${s}` : ''}`;
}

export function pageRange(page: number, size: number = PAGE_SIZE): { from: number; to: number } {
	const from = (Math.max(1, page) - 1) * size;
	return { from, to: from + size - 1 };
}
