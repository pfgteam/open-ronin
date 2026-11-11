// /media/members — Media team members (publicists + media specialists).
// Source: Client Media → Media Contacts (PR contacts) — actually team-side
// might be Personnel Tracker. For v1 we pull Media Contacts which is the
// outlet-side roster; future iteration filters internal Open Ronin media team
// from HR Directory / Personnel.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { BASE_IDS, DataAdapterError } from '@/lib/data';
import { listFullTable } from '@/lib/data/cachedList';
import { resolveLinkNames } from '@/app/(app)/clients/[id]/_lib';
import { listNativeJournalists } from '@/lib/media/nativeMedia';
import { Mail, Phone, Linkedin } from 'lucide-react';

export const metadata = { title: 'Media Members' };


export const dynamic = 'force-dynamic';

interface ContactFields {
	'Full Name'?: string;
	'First Name'?: string;
	'Last Name'?: string;
	Email?: string;
	'Phone Number'?: string;
	'Media Outlets'?: string[]; // multipleRecordLinks: rec ids (resolved to names in the page)
	'Coverage Topics'?: string[];
	'Media Opportunities'?: string[]; // multipleRecordLinks: rec ids
}

async function fetchContacts() {
	try {
		const { rows } = await listFullTable<ContactFields>(
			BASE_IDS.CLIENT_MEDIA,
			'Media Contacts',
		);
		const all = [...rows];
		all.sort((a, b) =>
			(a.fields['Last Name'] ?? a.fields['Full Name'] ?? '').localeCompare(
				b.fields['Last Name'] ?? b.fields['Full Name'] ?? '',
			),
		);
		return { rows: all, error: null as string | null };
	} catch (e) {
		return {
			rows: [],
			error:
				e instanceof DataAdapterError
					? `${e.status} — ${e.message}`
					: e instanceof Error
						? e.message
						: String(e),
		};
	}
}

export default async function MediaMembersPage() {
	const [{ rows, error }, native] = await Promise.all([fetchContacts(), listNativeJournalists()]);

	// Media Outlets links arrive as rec ids — resolve to outlet names.
	const outletNames = await resolveLinkNames(
		BASE_IDS.CLIENT_MEDIA,
		'Media Outlets',
		rows.flatMap((r) => r.fields['Media Outlets'] ?? []),
		'Name',
	);

	// An Airtable contact whose email is already a native journalist shows
	// once, as the native card (which carries beats and evidence).
	const nativeEmails = new Set(native.rows.map((j) => j.email?.toLowerCase()).filter((e): e is string => !!e));
	const airtableOnly = rows.filter((r) => !r.fields.Email || !nativeEmails.has(r.fields.Email.toLowerCase()));

	return (
		<>
			<PageHeader
				title="Media Contacts"
				description={`${native.rows.length + airtableOnly.length} contacts · ${airtableOnly.length} live from Airtable · ${native.rows.length} from the scraper${native.applied ? '' : ' (media_contact_profiles not yet applied)'}`}
			/>

			{(error || native.error) && (
				<Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
					<p className="text-sm text-red-700 dark:text-red-300">
						<strong>Failed to load:</strong> {error ?? native.error}
					</p>
				</Card>
			)}

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{/* Native journalists (0102) first: approved from the Media Scraper. */}
				{native.rows.map((j) => (
					<div key={`native:${j.id}`} className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
						<div className="flex items-start justify-between gap-2">
							<p className="font-medium text-sm text-slate-900 dark:text-slate-100">{j.display_name}</p>
							<Badge color="primary">From scraper</Badge>
						</div>
						{(j.title || j.outlet_name) && (
							<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{[j.title, j.outlet_name].filter(Boolean).join(' · ')}</p>
						)}
						{j.beats.length > 0 && (
							<div className="flex flex-wrap gap-1 mt-2">
								{j.beats.slice(0, 4).map((b) => (
									<Badge key={b}>{b}</Badge>
								))}
							</div>
						)}
						<div className="mt-3 space-y-1 text-xs">
							{j.email && (
								<a href={`mailto:${j.email}`} className="flex items-center gap-1.5 text-primary-600 hover:underline truncate">
									<Mail className="w-3 h-3 shrink-0" />
									{j.email}
									{j.email_status && j.email_status !== 'verified' && <span className="text-slate-400">({j.email_status.replace('_', ' ')})</span>}
								</a>
							)}
							{j.phone && (
								<a href={`tel:${j.phone}`} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
									<Phone className="w-3 h-3 shrink-0" />
									{j.phone}
								</a>
							)}
							{j.linkedin_url && (
								<a href={j.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-primary-600 truncate">
									<Linkedin className="w-3 h-3 shrink-0" />
									LinkedIn
								</a>
							)}
						</div>
						{j.recent_articles.length > 0 && (
							<ul className="mt-2 space-y-0.5 text-2xs text-slate-600 dark:text-slate-400">
								{j.recent_articles.slice(0, 2).map((a, i) => (
									<li key={`${j.id}-${i}`} className="truncate">
										{a.url ? (
											<a href={a.url} target="_blank" rel="noreferrer" className="hover:text-primary-600" title={a.title ?? a.url}>
												{a.title ?? a.url}
											</a>
										) : (
											a.title
										)}
									</li>
								))}
							</ul>
						)}
					</div>
				))}

				{airtableOnly.slice(0, 150).map((row) => {
					const f = row.fields;
					const name =
						(f['Full Name'] ??
							[f['First Name'], f['Last Name']].filter(Boolean).join(' ')) ||
						'Unnamed contact';
					return (
						<div
							key={row.id}
							className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
						>
							<div className="flex items-start justify-between gap-2">
								<p className="font-medium text-sm text-slate-900 dark:text-slate-100">{name}</p>
								<Badge>Airtable</Badge>
							</div>
							{f['Media Outlets'] && f['Media Outlets'].length > 0 && (
								<p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
									{f['Media Outlets']
										.slice(0, 2)
										.map((oid) => outletNames.get(oid))
										.filter(Boolean)
										.join(', ')}
									{f['Media Outlets'].length > 2 &&
										` +${f['Media Outlets'].length - 2}`}
								</p>
							)}
							<div className="mt-3 space-y-1 text-xs">
								{f.Email && (
									<a
										href={`mailto:${f.Email}`}
										className="flex items-center gap-1.5 text-primary-600 hover:underline truncate"
									>
										<Mail className="w-3 h-3 shrink-0" />
										{f.Email}
									</a>
								)}
								{f['Phone Number'] && (
									<a
										href={`tel:${f['Phone Number']}`}
										className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400"
									>
										<Phone className="w-3 h-3 shrink-0" />
										{f['Phone Number']}
									</a>
								)}
							</div>
							{f['Media Opportunities'] && f['Media Opportunities'].length > 0 && (
								<p className="text-2xs uppercase tracking-wide text-slate-600 dark:text-slate-400 mt-2">
									{f['Media Opportunities'].length} opps
								</p>
							)}
						</div>
					);
				})}
			</div>
			{airtableOnly.length > 150 && (
				<p className="text-xs text-slate-400 mt-4 text-center">
					Showing first 150 of {airtableOnly.length} Airtable contacts. Search / filter coming.
				</p>
			)}
		</>
	);
}
