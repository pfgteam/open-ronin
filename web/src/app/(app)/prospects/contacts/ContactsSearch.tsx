'use client';

// Debounced search for /prospects/contacts: writes ?q= (page reset) 300 ms after typing stops.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shouldSyncSearchFromUrl } from '@/lib/revenue/searchSync';
import SearchInput from '@/components/ui/SearchInput';
import { contactsHref, type ContactsFilters } from '@/lib/revenue/listParams';

export default function ContactsSearch({ f }: { f: ContactsFilters }) {
	const router = useRouter();
	const [q, setQ] = useState(f.q ?? '');
	const typed = useRef(false);
	// Last value we pushed to the URL: its echo must not overwrite what the user kept typing.
	const pushed = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (shouldSyncSearchFromUrl(f.q, pushed.current)) setQ(f.q ?? '');
	}, [f.q]);
	useEffect(() => {
		if (!typed.current) return;
		const next = q.trim() || null;
		if (next === f.q) return;
		const t = setTimeout(() => {
			pushed.current = next;
			router.replace(contactsHref(f, { q: next }), { scroll: false });
		}, 300);
		return () => clearTimeout(t);
	}, [q, f, router]);
	const label = f.tab === 'people' ? 'Search name, email or phone' : 'Search brand or domain';
	return (
		<SearchInput
			aria-label={label}
			placeholder={`${label}…`}
			value={q}
			onChange={(e) => {
				typed.current = true;
				setQ(e.target.value);
			}}
			className="w-64"
		/>
	);
}
