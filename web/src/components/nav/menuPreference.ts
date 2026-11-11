'use client';

// The menu the viewer is in, remembered for the session so a page two menus
// list equally well stays in the menu it was opened from: Work › Client Work
// › Social › Reports and Company › Dashboards › Departments › Social are the
// same /dashboard/social page (see sectionForPath's `prefer`).
//
// useSyncExternalStore with a null server snapshot: the server (and the
// hydration pass) render the default menu, then the client re-renders with
// the remembered one. No hydration mismatch.

import { useEffect, useSyncExternalStore } from 'react';
import { sectionForPath, type NavSectionKey } from './navConfig';

const KEY = 'or-nav-menu';
const listeners = new Set<() => void>();

function read(): NavSectionKey | null {
	try {
		return (sessionStorage.getItem(KEY) as NavSectionKey | null) ?? null;
	} catch {
		return null;
	}
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function write(key: NavSectionKey): void {
	try {
		if (sessionStorage.getItem(KEY) === key) return;
		sessionStorage.setItem(KEY, key);
	} catch {
		return;
	}
	for (const fn of listeners) fn();
}

/** The current menu for a pathname, honoring the remembered one on ties. */
export function useCurrentSection(pathname: string): NavSectionKey | '' {
	const prefer = useSyncExternalStore(subscribe, read, () => null);
	const section = sectionForPath(pathname, prefer);
	useEffect(() => {
		if (section) write(section);
	}, [section]);
	return section;
}
