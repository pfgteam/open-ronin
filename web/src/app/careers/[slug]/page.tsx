// /careers/[slug] — one public role (0129): the posting in the round-3
// order, JSON-LD for Google Jobs, the apply CTA (H3 wires the application;
// until then the button opens the job-alert / interest form), and the
// "this position is closed, here are similar openings" page for closed roles.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { loadBrandProfiles, loadOpenPosition, loadOpenPositions } from '@/lib/hiring/server';
import { jobPostingJsonLd } from '@/lib/hiring/careers';
import { EMPLOYMENT_TYPE_LABELS, LOCATION_TYPE_LABELS, renderPosting } from '@/lib/hiring/shared';
import CareersShell from '../CareersShell';
import AlertSignup from '../AlertSignup';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params;
	const svc = createServiceRoleClient();
	const p = await loadOpenPosition(svc, slug);
	return { title: p ? `${p.title} · Careers · Open Ronin` : 'Role · Careers · Open Ronin', description: p?.compensation_statement ?? p?.role_md.slice(0, 160) };
}

export default async function RolePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string; src?: string }> }) {
	const { slug } = await params;
	const sp = await searchParams;
	if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) notFound();
	const svc = createServiceRoleClient();
	const [position, brands] = await Promise.all([loadOpenPosition(svc, slug), loadBrandProfiles(svc)]);
	const embed = sp.embed === '1';
	if (!position) {
		// Closed / paused / filled / unknown: the round-3 closed-role page.
		const { data: closed } = await svc.from('hire_positions').select('id, title, department_label, status').eq('slug', slug).maybeSingle();
		if (!closed) notFound();
		const open = await loadOpenPositions(svc);
		const row = closed as { id: string; title: string; department_label: string | null; status: string };
		const similar = open.filter((p) => p.department_label && p.department_label === row.department_label).concat(open.filter((p) => !p.department_label || p.department_label !== row.department_label)).slice(0, 5);
		return (
			<CareersShell embed={embed} headline={row.title}>
				<div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
					<p className="text-sm text-slate-700">This position is {row.status === 'filled' ? 'filled' : 'closed'}. Thank you for your interest in Open Ronin.</p>
					{similar.length > 0 && (
						<div>
							<h2 className="text-sm font-semibold mb-2">Similar openings</h2>
							<ul className="space-y-1.5">
								{similar.map((p) => (
									<li key={p.id}>
										<Link href={`/careers/${p.slug}`} className="text-sm text-primary-700 hover:underline">
											{p.title}
										</Link>
										<span className="text-xs text-slate-500"> · {p.department_label ?? ''}</span>
									</li>
								))}
							</ul>
						</div>
					)}
					<div>
						<h2 className="text-sm font-semibold mb-1">Hear about the next one</h2>
						<AlertSignup positionId={row.id} tags={[row.department_label ?? ''].filter(Boolean)} source="closed_role" />
					</div>
				</div>
			</CareersShell>
		);
	}
	const brand = brands.find((b) => b.brand === position.brand) ?? null;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com';
	const md = renderPosting({ title: position.title, compensation_statement: position.compensation_statement, about_us_override_md: position.about_us_override_md, role_md: position.role_md, responsibilities_md: position.responsibilities_md, results_md: position.results_md, requirements_md: position.requirements_md }, brand).replace(/^# .*\n+/, '');
	const applyHref = `/careers/${position.slug}/apply${sp.src ? `?src=${encodeURIComponent(sp.src)}` : ''}`;

	return (
		<CareersShell embed={embed} headline={position.title}>
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd(position, brand, appUrl)) }} />
			<div className="grid gap-6 md:grid-cols-3">
				<article className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-6 prose prose-slate prose-sm max-w-none prose-headings:text-slate-900 prose-h2:text-base prose-h2:mt-6 prose-li:my-0.5">
					<Markdown>{md}</Markdown>
				</article>
				<aside className="space-y-4">
					<div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2 text-sm">
						<div className="text-2xs uppercase tracking-wide text-slate-500">{brand?.label ?? 'Open Ronin'}</div>
						<dl className="space-y-1 text-slate-700">
							{position.department_label && <Row k="Team" v={position.department_label} />}
							<Row k="Type" v={EMPLOYMENT_TYPE_LABELS[position.employment_type]} />
							<Row k="Location" v={`${LOCATION_TYPE_LABELS[position.location_type]}${position.location_text ? ` · ${position.location_text}` : ''}`} />
							{position.timezone_note && <Row k="Hours" v={position.timezone_note} />}
							{position.reports_to && <Row k="Reports to" v={position.reports_to} />}
						</dl>
						<Link href={applyHref} className="block text-center rounded-md bg-primary-700 hover:bg-primary-800 text-white text-sm font-medium px-4 py-2.5 mt-2">
							Apply for this role
						</Link>
						<p className="text-2xs text-slate-500">English only. Takes 15-25 minutes; you can pause and come back.</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-white p-4">
						<h2 className="text-sm font-semibold mb-1">Not for you, but close?</h2>
						<AlertSignup positionId={position.id} tags={[position.department_label ?? ''].filter(Boolean)} source="careers" />
					</div>
				</aside>
			</div>
		</CareersShell>
	);
}

function Row({ k, v }: { k: string; v: string }) {
	return (
		<div className="flex justify-between gap-3">
			<dt className="text-slate-500">{k}</dt>
			<dd className="text-right">{v}</dd>
		</div>
	);
}
