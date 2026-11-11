'use client';

// Header checkbox that selects/clears every checkbox of one name inside its
// own <form>. Built for the lead-scraper review table, where the rows are
// plain <input name="record_id"> submitted to a server action — so the
// selection has no client state to hook into and the toggle has to drive the
// DOM inputs directly.
//
// Scoped to `form` via closest(), not the document: two review tables on one
// page must not toggle each other's rows.
//
// It also reflects the rows rather than just commanding them — untick one row
// and this goes indeterminate, tick the last one and it goes checked. Without
// that the header lies about the state of the page.

import { useCallback, useEffect, useRef, useState } from 'react';
import Checkbox from './Checkbox';

interface SelectAllCheckboxProps {
	/** The `name` of the row checkboxes to control (e.g. "record_id"). */
	name: string;
	/** Accessible label; the visual label is the column header itself. */
	label?: string;
}

export default function SelectAllCheckbox({
	name,
	label = 'Select all rows on this page',
}: SelectAllCheckboxProps) {
	const ref = useRef<HTMLInputElement>(null);
	const [checked, setChecked] = useState(true);

	const rows = useCallback((): HTMLInputElement[] => {
		const form = ref.current?.closest('form');
		if (!form) return [];
		return Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
	}, [name]);

	// Mirror the rows: all → checked, none → unchecked, some → indeterminate.
	const sync = useCallback(() => {
		const all = rows();
		if (all.length === 0 || !ref.current) return;
		const on = all.filter((r) => r.checked).length;
		ref.current.indeterminate = on > 0 && on < all.length;
		setChecked(on === all.length);
	}, [rows]);

	useEffect(() => {
		sync();
		const form = ref.current?.closest('form');
		if (!form) return;
		// One listener on the form instead of one per row: rows are server
		// rendered, so this survives a re-render without rebinding.
		form.addEventListener('change', sync);
		return () => form.removeEventListener('change', sync);
	}, [sync]);

	function toggle(next: boolean) {
		for (const row of rows()) row.checked = next;
		if (ref.current) ref.current.indeterminate = false;
		setChecked(next);
	}

	return (
		<Checkbox
			ref={ref}
			checked={checked}
			onChange={(e) => toggle(e.target.checked)}
			aria-label={label}
			title={label}
		/>
	);
}
