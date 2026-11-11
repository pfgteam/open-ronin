// /intake/[slug] — the public MQL form (0122). Signed-out, under the plain
// RootLayout (outside the (app) shell). Multi-page on the `page` key each
// field carries, conditional logic from lib/forms/logic, posts to
// /api/intake/form/<slug>, then shows the routing-specific thank-you
// (book a call / we'll reach out / nurture) from rev_form_links.routing_copy.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { parseFields } from '@/lib/forms/logic';
import PublicIntakeForm from './PublicIntakeForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params;
	const db = createServiceRoleClient();
	const { data } = await db.from('forms').select('title').eq('slug', slug).maybeSingle();
	return { title: data?.title ?? 'Open Ronin' };
}

export default async function PublicIntakePage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	if (!/^[a-z0-9-]{2,64}$/.test(slug)) notFound();
	const db = createServiceRoleClient();
	const { data: form } = await db.from('forms').select('id, title, description_md, status, fields').eq('slug', slug).maybeSingle();
	if (!form) notFound();
	const { data: link } = await db.from('rev_form_links').select('public, enabled').eq('form_id', form.id).maybeSingle();
	if (!link?.public || !link.enabled || form.status !== 'open') notFound();
	let fields;
	try {
		fields = parseFields(form.fields);
	} catch {
		notFound();
	}
	const pages = (form.fields as { key: string; page?: number }[]).reduce<Record<string, number>>((acc, f) => {
		acc[f.key] = f.page ?? 1;
		return acc;
	}, {});

	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			<div className="max-w-xl mx-auto px-4 py-10">
				<div className="rounded-lg overflow-hidden border border-slate-200 bg-white shadow-panel">
					<div className="bg-primary-600 text-white px-6 py-5">
						<div className="text-2xs uppercase tracking-wider text-primary-100">Open Ronin</div>
						<h1 className="text-xl font-bold tracking-tight mt-1">{form.title}</h1>
						{form.description_md && <p className="text-sm text-primary-50 mt-1">{form.description_md}</p>}
					</div>
					<div className="p-6">
						<PublicIntakeForm slug={slug} fields={fields} pages={pages} />
					</div>
				</div>
				<p className="text-2xs text-slate-500 text-center mt-4">
					By submitting you agree to our <a href="/privacy" className="underline">privacy policy</a>.
				</p>
			</div>
		</main>
	);
}
