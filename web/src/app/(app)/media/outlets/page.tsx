// /media/outlets — Media Outlets directory.
//
// Two sources side by side until the Airtable Media base is sunset
// (AIRTABLE_SUNSET_PLAN.md): the Airtable Media Outlets table (live read) and
// the native media_outlets table (0102), fed by the Media Scraper's approvals
// and the one time Airtable backfill. A "From scraper" / "Airtable" chip says
// where each row came from; an Airtable row that has already been backfilled
// (native row carries its airtable_outlet_id) shows once, as the native row.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { BASE_IDS, DataAdapterError } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { listNativeOutlets, type NativeOutlet } from '@/lib/media/nativeMedia';

export const metadata = { title: 'Outlets' };

export const dynamic = 'force-dynamic';

interface OutletFields {
	Name?: string;
	Bio?: string;
	Status?: string;
	'Types Of Media'?: string[];
	'Media Contacts'?: { id: string; name?: string }[];
	'Media Opportunities'?: { id: string; name?: string }[];
}

interface OutletView {
	key: string;
	name: string;
	bio: string | null;
	domain: string | null;
	website: string | null;
	types: string[];
	status: string | null;
	contacts: number;
	opps: number | null;
	source: 'airtable' | 'scraper' | 'import' | 'manual';
}

async function fetchOutlets() {
	try {
		const { rows } = await listFullTable<OutletFields>(BASE_IDS.CLIENT_MEDIA, 'Media Outlets');
		return { rows: [...rows], error: null as string | null };
	} catch (e) {
		return {
			rows: [],
			error: e instanceof DataAdapterError ? `${e.status} — ${e.message}` : e instanceof Error ? e.message : String(e),
		};
	}
}

function fromNative(o: NativeOutlet): OutletView {
	return {
		key: `native:${o.id}`,
		name: o.name,
		bio: o.bio,
		domain: o.domain,
		website: o.website,
		types: o.media_types.length ? o.media_types : o.categories.slice(0, 3),
		status: o.status,
		contacts: o.contact_count,
		opps: null,
		source: o.source === 'airtable' ? 'airtable' : o.source === 'import' ? 'import' : o.source === 'manual' ? 'manual' : 'scraper',
	};
}

const SOURCE_LABEL: Record<OutletView['source'], string> = {
	airtable: 'Airtable',
	scraper: 'From scraper',
	import: 'Imported',
	manual: 'Manual',
};

export default async function MediaOutletsPage() {
	const [{ rows: airtableRows, error }, native] = await Promise.all([fetchOutlets(), listNativeOutlets()]);

	// Native rows first (they are the system of record going forward), then
	// any Airtable row not yet backfilled.
	const backfilled = new Set(native.rows.map((o) => o.airtable_outlet_id).filter((id): id is string => !!id));
	const merged: OutletView[] = native.rows.map(fromNative);
	for (const row of airtableRows) {
		if (backfilled.has(row.id)) continue;
		const f = row.fields;
		merged.push({
			key: `airtable:${row.id}`,
			name: f.Name ?? '—',
			bio: f.Bio ?? null,
			domain: null,
			website: null,
			types: f['Types Of Media'] ?? [],
			status: f.Status ?? null,
			contacts: f['Media Contacts']?.length ?? 0,
			opps: f['Media Opportunities']?.length ?? 0,
			source: 'airtable',
		});
	}
	merged.sort((a, b) => a.name.localeCompare(b.name));
	const scraperCount = merged.filter((o) => o.source !== 'airtable').length;

	return (
		<>
			<PageHeader
				title="Outlets"
				description={`${merged.length} outlets · ${airtableRows.length - backfilled.size} live from Airtable · ${scraperCount} native${native.applied ? '' : ' (media_outlets not yet applied)'}`}
				actions={
					<Link href="/media/media-scraper?mode=outlets" className="text-xs text-primary-600 hover:underline">
						Find more with the Media Scraper →
					</Link>
				}
			/>

			{(error || native.error) && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error ?? native.error}
					</p>
				</Card>
			)}

			<Card padding="none" className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Outlet</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Types</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Status</th>
								<th className="text-left font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Source</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Contacts</th>
								<th className="text-right font-medium text-slate-600 dark:text-slate-400 px-4 py-2.5">Opps</th>
							</tr>
						</thead>
						<tbody>
							{merged.length === 0 ? (
								<tr>
									<td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
										No outlets on file.
									</td>
								</tr>
							) : (
								merged.map((o) => (
									<tr key={o.key} className="border-b border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors">
										<td className="px-4 py-3">
											<div className="font-medium text-slate-900 dark:text-slate-100">{o.name}</div>
											{o.domain && (
												<a href={o.website ?? `https://${o.domain}`} target="_blank" rel="noreferrer" className="text-xs text-slate-500 dark:text-slate-400 hover:text-primary-600">
													{o.domain}
												</a>
											)}
											{o.bio && <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-md">{o.bio}</div>}
										</td>
										<td className="px-4 py-3">
											<div className="flex flex-wrap gap-1">
												{o.types.slice(0, 3).map((t) => (
													<Badge key={t}>{t}</Badge>
												))}
												{o.types.length > 3 && <span className="text-xs text-slate-400">+{o.types.length - 3}</span>}
											</div>
										</td>
										<td className="px-4 py-3">{o.status && <Badge color={o.status.toLowerCase() === 'dnc' ? 'danger' : 'default'}>{o.status}</Badge>}</td>
										<td className="px-4 py-3">
											<Badge color={o.source === 'airtable' ? 'default' : 'primary'}>{SOURCE_LABEL[o.source]}</Badge>
										</td>
										<td className="px-4 py-3 text-right font-mono">{o.contacts}</td>
										<td className="px-4 py-3 text-right font-mono">{o.opps ?? '—'}</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</Card>
		</>
	);
}
