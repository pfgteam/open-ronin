// Moved into /prospects/contacts (2026-10-15); the redirect keeps old links and the search.
import { redirect } from 'next/navigation';
import { contactsHref, parseContactsFilters } from '@/lib/revenue/listParams';

export default async function BrandsMoved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
	const sp = await searchParams;
	redirect(contactsHref(parseContactsFilters({ q: sp.q, tab: 'brands' })));
}
