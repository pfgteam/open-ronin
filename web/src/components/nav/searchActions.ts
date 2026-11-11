'use server';

// Record search behind the global search bar. Runs with the viewer's cookie
// session (lib/supabase/server createClient), so RLS decides what each person
// sees: profiles_read_all_authenticated, clients_v2 read, media_outlets /
// media_contact_profiles / contacts read-to-authenticated (0102),
// media_opportunities read (0116). Nothing here widens access.
//
// Every table reader fails soft the way lib/media/nativeMedia.ts does: a
// table that is not applied yet (0116 media_opportunities is written, not
// applied) returns no rows, not an error, so the box keeps working during a
// migration gap.

import { createClient } from '@/lib/supabase/server';
import { getAccessibleModules } from '@/lib/permissions/modules';
import { loadDepartments, departmentLabelById, departmentOf } from '@/lib/people/departments';
import {
	EMPTY_RECORD_RESULT,
	MIN_RECORD_QUERY,
	RECORD_GROUP_LIMIT,
	sanitizeQuery,
	type RecordHit,
	type RecordSearchResult,
} from './searchShared';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 42P01 / PGRST205: relation missing from the schema (migration not applied). */
function isMissingTable(error: { code?: string; message: string }, table: string): boolean {
	if (error.code === '42P01' || error.code === 'PGRST205') return true;
	return new RegExp(table).test(error.message) && /not exist|schema cache|relation/.test(error.message);
}

async function searchPeople(supabase: Supabase, q: string): Promise<{ hits: RecordHit[]; error: string | null }> {
	const like = `%${q}%`;
	const words = q.split(' ');
	// "alex arm" → first name starts the way "alex" does AND last name
	// contains "arm"; single words match any of the three columns.
	const terms = [`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`];
	if (words.length > 1) {
		terms.push(`and(first_name.ilike.%${words[0]}%,last_name.ilike.%${words.slice(1).join(' ')}%)`);
	}
	const [{ data, error }, departments] = await Promise.all([
		supabase
			.from('profiles')
			.select('id, first_name, last_name, email, title, department_tag_id')
			.eq('is_active', true)
			.or(terms.join(','))
			.order('first_name')
			.limit(RECORD_GROUP_LIMIT),
		loadDepartments(supabase),
	]);
	if (error) return { hits: [], error: error.message };
	const labels = departmentLabelById(departments);
	type Row = { id: string; first_name: string | null; last_name: string | null; email: string; title: string | null; department_tag_id: string | null };
	const hits = ((data ?? []) as Row[]).map((p) => {
		const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
		const dept = departmentOf(p, labels);
		return {
			kind: 'person' as const,
			id: `person:${p.id}`,
			href: `/team/${p.id}`,
			title: name,
			subtitle: [dept, p.title].filter(Boolean).join(' · ') || null,
		};
	});
	return { hits, error: null };
}

async function searchClients(supabase: Supabase, q: string): Promise<{ hits: RecordHit[]; error: string | null }> {
	const { data, error } = await supabase
		.from('clients_v2')
		.select('id, display_name, status')
		.ilike('display_name', `%${q}%`)
		.order('display_name')
		.limit(RECORD_GROUP_LIMIT);
	if (error) return { hits: [], error: error.message };
	type Row = { id: string; display_name: string; status: string | null };
	const hits = ((data ?? []) as Row[]).map((c) => ({
		kind: 'client' as const,
		id: `client:${c.id}`,
		href: `/clients/${c.id}`,
		title: c.display_name,
		subtitle: c.status ? c.status.replace(/_/g, ' ') : null,
	}));
	return { hits, error: null };
}

