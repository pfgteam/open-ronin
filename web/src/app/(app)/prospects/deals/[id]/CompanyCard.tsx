// Company (spec 2026-10-20 §4.1): the short version of the brand intel for
// prep. The full intel and the website audit live on the Calls tab.

import Link from 'next/link';
import Card from '@/components/ui/Card';
import ScanAiButton from '../../ScanAiButton';
import type { BrandRow } from '@/lib/revenue/shared';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-3 text-xs">
			<span className="w-20 shrink-0 text-slate-500">{label}</span>
			<span className="min-w-0 text-slate-700 dark:text-slate-300">{children}</span>
		</div>
	);
}

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

export default function CompanyCard({ dealId, brand }: { dealId: string; brand: BrandRow | null }) {
	const probe = (brand?.enrichment?.website_probe ?? {}) as Record<string, unknown>;
	const intel = (brand?.intel ?? {}) as Record<string, unknown>;
	// Intel socials can be { handle, followers } objects; flatten them to text.
	const socials = Object.entries({ ...(brand?.socials ?? {}), ...((intel.socials ?? {}) as Record<string, unknown>) })
		.map(([k, v]) => [k, typeof v === 'object' && v ? [(v as { handle?: string }).handle, (v as { followers?: number }).followers ? `${(v as { followers: number }).followers.toLocaleString()} followers` : null].filter(Boolean).join(' · ') : typeof v === 'string' ? v : ''] as [string, string])
		.filter(([, v]) => v);
	const site = brand?.website ?? brand?.domain ?? null;
	const score = text(probe.score);
	const revenue = text(intel.revenue_estimate);
	return (
		<Card className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Company</h2>
				{brand && (
					<span className="flex items-center gap-3">
						<ScanAiButton target="brand" id={brand.id} variant="link" />
						<Link href={`/prospects/deals/${dealId}?tab=calls`} className="text-2xs text-primary-700 hover:underline dark:text-primary-300">More intel →</Link>
					</span>
				)}
			</div>
			{!brand ? (
				<p className="text-xs text-slate-500">No brand on this deal.</p>
			) : (
				<>
					<Row label="Brand">{brand.name}</Row>
					{site && (
						<Row label="Website">
							<a href={site.startsWith('http') ? site : `https://${site}`} target="_blank" rel="noreferrer" className="hover:underline">{site.replace(/^https?:\/\//, '')}</a>
							{score && <span className="text-slate-500"> · site {score}/3</span>}
						</Row>
					)}
					{brand.industry && <Row label="Industry">{brand.industry}</Row>}
					{revenue && <Row label="Revenue">{revenue}</Row>}
					{socials.length > 0 && (
						<Row label="Socials">
							{socials.map(([k, v], i) => (
								<span key={k}>
									{i > 0 && ' · '}
									{/* Handles ("@acme") are not URLs: show them as text. */}
									{v.startsWith('http') ? <a href={v} target="_blank" rel="noreferrer" className="hover:underline">{k}</a> : `${k} ${v}`}
								</span>
							))}
						</Row>
					)}
				</>
			)}
		</Card>
	);
}
