'use client';

// Settings › Light/Dark (sheet row 9). Two buttons; the pressed one is the
// active theme. Persists in localStorage via components/nav/theme.ts.

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { currentTheme, setTheme, type ThemeChoice } from '@/components/nav/theme';

const CHOICES: { value: ThemeChoice; label: string }[] = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
];

export default function ThemeSetting() {
	const [theme, setLocal] = useState<ThemeChoice | null>(null);
	useEffect(() => {
		setLocal(currentTheme());
	}, []);

	return (
		<div role="group" aria-label="Light/Dark" className="flex gap-2">
			{CHOICES.map((c) => (
				<Button
					key={c.value}
					type="button"
					size="sm"
					variant={theme === c.value ? 'primary' : 'outline'}
					aria-pressed={theme === c.value}
					onClick={() => {
						setTheme(c.value);
						setLocal(c.value);
					}}
				>
					{c.label}
				</Button>
			))}
		</div>
	);
}
