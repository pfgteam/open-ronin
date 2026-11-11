import { describe, expect, it } from 'vitest';
import { isTopDialog, popDialog, pushDialog, trapTab } from './dialogStack';

describe('dialog stack', () => {
	it('only the most recently opened dialog reacts to ESC', () => {
		const a = pushDialog();
		const b = pushDialog();
		expect(isTopDialog(a)).toBe(false);
		expect(isTopDialog(b)).toBe(true);
		popDialog(b);
		expect(isTopDialog(a)).toBe(true);
		popDialog(a);
	});
});

describe('trapTab', () => {
	it('wraps Tab from the last control to the first and Shift+Tab back', () => {
		expect(trapTab(3, 2, false)).toBe(0);
		expect(trapTab(3, 0, true)).toBe(2);
	});
	it('pulls focus back in when it sits outside the dialog', () => {
		expect(trapTab(3, -1, false)).toBe(0);
		expect(trapTab(3, -1, true)).toBe(2);
	});
	it('leaves moves between inner controls to the browser', () => {
		expect(trapTab(3, 1, false)).toBeNull();
		expect(trapTab(0, -1, false)).toBeNull();
	});
});
