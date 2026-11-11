// Readers for the native media tables (0102): media_outlets and journalist
// contacts (contacts + contact_roles('journalist') + media_contact_profiles).
//
// /media/outlets and /media/members list these ALONGSIDE the Airtable rows
// with a "From scraper" chip until the Airtable Media base is sunset
// (AIRTABLE_SUNSET_PLAN.md). Both readers fail soft: before 0102 is applied
// the tables do not exist, and the pages must keep rendering Airtable.

import { createClient } from '@/lib/supabase/server';

export interface NativeOutlet {
	id: string;
	name: string;
	website: string | null;
	domain: string | null;
	location: string | null;
	media_types: string[];
	categories: string[];
	tier: string | null;
	bio: string | null;
	status: string | null;
	source: string;
	airtable_outlet_id: string | null;
	contact_email: string | null;
	contact_count: number;
}

export interface NativeJournalist {
	id: string;
	display_name: string;
	first_name: string | null;
	last_name: string | null;
	email: string | null;
	phone: string | null;
	title: string | null;
	organization: string | null;
	linkedin_url: string | null;
	outlet_name: string | null;
	outlet_domain: string | null;
	beats: string[];
	email_status: string | null;
	last_seen_at: string | null;
	recent_articles: { title?: string | null; url?: string | null; date?: string | null }[];
	source: string;
}

export async function listNativeOutlets(): Promise<{ rows: NativeOutlet[]; error: string | null; applied: boolean }> {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('media_outlets')
		.select('id, name, website, domain, location, media_types, categories, tier, bio, status, source, airtable_outlet_id, contact_email, media_contact_profiles(contact_id)')
		.order('name');
	if (error) {
		// 42P01: relation does not exist — 0102 not applied yet. Not an error
		// worth a red card; the page simply has no native rows.
		if (error.code === '42P01' || /media_outlets/.test(error.message)) return { rows: [], error: null, applied: false };
		return { rows: [], error: error.message, applied: true };
	}
	const rows = (data ?? []).map((r) => {
		const { media_contact_profiles, ...rest } = r as NativeOutlet & { media_contact_profiles: { contact_id: string }[] | null };
		return {
			...rest,
			media_types: rest.media_types ?? [],
			categories: rest.categories ?? [],
			contact_count: media_contact_profiles?.length ?? 0,
		};
	});
	return { rows, error: null, applied: true };
}

export async function listNativeJournalists(limit = 500): Promise<{ rows: NativeJournalist[]; error: string | null; applied: boolean }> {
	const supabase = await createClient();
	const { data, error } = await supabase
		.from('media_contact_profiles')
		.select(
			'contact_id, beats, email_status, last_seen_at, recent_articles, source, contacts!inner(id, display_name, first_name, last_name, email, phone, title, organization, linkedin_url), media_outlets(name, domain)',
		)
		.order('last_seen_at', { ascending: false, nullsFirst: false })
		.limit(limit);
	if (error) {
		if (error.code === '42P01' || /media_contact_profiles/.test(error.message)) return { rows: [], error: null, applied: false };
		return { rows: [], error: error.message, applied: true };
	}
	type Row = {
		contact_id: string;
		beats: string[] | null;
		email_status: string | null;
		last_seen_at: string | null;
		recent_articles: NativeJournalist['recent_articles'] | null;
		source: string;
		contacts: Omit<NativeJournalist, 'beats' | 'email_status' | 'last_seen_at' | 'recent_articles' | 'source' | 'outlet_name' | 'outlet_domain'> | null;
		media_outlets: { name: string; domain: string | null } | null;
	};
	const rows: NativeJournalist[] = [];
	for (const r of (data ?? []) as unknown as Row[]) {
		if (!r.contacts) continue;
		rows.push({
			...r.contacts,
			outlet_name: r.media_outlets?.name ?? r.contacts.organization ?? null,
			outlet_domain: r.media_outlets?.domain ?? null,
			beats: r.beats ?? [],
			email_status: r.email_status,
			last_seen_at: r.last_seen_at,
			recent_articles: Array.isArray(r.recent_articles) ? r.recent_articles : [],
			source: r.source,
		});
	}
	rows.sort((a, b) => (a.last_name ?? a.display_name).localeCompare(b.last_name ?? b.display_name));
	return { rows, error: null, applied: true };
}
