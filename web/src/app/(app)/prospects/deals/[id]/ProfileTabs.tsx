// Intel + Documents for the deal page (0125, spec §7; since spec 2026-10-20
// Intel is a column on the Calls tab and Documents a card on Closing). Intel renders
// whatever enrichment / intel facts exist on the brand and person (website
// audit, socials, competitors, press, revenue estimate, giving-back angle);
// Documents lists proposals / presentations / contracts and takes a link.

import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { formatRelative } from '@/lib/format';
import type { DocumentRow } from '@/lib/revenue/server';
import type { BrandRow, PersonRow } from '@/lib/revenue/shared';
import DocumentForm from './DocumentForm';

type Facts = Record<string, unknown>;

function Row({ label, value }: { label: string; value: unknown }) {
	if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
	const text = Array.isArray(value) ? value.map((v) => (typeof v === 'object' && v ? JSON.stringify(v) : String(v))).join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
	return (
		<div className="flex gap-3 text-xs">
			<span className="w-32 shrink-0 text-slate-500">{label}</span>
			<span className="text-slate-700 dark:text-slate-300 min-w-0 break-words">{text}</span>
		</div>
	);
}

export function IntelTab({ brand, person }: { brand: (BrandRow & { intel?: Facts; enrichment?: Facts; enrichment_status?: string }) | null; person: (PersonRow & { intel?: Facts; enrichment?: Facts }) | null }) {
	const probe = (brand?.enrichment?.website_probe ?? {}) as Facts;
	const checks = (probe.checks ?? {}) as Record<string, boolean>;
	const intel = (brand?.intel ?? {}) as Facts;
	const socials = { ...((brand?.socials ?? {}) as Record<string, string>), ...((intel.socials ?? {}) as Record<string, unknown>) };
	const empty = !brand && !person;
	return (
		<div className="space-y-4">
			<Card className="space-y-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Company intel</h2>
				{!brand && <p className="text-xs text-slate-500">No brand on this deal.</p>}
				{brand && (
					<>
						<Row label="Brand" value={brand.name} />
						<Row label="Website" value={brand.website ?? brand.domain} />
						<Row label="Industry" value={brand.industry} />
						<Row label="Vertical" value={brand.vertical} />
						<Row label="Description" value={brand.description} />
						<Row label="Revenue estimate" value={intel.revenue_estimate} />
						<Row label="Employees" value={intel.employees} />
						<Row label="Locations" value={intel.locations} />
						<Row label="Competitors" value={intel.competitors} />
						<Row label="Press coverage" value={intel.press} />
						<Row label="News" value={intel.news} />
						<Row label="Funding" value={intel.funding} />
						<Row label="Causes / giving back" value={intel.causes ?? intel.giving_back} />
						<div className="pt-2 text-2xs text-slate-500">
							Enrichment: <Badge>{brand.enrichment_status ?? 'pending'}</Badge>
							{probe.checked_at ? ` · site probed ${formatRelative(String(probe.checked_at))}` : ''}
						</div>
					</>
				)}
			</Card>
			<Card className="space-y-2">
				<details>
				<summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-slate-100">Website audit details{probe.score != null ? ` · ${String(probe.score)}/3` : ''}</summary>
				<div className="mt-2 space-y-2">
				{probe.score == null ? (
					<p className="text-xs text-slate-500">Not probed yet — press Enrich now in Summary → Details.</p>
				) : (
					<>
						<div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
							{String(probe.score)}
							<span className="text-sm text-slate-500"> / 3</span>
							<span className="text-xs text-slate-500 ml-2">{probe.loads === false ? 'does not load' : probe.score === 3 ? 'nice website' : probe.score === 2 ? 'established' : 'basic'}</span>
						</div>
						<Row label="Title" value={probe.title} />
						<Row label="Description" value={probe.description} />
						<ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
							{Object.entries(checks).map(([k, v]) => (
								<li key={k} className={v ? 'text-green-700 dark:text-green-400' : 'text-slate-400'}>
									{v ? '✓' : '○'} {k.replace(/_/g, ' ')}
								</li>
							))}
						</ul>
					</>
				)}
				</div>
				</details>
			</Card>
			<Card className="space-y-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Socials</h2>
				{Object.keys(socials).length === 0 && <p className="text-xs text-slate-500">No handles found yet.</p>}
				{Object.entries(socials).map(([k, v]) => (
					<Row key={k} label={k} value={typeof v === 'object' && v ? `${(v as { handle?: string }).handle ?? ''}${(v as { followers?: number }).followers ? ` · ${(v as { followers: number }).followers.toLocaleString()} followers` : ''}` : v} />
				))}
			</Card>
			<Card className="space-y-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Person intel</h2>
				{!person && <p className="text-xs text-slate-500">No primary person.</p>}
				{person && (
					<>
						<Row label="Name" value={person.display_name} />
						<Row label="Title" value={person.title} />
						<Row label="Location" value={person.location} />
						<Row label="LinkedIn" value={person.linkedin_url} />
						{Object.entries((person.intel ?? {}) as Facts).map(([k, v]) => (
							<Row key={k} label={k.replace(/_/g, ' ')} value={v} />
						))}
					</>
				)}
			</Card>
			{empty && null}
		</div>
	);
}

export function DocumentsTab({ dealId, documents, staff }: { dealId: string; documents: DocumentRow[]; staff: Record<string, string> }) {
	return (
		<div className="space-y-4">
			<Card padding="none">
				<div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Documents</h2>
					<span className="text-2xs text-slate-500">proposals · presentations · contracts (P6 writes contracts here)</span>
				</div>
				{documents.length === 0 ? (
					<p className="px-4 py-6 text-sm text-slate-500">Nothing attached yet.</p>
				) : (
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{documents.map((d) => (
							<li key={d.id} className="px-4 py-2 flex items-center gap-3 text-sm">
								<Badge>{d.kind}</Badge>
								{d.url ? (
									<a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-primary-700 dark:text-primary-300 hover:underline">
										{d.title}
									</a>
								) : (
									<span className="font-medium text-slate-900 dark:text-slate-100">{d.title}</span>
								)}
								<Badge color={d.status === 'signed' ? 'success' : d.status === 'sent' || d.status === 'viewed' ? 'primary' : 'default'}>{d.status}</Badge>
								<span className="ml-auto text-2xs text-slate-500">
									{d.created_by && staff[d.created_by] ? `${staff[d.created_by]} · ` : ''}
									{formatRelative(d.created_at)}
								</span>
							</li>
						))}
					</ul>
				)}
			</Card>
			<DocumentForm dealId={dealId} />
		</div>
	);
}