async function searchOutlets(supabase: Supabase, q: string): Promise<{ hits: RecordHit[]; error: string | null }> {
	const like = `%${q}%`;
	const { data, error } = await supabase
		.from('media_outlets')
		.select('id, name, domain, tier')
		.or(`name.ilike.${like},domain.ilike.${like}`)
		.order('name')
		.limit(RECORD_GROUP_LIMIT);
	if (error) return { hits: [], error: isMissingTable(error, 'media_outlets') ? null : error.message };
	type Row = { id: string; name: string; domain: string | null; tier: string | null };
	const hits = ((data ?? []) as Row[]).map((o) => ({
		kind: 'outlet' as const,
		id: `outlet:${o.id}`,
		// No outlet detail page yet: land on the directory.
		href: '/media/outlets',
		title: o.name,
		subtitle: ['Outlet', o.domain, o.tier].filter(Boolean).join(' · '),
	}));
	return { hits, error: null };
}

async function searchJournalists(supabase: Supabase, q: string): Promise<{ hits: RecordHit[]; error: string | null }> {
	// Filter on the embedded contacts row: !inner makes the embed a join so
	// the ilike on contacts.display_name narrows the parent rows.
	const { data, error } = await supabase
		.from('media_contact_profiles')
		.select('contact_id, contacts!inner(display_name, title, organization), media_outlets(name)')
		.ilike('contacts.display_name', `%${q}%`)
		.limit(RECORD_GROUP_LIMIT);
	if (error) return { hits: [], error: isMissingTable(error, 'media_contact_profiles') ? null : error.message };
	type Row = {
		contact_id: string;
		contacts: { display_name: string; title: string | null; organization: string | null } | null;
		media_outlets: { name: string } | null;
	};
	const hits: RecordHit[] = [];
	for (const r of (data ?? []) as unknown as Row[]) {
		if (!r.contacts) continue;
		hits.push({
			kind: 'journalist',
			id: `journalist:${r.contact_id}`,
			href: '/media/members',
			title: r.contacts.display_name,
			subtitle: ['Journalist', r.contacts.title, r.media_outlets?.name ?? r.contacts.organization].filter(Boolean).join(' · '),
		});
	}
	return { hits, error: null };
}

async function searchOpportunities(supabase: Supabase, q: string): Promise<{ hits: RecordHit[]; error: string | null }> {
	const like = `%${q}%`;
	const { data, error } = await supabase
		.from('media_opportunities')
		.select('id, title, story_title, outlet_name, client_id, date_secured, live_date, date_sent_to_client, clients_v2(display_name)')
		.or(`title.ilike.${like},story_title.ilike.${like},outlet_name.ilike.${like}`)
		.order('date_secured', { ascending: false, nullsFirst: false })
		.limit(RECORD_GROUP_LIMIT);
	if (error) return { hits: [], error: isMissingTable(error, 'media_opportunities') ? null : error.message };
	type Row = {
		id: string;
		title: string | null;
		story_title: string | null;
		outlet_name: string | null;
		client_id: string;
		date_secured: string | null;
		live_date: string | null;
		date_sent_to_client: string | null;
		clients_v2: { display_name: string } | null;
	};
	const hits = ((data ?? []) as unknown as Row[]).map((o) => {
		// The client delivery page is the one surface that lists native opps;
		// land on the month the opp belongs to (same precedence loadNativeOpps
		// filters on).
		const date = o.date_secured ?? o.live_date ?? o.date_sent_to_client;
		const month = date ? date.slice(0, 7) : null;
		return {
			kind: 'opportunity' as const,
			id: `opp:${o.id}`,
			href: month ? `/clients/${o.client_id}/delivery?month=${month}` : `/clients/${o.client_id}/delivery`,
			title: o.title ?? o.story_title ?? o.outlet_name ?? 'Opportunity',
			subtitle: ['Opportunity', o.clients_v2?.display_name, o.outlet_name && o.outlet_name !== o.title ? o.outlet_name : null]
				.filter(Boolean)
				.join(' · '),
		};
	});
	return { hits, error: null };
}

const WORK_KIND_LABEL: Record<string, string> = {
	goal: 'Goal', priority: 'Priority', project: 'Project', task: 'Task', recurring: 'Recurring', process: 'Process',
	assignment: 'Assignment', campaign: 'Campaign', twelve_week_plan: '12 Week Plan', strategy: 'Strategy',
};

