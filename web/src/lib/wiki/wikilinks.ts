// Wikilinks: `[[Target]]` / `[[Target|Label]]` inside wiki markdown.
//
// Target forms, resolved in this order:
//   [[space/slug]]      exact page in a named space
//   [[slug]]            page slug in the CURRENT space, then any space
//   [[Page Title]]      page title (case-insensitive) in the current space,
//                       then any space
// A target nothing matches becomes a Wikipedia-style "red link" pointing at
// the new-page form with the title prefilled, so writing the link first and
// the page second is a normal workflow, not an error.
//
// This file is pure (no React, no Supabase) so it can be unit tested and run
// on both the server render and the client-side editor preview.

import { visit } from 'unist-util-visit';
import type { Root, Text, Link, PhrasingContent } from 'mdast';
import type { Plugin } from 'unified';

export const WIKI_BASE = '/team/knowledge-base';

/** The minimum a resolver needs to know about every live page. */
export interface WikiPageRef {
	space: string;
	slug: string;
	title: string;
}

export interface ResolvedWikilink {
	href: string;
	label: string;
	/** false = red link (target page does not exist yet). */
	exists: boolean;
}

/** Same rule the server actions use for slugs; kept here so red-link hrefs and real slugs agree. */
export function slugify(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export function resolveWikilink(
	rawTarget: string,
	rawLabel: string | undefined,
	currentSpace: string,
	pages: readonly WikiPageRef[],
): ResolvedWikilink {
	const target = rawTarget.trim();
	const label = (rawLabel ?? target).trim() || target;
	const lower = target.toLowerCase();

	// [[space/slug]]
	const slash = target.indexOf('/');
	if (slash > 0) {
		const space = target.slice(0, slash).trim().toLowerCase();
		const slug = target.slice(slash + 1).trim().toLowerCase();
		const hit = pages.find((p) => p.space === space && p.slug === slug);
		if (hit) return { href: `${WIKI_BASE}/${hit.space}/${hit.slug}`, label: rawLabel ? label : hit.title, exists: true };
		return { href: newPageHref(space, slug.replace(/-/g, ' ')), label, exists: false };
	}

	const inSpace = pages.filter((p) => p.space === currentSpace);
	const bySlug = (list: readonly WikiPageRef[]) => list.find((p) => p.slug === lower);
	const byTitle = (list: readonly WikiPageRef[]) => list.find((p) => p.title.toLowerCase() === lower);
	const hit = bySlug(inSpace) ?? byTitle(inSpace) ?? bySlug(pages) ?? byTitle(pages);
	if (hit) return { href: `${WIKI_BASE}/${hit.space}/${hit.slug}`, label: rawLabel ? label : hit.title, exists: true };
	return { href: newPageHref(currentSpace, target), label, exists: false };
}

function newPageHref(space: string, title: string): string {
	return `${WIKI_BASE}/${space}/new?title=${encodeURIComponent(title.trim())}`;
}

// `[[` ... `]]` with no nested brackets or newlines. Label after the first `|`.
const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

/** Every wikilink target in a body, in order, deduplicated. Used for "what links here" and link previews. */
export function extractWikilinks(markdown: string): string[] {
	const out: string[] = [];
	for (const m of markdown.matchAll(WIKILINK_RE)) {
		const t = m[1].trim();
		if (t && !out.includes(t)) out.push(t);
	}
	return out;
}

/**
 * remark plugin: split text nodes on wikilinks and emit mdast `link` nodes.
 * Red links carry `data-wikilink="missing"` so the renderer can style them.
 * Code spans and fenced blocks are untouched (they are not `text` nodes).
 */
export const remarkWikilinks: Plugin<[{ currentSpace: string; pages: readonly WikiPageRef[] }], Root> =
	({ currentSpace, pages }) =>
	(tree) => {
		visit(tree, 'text', (node: Text, index, parent) => {
			if (!parent || index === undefined) return;
			if (parent.type === 'link' || parent.type === 'linkReference') return;
			const value = node.value;
			if (!value.includes('[[')) return;

			const pieces: PhrasingContent[] = [];
			let last = 0;
			for (const m of value.matchAll(WIKILINK_RE)) {
				const start = m.index ?? 0;
				if (start > last) pieces.push({ type: 'text', value: value.slice(last, start) });
				const r = resolveWikilink(m[1], m[2], currentSpace, pages);
				const link: Link = {
					type: 'link',
					url: r.href,
					title: r.exists ? null : 'This page does not exist yet. Click to create it.',
					children: [{ type: 'text', value: r.label }],
					data: { hProperties: { 'data-wikilink': r.exists ? 'page' : 'missing' } },
				};
				pieces.push(link);
				last = start + m[0].length;
			}
			if (pieces.length === 0) return;
			if (last < value.length) pieces.push({ type: 'text', value: value.slice(last) });
			parent.children.splice(index, 1, ...pieces);
			return index + pieces.length;
		});
	};
