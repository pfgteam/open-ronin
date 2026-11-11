// Light/Dark (Profile › Settings, sheet row 9). The choice persists in
// localStorage('theme'); with no choice the system preference decides.
// TopNav applies it on every page load; the Settings page changes it.

export type ThemeChoice = 'light' | 'dark';

const KEY = 'theme';

export function currentTheme(): ThemeChoice {
	const stored = localStorage.getItem(KEY);
	if (stored === 'dark' || stored === 'light') return stored;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyStoredTheme(): ThemeChoice {
	const theme = currentTheme();
	document.documentElement.classList.toggle('dark', theme === 'dark');
	return theme;
}

export function setTheme(theme: ThemeChoice): void {
	localStorage.setItem(KEY, theme);
	document.documentElement.classList.toggle('dark', theme === 'dark');
}
