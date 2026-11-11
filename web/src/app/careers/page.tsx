// /careers — the public careers page (0129, round 3: example.com/
// careers is served from here by rewrite / iframe / link). Open roles with
// Google Jobs JSON-LD per role, grouped by brand; job-alert opt-in.

import type { Metadata } from 'next';
import Link from 'next/link';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { loadBrandProfiles, loadCareersSettings, loadOpenPositions } from '@/lib/hiring/server';
import { jobPostingJsonLd } from '@/lib/hiring/careers';
import { EMPLOYMENT_TYPE_LABELS, HIRE_BRAND_LABELS, LOCATION_TYPE_LABELS } from '@/lib/hiring/shared';
import CareersShell from './CareersShell';
import AlertSignup from './AlertSignup';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
	title: 'Careers · Open Ronin',
	description: 'Open roles at Open Ronin, Premium and Beacon. Remote-first, purpose-driven PR and software.',
};

export default async function CareersPage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
	const sp = await searchParams;
	const svc = createServiceRoleClient();
	const [positions, brands, settings] = await Promise.all([loadOpenPositions(svc), loadBrandProfiles(svc), loadCareersSettings(svc)]);
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const byBrand = new Map<string, typeof positions>();
	for (const p of positions) byBrand.set(p.brand, [...(byBrand.get(p.brand) ?? []), p]);
	const jsonLd = positions.map((p) => jobPostingJsonLd(p, brands.find((b) => b.brand === p.brand) ?? null, appUrl));

	return (
		<CareersShell embed={sp.embed === '1'} headline={settings.headline}>
			{jsonLd.map((j, i) => (
				<script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j) }} />
			))}
			{settings.intro_md && <p className="text-base text-slate-700 max-w-2xl mb-8">{settings.intro_md}</p>}
			{positions.length === 0 ? (
				<div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-3">
					<h2 className="text-lg font-semibold">No open roles right now</h2>
					<p className="text-sm text-slate-600">We hire a few times a year. Leave your email and we&apos;ll tell you when something opens.</p>
					<div className="max-w-sm mx-auto">
						<AlertSignup source="careers" />
					</div>
				</div>
			) : (
				<div className="space-y-8">
					{[...byBrand.entries()].map(([brand, list]) => {
						const bp = brands.find((b) => b.brand === brand);
						return (
							<section key={brand}>
								<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{bp?.label ?? HIRE_BRAND_LABELS[brand as keyof typeof HIRE_BRAND_LABELS]}</h2>
								<ul className="space-y-2">
									{list.map((p) => (
										<li key={p.id}>
											<Link href={`/careers/${p.slug}`} className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-primary-400 transition-colors">
												<div className="flex items-start justify-between gap-3">
													<div>
														<h3 className="text-base font-semibold text-slate-900">{p.title}</h3>
														<div className="text-xs text-slate-500 mt-0.5">
															{[p.department_label, EMPLOYMENT_TYPE_LABELS[p.employment_type], LOCATION_TYPE_LABELS[p.location_type] + (p.location_text ? ` · ${p.location_text}` : ''), p.timezone_note].filter(Boolean).join(' · ')}
														</div>
														{p.compensation_statement && <p className="text-sm text-slate-700 mt-2">{p.compensation_statement}</p>}
													</div>
													<span className="text-sm text-primary-700 font-medium shrink-0">View role →</span>
												</div>
											</Link>
										</li>
									))}
								</ul>
							</section>
						);
					})}
					<section className="rounded-lg border border-slate-200 bg-white p-5">
						<h2 className="text-sm font-semibold text-slate-900 mb-1">Nothing that fits today?</h2>
						<p className="text-sm text-slate-600 mb-3">Get an email when a new role opens. No newsletters, just openings.</p>
						<AlertSignup source="careers" compact />
					</section>
				</div>
			)}
		</CareersShell>
	);
}
