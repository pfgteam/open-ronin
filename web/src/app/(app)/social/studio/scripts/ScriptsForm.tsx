'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import BriefForm from '@/components/content-studio/BriefForm';
import ProviderPicker from '@/components/content-studio/ProviderPicker';
import JobCard from '@/components/content-studio/JobCard';
import { EMPTY_BRIEF, type Brief, type ProviderOption, type StudioJob } from '@/lib/content-studio/shared';
import { attachTextToWorkItem, createTaskWithScript, generateScript } from '../actions';

interface Props {
	providers: ProviderOption[];
	clients: { id: string; name: string; status: string }[];
	workItems: { id: string; name: string }[];
	jobs: StudioJob[];
}

export default function ScriptsForm({ providers, clients, workItems, jobs }: Props) {
	const router = useRouter();
	const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF);
	const [provider, setProvider] = useState(providers[0]?.id ?? '');
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();

	function submit() {
		setError(null);
		start(async () => {
			const res = await generateScript(provider, brief);
			if (!res.ok) setError(res.error);
			router.refresh();
		});
	}

	return (
		<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
			<Card className="lg:col-span-2 space-y-4 self-start">
				<BriefForm brief={brief} onChange={setBrief} clients={clients} disabled={pending} />
				<ProviderPicker label="Text provider" providers={providers} value={provider} onChange={setProvider} disabled={pending} />
				{error && <Callout tone="error">{error}</Callout>}
				<Button onClick={submit} loading={pending} disabled={!provider || brief.goal.trim().length < 3}>
					Draft script
				</Button>
			</Card>

			<div className="lg:col-span-3 space-y-3">
				{jobs.length === 0 && (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400">Your scripts appear here. The first one takes about ten seconds.</p>
					</Card>
				)}
				{jobs.map((job) => (
					<JobCard key={job.id} job={job} title={`Script · ${job.provider}`}>
						{job.text && <ScriptResult job={job} workItems={workItems} clientId={brief.clientId || null} />}
					</JobCard>
				))}
			</div>
		</div>
	);
}

function ScriptResult({ job, workItems, clientId }: { job: StudioJob; workItems: { id: string; name: string }[]; clientId: string | null }) {
	const router = useRouter();
	const [target, setTarget] = useState(workItems[0]?.id ?? '');
	const [taskName, setTaskName] = useState('');
	const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
	const [pending, start] = useTransition();
	const text = job.text ?? '';

	function attach() {
		setNotice(null);
		start(async () => {
			const res = await attachTextToWorkItem(target, `Script ${job.created_at.slice(0, 10)}`, text);
			setNotice(res.ok ? { tone: 'success', text: 'Attached to the task.' } : { tone: 'error', text: res.error });
		});
	}
	function createTask() {
		setNotice(null);
		start(async () => {
			const res = await createTaskWithScript(taskName, clientId, text);
			setNotice(res.ok ? { tone: 'success', text: 'Task created with the script attached.' } : { tone: 'error', text: res.error });
			if (res.ok) router.refresh();
		});
	}

	return (
		<div className="space-y-3">
			<pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200 font-sans bg-slate-50 dark:bg-slate-800/60 rounded-md p-3 max-h-96 overflow-auto">{text}</pre>
			{notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
			<div className="flex flex-wrap items-end gap-2">
				<Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(text)}>
					Copy
				</Button>
				<Link href={`/social/studio/video?script=${job.id}`}>
					<Button size="sm" variant="outline">
						Send to Video Studio
					</Button>
				</Link>
				{workItems.length > 0 && (
					<>
						<div className="min-w-48">
							<Select size="sm" aria-label="Task" value={target} onChange={(e) => setTarget(e.target.value)}>
								{workItems.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name}
									</option>
								))}
							</Select>
						</div>
						<Button size="sm" variant="secondary" onClick={attach} disabled={pending || !target}>
							Attach to task
						</Button>
					</>
				)}
			</div>
			<div className="flex flex-wrap items-end gap-2">
				<div className="min-w-64">
					<Input placeholder="New task name" value={taskName} onChange={(e) => setTaskName(e.target.value)} aria-label="New task name" />
				</div>
				<Button size="sm" variant="secondary" onClick={createTask} disabled={pending || taskName.trim().length === 0}>
					Create task with script
				</Button>
			</div>
		</div>
	);
}
