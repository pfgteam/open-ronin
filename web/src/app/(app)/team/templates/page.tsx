// /team/templates - Project + onboarding templates.
// Lists project_templates and links to detail/edit + "instantiate" flow.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Workflow, Plus, ExternalLink } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface Template {
	id: string;
	name: string;
	slug: string;
	kind: string;
	description_md: string | null;
	default_duration_days: number | null;
	default_owner_role: string | null;
	is_active: boolean;
	airtable_workflow_ref: string | null;
}

export default async function TemplatesPage() {
	const supabase = await createClient();
	const { data: templates } = await supabase
		.from('project_templates')
		.select('*')
		.eq('is_active', true)
		.order('kind')
		.order('name');

	const rows = (templates ?? []) as Template[];
	const byKind = rows.reduce<Record<string, Template[]>>((acc, t) => {
		(acc[t.kind] ??= []).push(t);
		return acc;
	}, {});

	const KIND_LABELS: Record<string, string> = {
		onboarding: 'Client Onboarding',
		beacon_onboarding: 'Beacon Onboarding',
		campaign: 'Campaigns',
		event: 'Events',
		product_launch: 'Product Launches',
	};

	return (
		<>
			<PageHeader
				title="Project Templates"
				description={
					<>
						Standardized workflows for Client onboarding, Beacon onboarding, and recurring playbooks.
						When you create a new project of a matching kind, the template&apos;s task list seeds it.
					</>
				}
				actions={
					<Link href="/team/templates/_new">
						<button className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 transition-colors">
							<Plus className="w-3 h-3" /> New template
						</button>
					</Link>
				}
			/>

			{rows.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 text-center py-6">No templates yet. Ask Ops to load the standard Open Ronin onboarding workflows.</p>
				</Card>
			) : (
				Object.entries(byKind).map(([kind, list]) => (
					<div key={kind} className="mb-6">
						<h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1">
							<Workflow className="w-3 h-3" /> {KIND_LABELS[kind] ?? kind}
						</h2>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
							{list.map((t) => (
								<Link key={t.id} href={`/team/templates/${t.slug}`}>
									<Card className="hover:border-primary-400 dark:hover:border-primary-700 transition-colors h-full">
										<div className="flex items-start justify-between mb-1.5">
											<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.name}</h3>
											{t.default_duration_days && <Badge color="primary" className="text-2xs">{t.default_duration_days}d</Badge>}
										</div>
										{t.description_md && (
											<p className="text-xs text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">{t.description_md}</p>
										)}
										<div className="flex flex-wrap items-center gap-1">
											{t.default_owner_role && <Badge color="default" className="text-2xs">{t.default_owner_role}</Badge>}
											{t.airtable_workflow_ref && (
												<Badge color="warning" className="text-2xs"><ExternalLink className="w-2.5 h-2.5 mr-0.5" />Airtable</Badge>
											)}
										</div>
									</Card>
								</Link>
							))}
						</div>
					</div>
				))
			)}
		</>
	);
}
