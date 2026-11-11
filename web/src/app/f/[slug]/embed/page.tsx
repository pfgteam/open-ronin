// /f/[slug]/embed — the chromeless version for an iframe on an outside
// site (0158). Same renderer, transparent background, reports its height
// to the parent so /f/embed.js can size the frame.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPublicForm } from '@/lib/forms/server';
import PublicForm from '../PublicForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params;
	const loaded = await loadPublicForm(slug);
	return { title: loaded ? loaded.def.title : 'Form', robots: { index: false } };
}

export default async function EmbedFormPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const loaded = await loadPublicForm(slug);
	if (!loaded) notFound();
	return (
		<main className="min-h-screen bg-white text-slate-900 antialiased">
			<div className="px-1 py-1">
				<PublicForm def={loaded.def} embedded />
			</div>
		</main>
	);
}
