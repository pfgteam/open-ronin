import { describe, it, expect } from 'vitest';
import { resolveWikilink, extractWikilinks, slugify, remarkWikilinks, type WikiPageRef } from './wikilinks';
import { diffLines, diffStats } from './diff';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';

const pages: WikiPageRef[] = [
	{ space: 'pr', slug: 'pitch-statuses', title: 'Pitch Statuses' },
	{ space: 'pr', slug: 'kpis', title: 'PR KPIs' },
	{ space: 'people', slug: 'onboarding', title: 'Onboarding' },
	{ space: 'overview', slug: 'kpis', title: 'Company KPIs' },
];

describe('resolveWikilink', () => {
	it('resolves a slug in the current space first', () => {
		const r = resolveWikilink('kpis', undefined, 'pr', pages);
		expect(r).toEqual({ href: '/team/knowledge-base/pr/kpis', label: 'PR KPIs', exists: true });
	});
	it('falls back to any space for a slug', () => {
		const r = resolveWikilink('onboarding', undefined, 'pr', pages);
		expect(r.href).toBe('/team/knowledge-base/people/onboarding');
		expect(r.exists).toBe(true);
	});
	it('resolves by title, case-insensitively', () => {
		const r = resolveWikilink('pitch statuses', undefined, 'pr', pages);
		expect(r.href).toBe('/team/knowledge-base/pr/pitch-statuses');
	});
	it('resolves space/slug explicitly', () => {
		const r = resolveWikilink('overview/kpis', 'the company ones', 'pr', pages);
		expect(r.href).toBe('/team/knowledge-base/overview/kpis');
		expect(r.label).toBe('the company ones');
	});
	it('keeps an explicit label, uses the page title otherwise', () => {
		expect(resolveWikilink('kpis', 'numbers', 'pr', pages).label).toBe('numbers');
		expect(resolveWikilink('kpis', undefined, 'pr', pages).label).toBe('PR KPIs');
	});
	it('makes a red link to the new-page form when nothing matches', () => {
		const r = resolveWikilink('Media List Hygiene', undefined, 'pr', pages);
		expect(r.exists).toBe(false);
		expect(r.label).toBe('Media List Hygiene');
		expect(r.href).toBe('/team/knowledge-base/pr/new?title=Media%20List%20Hygiene');
	});
});

describe('extractWikilinks', () => {
	it('lists unique targets in order, ignoring labels', () => {
		expect(extractWikilinks('see [[A]] and [[B|bee]] then [[A]] again')).toEqual(['A', 'B']);
	});
	it('ignores single brackets and empty targets', () => {
		expect(extractWikilinks('[not] a link [[]] [[ ]]')).toEqual([]);
	});
});

describe('slugify', () => {
	it('lowercases, dashes, trims', () => {
		expect(slugify('  Pitch Statuses & KPIs! ')).toBe('pitch-statuses-kpis');
	});
});

describe('remarkWikilinks', () => {
	const render = (md: string) =>
		unified()
			.use(remarkParse)
			.use(remarkWikilinks, { currentSpace: 'pr', pages })
			.use(remarkStringify)
			.processSync(md)
			.toString()
			.trim();

	/** Parse + run through remark-gfm and the plugin, returning the mdast tree (tables need gfm). */
	const gfmTree = (md: string): Root => {
		const proc = unified().use(remarkParse).use(remarkGfm).use(remarkWikilinks, { currentSpace: 'pr', pages });
		return proc.runSync(proc.parse(md)) as Root;
	};

	it('turns a wikilink into a markdown link', () => {
		expect(render('Read [[kpis]] first.')).toBe('Read [PR KPIs](/team/knowledge-base/pr/kpis) first.');
	});
	it('handles several links and a label in one paragraph', () => {
		expect(render('[[kpis|K]] and [[onboarding]]')).toBe(
			'[K](/team/knowledge-base/pr/kpis) and [Onboarding](/team/knowledge-base/people/onboarding)',
		);
	});
	it('leaves code spans alone', () => {
		expect(render('use `[[kpis]]` literally')).toBe('use `[[kpis]]` literally');
	});
	it('marks a missing page as a red link with a title', () => {
		expect(render('[[Nope]]')).toBe(
			'[Nope](/team/knowledge-base/pr/new?title=Nope "This page does not exist yet. Click to create it.")',
		);
	});
	it('resolves a labelled wikilink inside a GFM table cell when the pipe is escaped', () => {
		// remark-gfm splits table rows on `|` before this plugin runs, so a raw
		// `[[kpis|K]]` in a cell becomes two cells. Editors write `\|` instead.
		const tree = gfmTree('| A | B |\n|---|---|\n| x | [[kpis\\|K]] |\n');
		const links: { url: string; text: string }[] = [];
		const cells: number[] = [];
		visit(tree, 'tableRow', (row) => {
			cells.push(row.children.length);
		});
		visit(tree, 'link', (node) => {
			links.push({ url: node.url, text: node.children.map((c) => (c.type === 'text' ? c.value : '')).join('') });
		});
		expect(cells).toEqual([2, 2]);
		expect(links).toEqual([{ url: '/team/knowledge-base/pr/kpis', text: 'K' }]);
	});
	it('documents that an unescaped pipe in a table cell splits the link (why the seed uses \\|)', () => {
		const tree = gfmTree('| A | B |\n|---|---|\n| x | [[kpis|K]] |\n');
		const links: string[] = [];
		visit(tree, 'link', (node) => {
			links.push(node.url);
		});
		expect(links).toEqual([]);
	});
});

describe('diffLines', () => {
	it('reports equal input as all same', () => {
		const ops = diffLines('a\nb', 'a\nb');
		expect(ops.every((o) => o.kind === 'same')).toBe(true);
		expect(diffStats(ops)).toEqual({ added: 0, removed: 0 });
	});
	it('finds an insertion and a deletion', () => {
		const ops = diffLines('a\nb\nc', 'a\nx\nc\nd');
		expect(ops).toEqual([
			{ kind: 'same', text: 'a' },
			{ kind: 'del', text: 'b' },
			{ kind: 'add', text: 'x' },
			{ kind: 'same', text: 'c' },
			{ kind: 'add', text: 'd' },
		]);
		expect(diffStats(ops)).toEqual({ added: 2, removed: 1 });
	});
	it('handles empty before (new page)', () => {
		const ops = diffLines('', 'one\ntwo');
		expect(diffStats(ops)).toEqual({ added: 2, removed: 1 });
	});
});
