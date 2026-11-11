// /social/studio/jobs: every content job the viewer may see (RLS: own rows,
// admins all) with status, cost, provider and Run now / Cancel / Retry.
// Chains (parent_job_id) render as one card with numbered steps.

import Card from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import JobCard from '@/components/content-studio/JobCard';
import { listJobs } from '@/lib/content-studio/server';
import { formatUsd, groupChains } from '@/lib/content-studio/shared';

export const dynamic = 'force-dynamic';

export default async function StudioJobsPage() {
	const jobs = await listJobs({ limit: 200 });
	const chains = groupChains(jobs);
	const spent = jobs.reduce((s, j) => s + (j.cost_usd ?? 0), 0);
	const active = jobs.filter((j) => ['queued', 'submitted', 'running'].includes(j.status)).length;

	return (
		<>
			<PageHeader
				title="Jobs"
				description={`${jobs.length} jobs you can see · ${active} in flight · ${formatUsd(spent)} estimated across them`}
			/>
			{chains.length === 0 ? (
				<Card>
					<p className="text-sm text-slate-500 dark:text-slate-400">No jobs yet.</p>
				</Card>
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
					{chains.map(({ root, steps }) => (
						<JobCard key={root.id} job={root} steps={steps} compact />
					))}
				</div>
			)}
		</>
	);
}
