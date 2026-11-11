// Client Work menu follows the organisation's service lines (setup wizard /
// service_lines table) instead of a fixed list. Built-in service menus are
// kept when their key is configured (and take the configured label); every
// other configured line gets a Deliverables entry filtered by ?service=<key>.
// With no service lines configured (setup not run) the menu is unchanged.

import type { NavGroup, NavTop } from './navConfig';

export interface ServiceLineNav {
	key: string;
	label: string;
}

/** Built-in Client Work menus and the service key each one represents. */
const BUILTIN: Record<string, string> = { PR: 'pr', Social: 'social', Writing: 'writing', Flywheel: 'flywheel', Beacon: 'beacon' };

export function withServiceLines(groups: NavGroup[], lines: readonly ServiceLineNav[] | undefined): NavGroup[] {
	if (!lines || lines.length === 0) return groups;
	const byKey = new Map(lines.map((l) => [l.key, l]));
	return groups.map((g) => {
		if (g.title !== 'Client Work') return g;
		const seen = new Set<string>();
		const items: NavTop[] = [];
		for (const item of g.items) {
			const key = BUILTIN[item.label];
			if (!key) {
				items.push(item);
				continue;
			}
			const line = byKey.get(key);
			if (!line) continue;
			seen.add(key);
			items.push({ ...item, label: line.label } as NavTop);
		}
		lines.forEach((l, i) => {
			if (seen.has(l.key)) return;
			items.push({
				row: 900 + i,
				label: l.label,
				icon: 'client-work',
				children: [{ row: 900 + i, label: 'Deliverables', href: `/clients/deliverables?service=${encodeURIComponent(l.key)}`, module: 'clients' }],
			});
		});
		return { ...g, items };
	});
}
