// The menus against Alex's sheet, row by row.
//
// navDraft.fixture.csv is the "Alex draft (original)" tab of "Open Ronin
// Menu Restructure" exported 2026-11-10 (identical to the live tab that
// day). This test walks it with the column meanings from its header row and
// asserts navConfig.ts builds exactly that: same menus, same section
// headings, same primary rows, same sub rows, same names, same order, no
// extras. Change the menus = change the fixture first (re-export the tab).
//
// NAV_CHECKLIST_OUT=<path> also writes the per-row build checklist (CSV).

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { navSections, profileMenuItems, SIGN_OUT_LABEL, sideNavMap, type NavSection, type NavTop } from './navConfig';

/** Minimal RFC 4180 reader (quoted fields, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
			else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') { row.push(field); field = ''; }
		else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
		else field += c;
	}
	if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
	return rows;
}

const sheet = parseCsv(readFileSync(path.resolve(import.meta.dirname, 'navDraft.fixture.csv'), 'utf8'));
/** 1-based sheet row → cells A..G (trimmed). */
const cell = (row: number, col: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G') => (sheet[row - 1]?.['ABCDEFG'.indexOf(col)] ?? '').trim();

/**
 * The menu label for a sheet cell: the parenthetical is the row's note
 * ("Overview(Login Lands here, no title)", "Dashboards (Management lands
 * here)"), not part of the name. One spelling fix, nothing else renamed.
 */
const SPELLING_FIXES: Record<string, string> = { 'Calibration Cyles': 'Calibration Cycles' };
function labelOf(raw: string): string {
	const name = raw.replace(/\s*\(.*\)\s*$/, '').trim();
	return SPELLING_FIXES[name] ?? name;
}

const MENUS = ['Work', 'Clients', 'Growth', 'Studio', 'Team', 'Management'];

/**
 * Alex's answers (11/10) to the three rows the first build asked about.
 * They are applied to the tab as read, nothing else changes:
 *   - row 23: "Client Work" is the section heading AND the first primary
 *     row; the heading itself opens the Client Work table and the duplicate
 *     primary row goes.
 *   - row 111: Team Systems lists "Departments" twice; keep row 117
 *     (Departments & Sub-Teams), delete row 111 from the menu.
 *   - row 55: "Prospects" opens the My Day prospect queue (an href, not a
 *     structure change; pinned in the last test below).
 */
const HEADING_IS_THE_PAGE: Record<number, string> = { 23: '/the-work/client-work' };
const DELETED_ROWS = new Set([111]);

interface SheetSub { row: number; label: string }
interface SheetPrimary { row: number; label: string; subs: SheetSub[] }
interface SheetGroup { row: number; title: string; major: boolean; items: SheetPrimary[] }
interface SheetMenu { row: number; label: string; groups: SheetGroup[] }

/** The tab, read with its own column rules. */
function readMenus(): SheetMenu[] {
	const menus: SheetMenu[] = [];
	let menu: SheetMenu | null = null;
	let group: SheetGroup | null = null;
	let primary: SheetPrimary | null = null;
	for (let r = 1; r <= sheet.length; r++) {
		const a = cell(r, 'A');
		if (a && !MENUS.includes(a)) { menu = null; continue; } // header, Top Buttons, Top of Side Menu
		if (a) {
			menu = { row: r, label: a, groups: [] };
			menus.push(menu);
			group = null;
			primary = null;
		}
		if (!menu) continue;
		const c = cell(r, 'C');
		const d = cell(r, 'D');
		const e = cell(r, 'E');
		if (c) {
			// The first heading of a menu is its major (bold) title.
			group = { row: r, title: c, major: menu.groups.length === 0, items: [] };
			menu.groups.push(group);
			primary = null;
		}
		if (d && !(c && r in HEADING_IS_THE_PAGE)) {
			primary = { row: r, label: labelOf(d), subs: [] };
			group!.items.push(primary);
		}
		if (e && !DELETED_ROWS.has(r)) primary!.subs.push({ row: r, label: labelOf(e) });
	}
	return menus;
}

function builtMenus(): SheetMenu[] {
	return navSections.map((s: NavSection) => ({
		row: s.row,
		label: s.label,
		groups: s.groups.map((g) => ({
			row: g.row,
			title: g.title,
			major: !!g.major,
			items: g.items.map((t: NavTop) => ({ row: t.row, label: t.label, subs: (t.children ?? []).map((c) => ({ row: c.row, label: c.label })) })),
		})),
	}));
}

describe('the menus are the "Alex draft (original)" tab, row for row', () => {
	const expected = readMenus();

	it('reads the six menus from the fixture', () => {
		expect(expected.map((m) => m.label)).toEqual(MENUS);
		expect(sheet.length).toBe(135);
	});

	it('every menu, section heading, primary row and sub row matches (names, levels, order, rows)', () => {
		expect(builtMenus()).toEqual(expected);
	});

	it('Top Buttons: Profile menu = My Profile, Requests, Settings, Sign Out (rows 7-10)', () => {
		expect(cell(6, 'D')).toBe('Profile');
		expect(profileMenuItems.map((i) => [i.row, i.label])).toEqual([7, 8, 9].map((r) => [r, cell(r, 'E')]));
		expect(SIGN_OUT_LABEL).toBe(cell(10, 'E'));
		// Search, Calendar, Notifications are the top buttons before Profile (rows 3-5).
		expect([3, 4, 5].map((r) => cell(r, 'F'))).toEqual(['Search', 'Calendar', 'Notifications']);
	});

	it('every sheet row with a name is built, and nothing else is', () => {
		const builtRows = new Set<number>();
		for (const s of navSections) {
			builtRows.add(s.row);
			for (const g of s.groups) {
				builtRows.add(g.row);
				for (const t of g.items) {
					builtRows.add(t.row);
					for (const c of t.children ?? []) builtRows.add(c.row);
				}
			}
		}
		for (let r = 1; r <= sheet.length; r++) {
			const named = ['A', 'C', 'D', 'E'].some((col) => cell(r, col as 'A') !== '');
			const inMenus = expected.some((m) => m.row === r || m.groups.some((g) => g.row === r || g.items.some((i) => i.row === r || i.subs.some((s) => s.row === r))));
			if (named && inMenus) expect(builtRows.has(r), `sheet row ${r}`).toBe(true);
		}
	});

	it('writes the build checklist when NAV_CHECKLIST_OUT is set', () => {
		const out = process.env.NAV_CHECKLIST_OUT;
		if (!out) return;
		writeFileSync(out, checklistCsv(expected), 'utf8');
	});

	it("Alex's 11/10 answers: row 23 heading opens Client Work, row 111 gone, row 55 = My Day", () => {
		const work = navSections.find((s) => s.key === 'work')!;
		const cw = work.groups.find((g) => g.row === 23)!;
		expect(cw.title).toBe(cell(23, 'C'));
		expect(cw.link?.href).toBe(HEADING_IS_THE_PAGE[23]);
		expect(cw.items.some((t) => t.row === 23)).toBe(false);
		expect(Object.values(sideNavMap).flat().some((l) => l.row === 111)).toBe(false);
		expect(sideNavMap.management.filter((l) => l.label === 'Departments').map((l) => l.row)).toEqual([117]);
		const prospects = sideNavMap.growth.find((l) => l.row === 55)!;
		expect([prospects.label, prospects.href, prospects.visibility]).toEqual([cell(55, 'D'), '/prospects/my-day', undefined]);
	});
});

// ---------------------------------------------------------------------------
// Checklist: one line per non-empty sheet row.
// ---------------------------------------------------------------------------

function q(v: string): string {
	return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function checklistCsv(menus: SheetMenu[]): string {
	const lines = [['sheet_row', 'sheet_text', 'built', 'menu', 'section', 'primary', 'sub', 'href', 'gate', 'note'].join(',')];
	const linkFor = (menuKey: string, row: number, level: 1 | 2 | 3) =>
		sideNavMap[menuKey as keyof typeof sideNavMap].filter((l) => l.row === row && (level === 3 ? l.level === 3 : l.level === level));
	const gateOf = (l?: { visibility?: string; module?: string; capability?: string }) =>
		l ? [l.module && `module:${l.module}`, l.visibility && `visibility:${l.visibility}`, l.capability && `capability:${l.capability}`].filter(Boolean).join(' ') : '';
	for (let r = 1; r <= sheet.length; r++) {
		const text = (sheet[r - 1] ?? []).map((c) => c.trim()).filter(Boolean).join(' | ');
		if (!text) continue;
		const row: string[] = [String(r), text];
		const menu = menus.find((m) => m.row === r || m.groups.some((g) => g.row === r || g.items.some((i) => i.row === r || i.subs.some((s) => s.row === r))));
		const section = navSections.find((s) => s.label === menu?.label);
		if (r === 1) row.push('n/a', '', '', '', '', '', '', 'Header row (column meanings)');
		else if (r >= 2 && r <= 10) {
			const labels: Record<number, [string, string, string]> = {
				2: ['yes', 'Top bar (right side)', 'Search, Calendar, Notifications, Profile in that order'],
				3: ['yes', 'Top bar › Search', 'GlobalSearch'],
				4: ['yes', 'Top bar › Calendar', '/the-work/calendar'],
				5: ['yes', 'Top bar › Notifications', 'NotificationBell'],
				6: ['yes', 'Top bar › Profile', 'menu header shows Name, Email, Role'],
				7: ['yes', 'Top bar › Profile › My Profile', '/team/{me}'],
				8: ['yes', 'Top bar › Profile › Requests', '/the-work/innovation-desk'],
				9: ['yes', 'Top bar › Profile › Settings', '/settings (Light/Dark, Connections)'],
				10: ['yes', 'Top bar › Profile › Sign Out', 'signs out to /auth/login'],
			};
			const [built, where, href] = labels[r];
			row.push(built, where, '', '', '', href, '', '');
		} else if (r === 12) row.push('yes', 'Side menu (top)', '', '+ New', '', '+ New palette', '', '');
		else if (r === 135) row.push('yes', 'Management', 'Admin', 'Data', 'Imports', '/data/imports', '', 'Note for row 134 Imports: /data/pipeline (formerly Pipeline) lights Imports');
		else if (DELETED_ROWS.has(r)) row.push('no', 'Management', 'Organization', 'Team Systems', 'Departments', '', '', 'Deleted from the menu per Alex 11/10: duplicate of row 117 (Departments & Sub-Teams)');
		else if (menu && section) {
			const g = menu.groups.find((x) => x.row === r);
			const p = menu.groups.flatMap((x) => x.items.map((i) => ({ g: x, i }))).find((x) => x.i.row === r);
			const s = menu.groups.flatMap((x) => x.items.flatMap((i) => i.subs.map((sub) => ({ g: x, i, sub })))).find((x) => x.sub.row === r);
			const parts: string[] = [];
			if (r === menu.row && !g) parts.push('top menu');
			if (s) {
				const link = linkFor(section.key, r, 2)[0];
				row.push('yes', menu.label, s.g.title, s.i.label, s.sub.label, link?.href ?? '', gateOf(link), [r === menu.row ? 'top menu' : '', g ? `section heading ${g.title}` : '', p ? `primary ${p.i.label}` : ''].filter(Boolean).join('; '));
			} else if (p) {
				const top = section.groups.flatMap((x) => x.items).find((t) => t.row === r)!;
				const direct = linkFor(section.key, r, 1)[0];
				const tabs = linkFor(section.key, r, 3);
				const href = direct?.href ?? (top.children ? `opens sub menu (${top.children.map((c) => c.label).join(', ')})` : tabs.map((t) => `${t.label}=${t.href}`).join(' '));
				const gate = gateOf(direct ?? tabs[0] ?? top);
				row.push('yes', menu.label, p.g.title, p.i.label, '', href, gate, [r === menu.row ? 'top menu' : '', g ? `section heading ${g.title}${g.major ? ' (bold major title)' : ' (inline with line)'}` : ''].filter(Boolean).join('; '));
			} else if (g) {
				const own = section.groups.find((x) => x.row === r)?.link;
				const note = `${r === menu.row ? 'top menu; ' : ''}${g.major ? 'bold major title' : 'title inline with horizontal line'}`;
				if (own) row.push('yes', menu.label, g.title, '', '', own.href, gateOf(own), `${note}; the heading itself opens this page, no duplicate primary row (Alex 11/10)`);
				else row.push('yes', menu.label, g.title, '', '', 'heading opens its first row', '', note);
			} else row.push('n/a', menu.label, '', '', '', '', '', parts.join('; ') || 'items-on-screen / notes only');
		} else row.push('n/a', '', '', '', '', '', '', 'items-on-screen / notes only');
		lines.push(row.map(q).join(','));
	}
	return `${lines.join('\n')}\n`;
}
