'use client';

// TriCheckbox — a controlled checkbox with an indeterminate state, for a
// list's header ("all / some / none selected"). Unlike SelectAllCheckbox
// (which drives plain form inputs in the DOM), this one is driven by state.

import { useEffect, useRef } from 'react';
import Checkbox from './Checkbox';

export default function TriCheckbox({ state, onToggle, label }: { state: 'none' | 'some' | 'all'; onToggle: () => void; label: string }) {
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = state === 'some';
	}, [state]);
	return <Checkbox ref={ref} checked={state === 'all'} onChange={onToggle} aria-label={label} aria-checked={state === 'some' ? 'mixed' : state === 'all'} />;
}
