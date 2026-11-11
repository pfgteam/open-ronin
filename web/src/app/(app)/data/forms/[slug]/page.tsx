// /data/forms/[slug] — fill a form (staff, signed in). Builders read what
// came in at /data/forms/[slug]/submissions (0158 inbox); the old
// ?view=submissions redirects there.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getAuthProfile } from '@/lib/supabase/server';
import { loadSensitiveAccessContext, canManagePeople } from '@/lib/people/permissions';
import { parseFields, type FormField } from '@/lib/forms/logic';
import FormRenderer from '../FormRenderer';

export const dynamic = 'force-dynamic';

export default async function FormFillPage({
	params,
	searchParams,
}: {
	params: Promise<{ slug: string }>;
	searchParams: Promise<{ view?: string }>;
}) {
	const [{ slug }, sp] = await Promise.all([params, searchParams]);
	if (!/^[a-z0-9-]{2,64}$/.test(slug)) notFound();
	const profile = await getAuthProfile();
	if (!profile) redirect('/auth/login');
	const ctx = await loadSensitiveAccessContext();
	const canBuild = canManagePeople(ctx) || profile.role === 'exec';

	const supabase = await createClient();
	const { data: form } = await supabase
		.from('forms')
		.select('id, slug, title, description_md, status, fields, allow_multiple')
		.eq('slug', slug)
		.maybeSingle();
	if (!form) notFound();
	let fields: FormField[] = [];
	try {
		fields = parseFields(form.fields);
	} catch {
		fields = [];
	}

	if (sp.view === 'submissions' && canBuild) redirect(`/data/forms/${slug}/submissions`);

	return (
		<>
			<PageHeader
				title={form.title}
				description={form.description_md ?? undefined}
				actions={canBuild ? <Link href={`/data/forms/${slug}/submissions`} className="text-xs text-primary-600 hover:underline">Inbox →</Link> : null}
			/>
			{form.status !== 'open' ? (
				<Card><p className="text-sm text-slate-500 py-6 text-center">This form is {form.status}.</p></Card>
			) : (
				<FormRenderer slug={slug} fields={fields} allowMultiple={form.allow_multiple} />
			)}
		</>
	);
}
