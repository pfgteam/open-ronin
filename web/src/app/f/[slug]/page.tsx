// /f/[slug] — the hosted public form (0158). Signed-out, under the plain
// RootLayout. Gate + definition from lib/forms/server; the renderer posts
// to /api/f/<slug>. Clean single-column card, no app chrome.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPublicForm } from '@/lib/forms/server';
import PublicForm from './PublicForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params;
	const loaded = await loadPublicForm(slug);
	return { title: loaded ? `${loaded.def.title} · ${loaded.def.brand_label}` : 'Form', robots: { index: false } };
}

export default async function HostedFormPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const loaded = await loadPublicForm(slug);
	if (!loaded) notFound();
	const { def } = loaded;
	return (
		<main className="min-h-screen bg-slate-100 text-slate-900 antialiased">
			<div className="max-w-xl mx-auto px-4 py-8 sm:py-14">
				<div className="rounded-lg overflow-hidden border border-slate-200 bg-white">
					<div className="border-t-4 border-primary-700 px-6 sm:px-8 pt-7 pb-5">
						<div className="text-2xs uppercase tracking-[0.18em] text-slate-500">{def.brand_label}</div>
						<h1 className="text-2xl font-bold tracking-tight mt-1.5">{def.title}</h1>
						{def.description && <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">{def.description}</p>}
					</div>
					<div className="px-6 sm:px-8 pb-8">
						<PublicForm def={def} />
					</div>
				</div>
				<p className="text-2xs text-slate-500 text-center mt-5">
					Protected by a spam filter. By submitting you agree to the <a href="/privacy" className="underline hover:text-slate-700">privacy policy</a>.
				</p>
			</div>
		</main>
	);
}