/** The Work: boards (by name) then open work items, newest activity first. */
async function searchWork(supabase: Supabase, q: string): Promise<{ hits: RecordHit[]; error: string | null }> {
	const like = `%${q}%`;
	const [boards, items] = await Promise.all([
		supabase.from('boards').select('slug, name').is('archived_at', null).ilike('name', like).order('name').limit(2),
		supabase.from('projects').select('id, name, kind, status').eq('archived', false).ilike('name', like)
			.order('updated_at', { ascending: false }).order('id').limit(RECORD_GROUP_LIMIT),
	]);
	if (items.error) return { hits: [], error: items.error.message };
	const hits: RecordHit[] = [];
	// boards is 0141: before it's applied the read errors and there are simply
	// no board hits — never an error for the whole group.
	if (!boards.error) {
		for (const b of (boards.data ?? []) as { slug: string; name: string }[]) {
			hits.push({ kind: 'board', id: `board:${b.slug}`, href: `/the-work/b/${b.slug}`, title: b.name, subtitle: 'Board' });
		}
	}
	for (const w of (items.data ?? []) as { id: string; name: string; kind: string; status: string }[]) {
		hits.push({
			kind: 'work_item',
			id: `work:${w.id}`,
			href: `/the-work/${w.id}`,
			title: w.name,
			subtitle: [WORK_KIND_LABEL[w.kind] ?? w.kind, w.status.replace(/_/g, ' ')].join(' · '),
		});
	}
	return { hits: hits.slice(0, RECORD_GROUP_LIMIT), error: null };
}

/**
 * Search people, clients and media for the typed text. The caller debounces;
 * this runs the four groups in parallel and returns at most RECORD_GROUP_LIMIT
 * per group (media shares one cap across outlets, journalists and opps).
 */
export async function searchRecords(rawQuery: string): Promise<RecordSearchResult> {
	const q = sanitizeQuery(String(rawQuery ?? ''));
	if (q.length < MIN_RECORD_QUERY) return EMPTY_RECORD_RESULT;

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) return { ...EMPTY_RECORD_RESULT, error: 'Not signed in' };

	// Same honest-nav rule as the Pages index: a group only searches when the
	// viewer can open the module its hits link into (people → Team, clients
	// and opportunities → Clients, outlets/journalists → Media). Otherwise the
	// dropdown would list names whose click lands on a ModuleGate wall.
	const modules = await getAccessibleModules();
	const none = Promise.resolve({ hits: [] as RecordHit[], error: null });
	const [work, people, clients, outlets, journalists, opps] = await Promise.all([
		modules.has('the_work') ? searchWork(supabase, q) : none,
		modules.has('team') ? searchPeople(supabase, q) : none,
		modules.has('clients') ? searchClients(supabase, q) : none,
		modules.has('media') ? searchOutlets(supabase, q) : none,
		modules.has('media') ? searchJournalists(supabase, q) : none,
		modules.has('clients') ? searchOpportunities(supabase, q) : none,
	]);

	// Interleave the media sources so one busy table cannot crowd out the
	// others, then cap the group.
	const media: RecordHit[] = [];
	const sources = [outlets.hits, journalists.hits, opps.hits];
	for (let i = 0; media.length < RECORD_GROUP_LIMIT && sources.some((s) => i < s.length); i++) {
		for (const s of sources) {
			if (i < s.length && media.length < RECORD_GROUP_LIMIT) media.push(s[i]);
		}
	}

	const errors = [work.error, people.error, clients.error, outlets.error, journalists.error, opps.error].filter((e): e is string => !!e);
	// Raw PostgREST text names tables and columns: log it, show a plain line.
	if (errors.length) console.error('[global search]', errors);
	return {
		work: work.hits,
		people: people.hits,
		clients: clients.hits,
		media,
		error: errors.length ? 'Some results could not load.' : null,
	};
}
