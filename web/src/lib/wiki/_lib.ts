// Wiki data layer - Supabase reads for spaces, pages, revisions, playbook links.
//
// Model (0005 + 0074): wiki_pages holds only APPROVED content. Every edit is a
// wiki_revisions row that starts `pending` and becomes the live page when an
// approver publishes it. Reads here are all through the user-scoped client so
// RLS applies; writes live in app/(app)/team/knowledge-base/actions.ts.
//
// Drive ingestion (drive_sync_queue) is still unbuilt; the UI hides its
// affordances until a worker exists.

import { createClient } from '@/lib/supabase/server';
import type { WikiPageRef } from './wikilinks';

export const WIKI_BASE = '/team/knowledge-base';

export interface WikiSpace {
	id: string;
	slug: string;
	name: string;
	description_md: string | null;
	icon: string | null;
	visibility: string;
	position: number;
	archived: boolean;
}

export interface WikiPage {
	id: string;
	space_id: string;
	parent_page_id: string | null;
	slug: string;
	title: string;
	body_md: string;
	drive_file_id: string | null;
	drive_file_url: string | null;
	drive_mime_type: string | null;
	drive_last_synced_at: string | null;
	visibility: string | null;
	position: number;
	archived: boolean;
	last_edited_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface PersonRef {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
}

export type RevisionKind = 'create' | 'edit';
export type RevisionStatus = 'pending' | 'approved' | 'rejected';

export interface WikiRevision {
	id: string;
	page_id: string | null;
	space_id: string | null;
	slug: string | null;
	parent_page_id: string | null;
	title: string;
	body_md: string | null;
	kind: RevisionKind;
	status: RevisionStatus;
	reason: string | null;
	edited_by: string | null;
	edited_at: string;
	reviewed_by: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	author: PersonRef | null;
	reviewer: PersonRef | null;
	/** Live page (edit revisions, and create revisions once published). */
	page: { id: string; slug: string; title: string; visibility: string | null; space: { slug: string; name: string; visibility: string } | null } | null;
	/** Target space for create revisions. */
	space: { slug: string; name: string; visibility: string } | null;
}

/**
 * Effective visibility of what a revision touches: the live page's override,
 * else its space, else the target space of a create revision. Every surface
 * that lists or renders revisions must pass this through `isVisibleTo()`;
 * RLS lets any signed-in user read wiki_revisions, so managers-only content
 * would otherwise leak through the review queue and "Recently published".
 */
export function revisionVisibility(rev: Pick<WikiRevision, 'page' | 'space'>): string | null {
	return rev.page?.visibility ?? rev.page?.space?.visibility ?? rev.space?.visibility ?? null;
}

export interface PlaybookLink {
	id: string;
	title: string;
	drive_file_id: string;
	drive_url: string;
	category: string | null;
	description_md: string | null;
	is_canonical: boolean;
}

export function personName(p: PersonRef | null | undefined): string {
	if (!p) return 'Someone';
	const n = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
	return n || p.email;
}

// ---------------------------------------------------------------- spaces

export async function listSpaces(): Promise<WikiSpace[]> {
	const supabase = await createClient();
	const { data } = await supabase
		.from('wiki_spaces')
		.select('*')
		.eq('archived', false)
		.order('position', { ascending: true });
	return (data ?? []) as WikiSpace[];
}

export async function getSpaceBySlug(slug: string): Promise<WikiSpace | null> {
	const supabase = await createClient();
	const { data } = await supabase.from('wiki_spaces').select('*').eq('slug', slug).maybeSingle();
	return (data ?? null) as WikiSpace | null;
}

// ---------------------------------------------------------------- pages

export async function listPagesInSpace(spaceId: string): Promise<WikiPage[]> {
	const supabase = await createClient();
	const { data } = await supabase
		.from('wiki_pages')
		.select('*')
		.eq('space_id', spaceId)
		.eq('archived', false)
		.order('position', { ascending: true })
		.order('title', { ascending: true });
	return (data ?? []) as WikiPage[];
}

export async function getPage(spaceSlug: string, pageSlug: string): Promise<WikiPage | null> {
	const supabase = await createClient();
	const { data: space } = await supabase.from('wiki_spaces').select('id').eq('slug', spaceSlug).maybeSingle();
	if (!space) return null;
	const { data } = await supabase
		.from('wiki_pages')
		.select('*')
		.eq('space_id', space.id)
		.eq('slug', pageSlug)
		.maybeSingle();
	return (data ?? null) as WikiPage | null;
}

export async function getPageById(id: string): Promise<WikiPage | null> {
	const supabase = await createClient();
	const { data } = await supabase.from('wiki_pages').select('*').eq('id', id).maybeSingle();
	return (data ?? null) as WikiPage | null;
}

/**
 * Every live, unarchived page as a (space, slug, title) triple. This is what
 * wikilinks resolve against; a few hundred rows at most, fetched once per
 * render and passed to the markdown renderer.
 */
export async function listPageRefs(): Promise<WikiPageRef[]> {
	const supabase = await createClient();
	const { data } = await supabase
		.from('wiki_pages')
		.select('slug, title, space:wiki_spaces(slug)')
		.eq('archived', false);
	const rows = (data ?? []) as unknown as { slug: string; title: string; space: { slug: string } | null }[];
	return rows.filter((r) => r.space).map((r) => ({ space: r.space!.slug, slug: r.slug, title: r.title }));
}

export interface SearchHit {
	id: string;
	slug: string;
	title: string;
	updated_at: string;
	snippet: string;
	space: { slug: string; name: string; visibility: string };
}

/** Title/body substring search. Plain `ilike`: the corpus is small and this needs no extra column. */
export async function searchPages(query: string, limit = 25): Promise<SearchHit[]> {
	const q = query.trim();
	if (q.length < 2) return [];
	const supabase = await createClient();
	const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
	const { data } = await supabase
		.from('wiki_pages')
		.select('id, slug, title, body_md, updated_at, space:wiki_spaces(slug, name, visibility)')
		.eq('archived', false)
		.or(`title.ilike.${pattern},body_md.ilike.${pattern}`)
		.order('updated_at', { ascending: false })
		.limit(limit);
	const rows = (data ?? []) as unknown as (Omit<SearchHit, 'snippet' | 'space'> & { body_md: string | null; space: SearchHit['space'] | null })[];
	return rows
		.filter((r) => r.space)
		.map((r) => ({
			id: r.id,
			slug: r.slug,
			title: r.title,
			updated_at: r.updated_at,
			space: r.space!,
			snippet: snippetAround(r.body_md ?? '', q),
		}));
}

function snippetAround(body: string, q: string, radius = 90): string {
	const plain = body.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ');
	const at = plain.toLowerCase().indexOf(q.toLowerCase());
	if (at < 0) return plain.slice(0, radius * 2).trim();
	const start = Math.max(0, at - radius);
	const end = Math.min(plain.length, at + q.length + radius);
	return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

/** Pages whose body contains a wikilink that could point at this page (by slug or title). Callers filter by `visibility ?? space.visibility`. */
export async function listBacklinks(page: { slug: string; title: string }, limit = 20): Promise<{ id: string; slug: string; title: string; visibility: string | null; space: { slug: string; name: string; visibility: string } }[]> {
	const supabase = await createClient();
	const esc = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);
	const { data } = await supabase
		.from('wiki_pages')
		.select('id, slug, title, visibility, space:wiki_spaces(slug, name, visibility)')
		.eq('archived', false)
		.or(`body_md.ilike.%[[${esc(page.slug)}%,body_md.ilike.%[[${esc(page.title)}%,body_md.ilike.%/${esc(page.slug)}]]%,body_md.ilike.%/${esc(page.slug)}|%`)
		.order('title', { ascending: true })
		.limit(limit);
	const rows = (data ?? []) as unknown as { id: string; slug: string; title: string; visibility: string | null; space: { slug: string; name: string; visibility: string } | null }[];
	return rows.filter((r) => r.space && !(r.slug === page.slug)).map((r) => ({ ...r, space: r.space! }));
}

// ---------------------------------------------------------------- revisions

// Two FKs point at profiles and two at wiki_pages, so every embed names its
// constraint (PostgREST refuses an ambiguous join).
const REVISION_SELECT = `
	id, page_id, space_id, slug, parent_page_id, title, body_md, kind, status, reason,
	edited_by, edited_at, reviewed_by, reviewed_at, review_note,
	author:profiles!wiki_revisions_edited_by_fkey(id, first_name, last_name, email),
	reviewer:profiles!wiki_revisions_reviewed_by_fkey(id, first_name, last_name, email),
	page:wiki_pages!wiki_revisions_page_id_fkey(id, slug, title, visibility, space:wiki_spaces(slug, name, visibility)),
	space:wiki_spaces!wiki_revisions_space_id_fkey(slug, name, visibility)
`;

export async function getRevision(id: string): Promise<WikiRevision | null> {
	const supabase = await createClient();
	const { data } = await supabase.from('wiki_revisions').select(REVISION_SELECT).eq('id', id).maybeSingle();
	return (data ?? null) as unknown as WikiRevision | null;
}

export async function listRevisions(opts: { status?: RevisionStatus; pageId?: string; authorId?: string; limit?: number }): Promise<WikiRevision[]> {
	const supabase = await createClient();
	let q = supabase.from('wiki_revisions').select(REVISION_SELECT).order('edited_at', { ascending: false }).limit(opts.limit ?? 50);
	if (opts.status) q = q.eq('status', opts.status);
	if (opts.pageId) q = q.eq('page_id', opts.pageId);
	if (opts.authorId) q = q.eq('edited_by', opts.authorId);
	const { data } = await q;
	return ((data ?? []) as unknown as WikiRevision[]).filter((r) => r.kind === 'create' || r.page);
}

export async function countPendingRevisions(): Promise<number> {
	const supabase = await createClient();
	const { count } = await supabase.from('wiki_revisions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
	return count ?? 0;
}

/** Pending revisions that would change this page (shown as a banner on the article). */
export async function listPendingForPage(pageId: string): Promise<WikiRevision[]> {
	return listRevisions({ status: 'pending', pageId, limit: 10 });
}

// ---------------------------------------------------------------- playbooks

export async function listPlaybookLinks(category?: string): Promise<PlaybookLink[]> {
	const supabase = await createClient();
	let q = supabase
		.from('playbook_links')
		.select('*')
		.order('is_canonical', { ascending: false })
		.order('title', { ascending: true });
	if (category) q = q.eq('category', category);
	const { data } = await q;
	return (data ?? []) as PlaybookLink[];
}

// ---------------------------------------------------------------- tree

export interface PageNode {
	page: WikiPage;
	children: PageNode[];
}

/** Nest a flat page list by parent_page_id. Orphans (parent archived/missing) surface at the root. */
export function buildPageTree(pages: WikiPage[]): PageNode[] {
	const byId = new Map<string, PageNode>();
	for (const p of pages) byId.set(p.id, { page: p, children: [] });
	const roots: PageNode[] = [];
	for (const node of byId.values()) {
		const parent = node.page.parent_page_id ? byId.get(node.page.parent_page_id) : undefined;
		if (parent && parent !== node) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}
