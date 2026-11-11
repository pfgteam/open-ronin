// /careers/[slug]/apply — the guided application (0130, H3). Consent first,
// then the role's config-driven sections. Signed-out; the session token
// from /api/careers/apply/<slug>/start is the credential. ?src= (from the
// tracked link) or the or_src cookie attributes the source.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { loadOpenPosition } from '@/lib/hiring/server';
import CareersShell from '../../CareersShell';
import ApplyForm from './ApplyForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Apply · Careers · Open Ronin', robots: { index: false } };

export default async function ApplyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string; src?: string }> }) {
	const { slug } = await params;
	const sp = await searchParams;
	if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) notFound();
	const position = await loadOpenPosition(createServiceRoleClient(), slug);
	if (!position) notFound();
	const src = sp.src && /^[a-z0-9][a-z0-9-]{3,40}$/.test(sp.src) ? sp.src : null;
	return (
		<CareersShell embed={sp.embed === '1'} headline={`Apply: ${position.title}`}>
			<div className="max-w-2xl mx-auto space-y-3">
				<Link href={`/careers/${position.slug}`} className="text-xs text-primary-700 hover:underline">
					← Back to the role
				</Link>
				<ApplyForm slug={position.slug} src={src} />
			</div>
		</CareersShell>
	);
}
