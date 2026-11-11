// /clients/[id]/ghl - Per-client GHL surface.
//
// Resolves the client's Brand(s) -> GHL location via ghl_brand_links, then
// shows synced contacts + opportunities for that location. If no link is
// set, prompts to attach a GHL location.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Link from 'next/link';
import { requireClient } from '../_lib';
import { createClient } from '@/lib/supabase/server';
import { formatNumber, formatRelative, formatCurrency } from '@/lib/format';
import { Bot, Users, TrendingUp, MapPin, Link2, RefreshCw, ExternalLink } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ id: string }>;
}

interface BrandRow {
	id: string;
	name: string | null;
}

interface ContactRow {
	ghl_contact_id: string;
	full_name: string | null;
	email: string | null;
	phone: string | null;
	tags: string[];
	type: string | null;
	last_activity: string | null;
}

interface OppRow {
	ghl_opportunity_id: string;
	name: string | null;
	status: string | null;
	monetary_value: number | null;
	ghl_pipeline_id: string | null;
	ghl_pipeline_stage_id: string | null;
	created_at: string | null;
}

interface LinkRow {
	brand_id: string;
	ghl_location_id: string;
	ghl_contact_id: string | null;
}

export default async function ClientGhlTab({ params }: PageProps) {
	const { id } = await params;
	const ctx = await requireClient(id, '/ghl');

	const supabase = await createClient();

	// Brands associated with this client — joined by airtable_contract_id
	// across ALL of the client's contracts (the real key, migration 0002).
	// The old ilike(name%) join matched every brand for unnamed contracts and
	// leaked other clients' GHL data.
	const { data: brands } = ctx.airtableIds.length
		? await supabase.from('brands').select('id, name').in('airtable_contract_id', ctx.airtableIds).limit(20)
		: { data: [] as BrandRow[] };
	const brandRows = (brands ?? []) as BrandRow[];

	// Linked GHL locations
	const brandIds = brandRows.map((b) => b.id);
	let links: LinkRow[] = [];
	if (brandIds.length > 0) {
		const { data } = await supabase.from('ghl_brand_links').select('brand_id, ghl_location_id, ghl_contact_id').in('brand_id', brandIds);
		links = (data ?? []) as LinkRow[];
	}

	if (links.length === 0) {
		return (
			<Card>
				<div className="text-center py-10">
					<Bot className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">No GHL link yet</h3>
					<p className="text-xs text-slate-500 max-w-md mx-auto">
						This client&apos;s brand{brandRows.length === 1 ? ' is ' : 's are '}
						not yet linked to a GHL location. Sync and attach locations in{' '}
						<Link className="text-primary-600 hover:underline" href="/admin/integrations/ghl">Admin → Connections → GHL</Link>{' '}
						(there is no separate brand page).
					</p>
				</div>
			</Card>
		);
	}

	const locationIds = Array.from(new Set(links.map((l) => l.ghl_location_id)));

	const [{ data: locsData }, { data: contactsData }, { data: oppsData }] = await Promise.all([
		supabase.from('ghl_locations').select('ghl_location_id, name, label, business_name, city, state, country').in('ghl_location_id', locationIds),
		supabase
			.from('ghl_contacts')
			.select('ghl_contact_id, ghl_location_id, full_name, email, phone, tags, type, last_activity')
			.in('ghl_location_id', locationIds)
			.order('last_activity', { ascending: false, nullsFirst: false })
			.limit(50),
		supabase
			.from('ghl_opportunities')
			.select('ghl_opportunity_id, ghl_location_id, name, status, monetary_value, ghl_pipeline_id, ghl_pipeline_stage_id, created_at')
			.in('ghl_location_id', locationIds)
			.order('updated_at', { ascending: false, nullsFirst: false })
			.limit(30),
	]);

	const locations = (locsData ?? []) as { ghl_location_id: string; name: string; label: string | null; business_name: string | null; city: string | null; state: string | null; country: string | null }[];
	const contacts = ((contactsData ?? []) as (ContactRow & { ghl_location_id: string })[]);
	const opps = ((oppsData ?? []) as (OppRow & { ghl_location_id: string })[]);

	const openOpps = opps.filter((o) => o.status === 'open');
	const wonValue = opps
		.filter((o) => o.status === 'won')
		.reduce((acc, o) => acc + (o.monetary_value ?? 0), 0);

	return (
		<div className="space-y-4">
			{/* Linked locations */}
			<Card padding="none">
				<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
						<Link2 className="w-3.5 h-3.5 text-slate-400" /> Linked GHL location{locations.length === 1 ? '' : 's'} ({locations.length})
					</h3>
					<Link href="/admin/integrations/ghl" className="text-2xs text-primary-600 hover:underline inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />Manage</Link>
				</div>
				<ul className="divide-y divide-slate-100 dark:divide-slate-800">
					{locations.map((loc) => (
						<li key={loc.ghl_location_id} className="px-3 py-2 flex items-center justify-between gap-2">
							<div className="min-w-0">
								<div className="text-sm text-slate-900 dark:text-slate-100">{loc.name}</div>
								<div className="text-2xs text-slate-600 dark:text-slate-400">
									{[loc.business_name, loc.city, loc.state, loc.country].filter(Boolean).join(' · ')}
								</div>
							</div>
							{loc.label && <Badge color="primary">{loc.label}</Badge>}
						</li>
					))}
				</ul>
			</Card>

			{/* KPIs */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<Stat icon={<Users className="w-3.5 h-3.5" />} label="Contacts" value={formatNumber(contacts.length)} />
				<Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Open opps" value={formatNumber(openOpps.length)} />
				<Stat icon={<MapPin className="w-3.5 h-3.5" />} label="Locations" value={formatNumber(locations.length)} />
				<Stat icon={<Bot className="w-3.5 h-3.5" />} label="Won ($)" value={formatCurrency(wonValue)} />
			</div>

			{/* Open opportunities */}
			{openOpps.length > 0 && (
				<Card padding="none">
					<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Open opportunities ({openOpps.length})</h3>
					</div>
					<ul className="divide-y divide-slate-100 dark:divide-slate-800">
						{openOpps.slice(0, 10).map((o) => (
							<li key={o.ghl_opportunity_id} className="px-3 py-2 flex items-center justify-between gap-2">
								<div className="min-w-0">
									<div className="text-sm text-slate-900 dark:text-slate-100 truncate">{o.name ?? '(unnamed)'}</div>
									<div className="text-2xs text-slate-600 dark:text-slate-400 truncate">{o.ghl_pipeline_id ?? ''}</div>
								</div>
								<div className="text-sm text-slate-600 dark:text-slate-300 font-mono whitespace-nowrap">
									{o.monetary_value != null ? formatCurrency(o.monetary_value) : '—'}
								</div>
							</li>
						))}
					</ul>
				</Card>
			)}

			{/* Recent contacts */}
			<Card padding="none">
				<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
					<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent contacts ({contacts.length})</h3>
				</div>
				{contacts.length === 0 ? (
					<p className="text-sm text-slate-500 text-center py-6">No contacts synced yet. Trigger a sync in /admin/integrations/ghl.</p>
				) : (
					<ul className="divide-y divide-slate-100 dark:divide-slate-800">
						{contacts.slice(0, 30).map((c) => (
							<li key={c.ghl_contact_id} className="px-3 py-2 flex items-center justify-between gap-2">
								<div className="min-w-0">
									<div className="text-sm text-slate-900 dark:text-slate-100 truncate">{c.full_name ?? c.email ?? '(unnamed)'}</div>
									<div className="text-2xs text-slate-600 dark:text-slate-400 truncate">
										{c.email ?? c.phone ?? ''}
										{c.tags && c.tags.length > 0 ? ' · ' + c.tags.slice(0, 3).join(', ') : ''}
									</div>
								</div>
								<div className="text-2xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
									{c.last_activity ? formatRelative(c.last_activity) : ''}
								</div>
							</li>
						))}
					</ul>
				)}
			</Card>

			<p className="text-2xs text-slate-600 dark:text-slate-400">
				Data reflects last sync. Refresh anytime from{' '}
				<Link href="/admin/integrations/ghl" className="text-primary-600 hover:underline inline-flex items-center gap-0.5">/admin/integrations/ghl <ExternalLink className="w-2.5 h-2.5" /></Link>.
			</p>
		</div>
	);
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
	return (
		<Card>
			<div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">{icon}{label}</div>
			<div className="text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</div>
		</Card>
	);
}
