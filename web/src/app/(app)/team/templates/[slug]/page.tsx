// /team/templates/[slug] - Template detail with task tree.

import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ChevronLeft, Clock, Star, Workflow, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
	params: Promise<{ slug: string }>;
}

interface TemplateTask {
	id: string;
	template_id: string;
	parent_template_task_id: string | null;
	title: string;
	description_md: string | null;
	offset_start_days: number;
	duration_days: number;
	default_assignee_role: string | null;
	priority: string | null;
	is_lead_indicator: boolean;
	is_milestone: boolean;
	position: number;
	tags: string[];
}

export default async function TemplateDetail({ params }: PageProps) {
	const { slug } = await params;
	const supabase = await createClient();
	const { data: template } = await supabase
		.from('project_templates')
		.select('*')
		.eq('slug', slug)
		.maybeSingle();
	if (!template) notFound();

	const { data: tasks } = await supabase
		.from('project_template_tasks')
		.select('*')
		.eq('template_id', template.id)
		.order('position');

	const taskRows = (tasks ?? []) as TemplateTask[];

	return (
		<>
			<Link href="/team/templates" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4 transition-colors">
				<ChevronLeft className="w-3 h-3" /> Templates
			</Link>

			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Workflow className="w-5 h-5 text-primary-500" /> {template.name}
					</span>
				}
				description={
					<>
						<span className="block">{template.description_md ?? '—'}</span>
						<span className="flex flex-wrap items-center gap-1.5 mt-2">
							<Badge color="primary">{template.kind}</Badge>
							{template.default_duration_days && <Badge color="default">{template.default_duration_days} days</Badge>}
							{template.default_owner_role && <Badge color="default">owned by {template.default_owner_role}</Badge>}
						</span>
					</>
				}
				actions={
					<Link href="/the-work/planning?kind=project">
						<button className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 transition-colors">
							<Plus className="w-3 h-3" /> Use template
						</button>
					</Link>
				}
			/>

			<Card padding="none">
				<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Task workflow ({taskRows.length})</h2>
					<span className="text-2xs text-slate-600 dark:text-slate-400">Day 0 = project start</span>
				</div>
				{taskRows.length === 0 ? (
					<p className="text-sm text-slate-500 text-center py-6">No tasks defined yet.</p>
				) : (
					<ol className="divide-y divide-slate-200 dark:divide-slate-700">
						{taskRows.map((t) => (
							<li key={t.id} className="px-3 py-2 flex items-start gap-3">
								<div className="text-2xs font-mono text-slate-600 dark:text-slate-400 w-16 shrink-0 mt-0.5">
									Day {t.offset_start_days}{t.duration_days > 0 ? `-${t.offset_start_days + t.duration_days}` : ''}
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										{t.is_milestone && <Star className="w-3 h-3 text-amber-500 shrink-0" />}
										<span className="text-sm text-slate-900 dark:text-slate-100">{t.title}</span>
										{t.priority && <Badge color={priorityColor(t.priority)} className="text-2xs">{t.priority}</Badge>}
										{t.is_lead_indicator && <Badge color="primary" className="text-2xs">Lead</Badge>}
									</div>
									{t.default_assignee_role && (
										<p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5">Role: {t.default_assignee_role}</p>
									)}
								</div>
								<div className="text-2xs text-slate-600 dark:text-slate-400 shrink-0 flex items-center gap-1">
									<Clock className="w-3 h-3" /> {t.duration_days}d
								</div>
							</li>
						))}
					</ol>
				)}
			</Card>
		</>
	);
}

function priorityColor(p: string): 'default' | 'warning' | 'danger' | 'primary' {
	if (p === 'urgent' || p === 'high') return 'danger';
	if (p === 'medium') return 'warning';
	return 'default';
}
