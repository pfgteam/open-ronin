'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import BriefForm from '@/components/content-studio/BriefForm';
import ProviderPicker from '@/components/content-studio/ProviderPicker';
import JobCard from '@/components/content-studio/JobCard';
import { formatRelative } from '@/lib/format';
import { EMPTY_BRIEF, parseOptions, type Brief, type ProviderOption, type StudioJob } from '@/lib/content-studio/shared';
import { deleteHook, generateHeadlines, saveHook } from '../actions';

interface Hook {
	id: string;
	hook_text: string;
	client_id: string | null;
	created_at: string;
}

interface Props {
	providers: ProviderOption[];
	clients: { id: string; name: string; status: string }[];
	hooks: Hook[];
	jobs: StudioJob[];
}

export default function HeadlinesForm({ providers, clients, hooks, jobs }: Props) {
	const router = useRouter();
	const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF);
	const [provider, setProvider] = useState(providers[0]?.id ?? '');
	const [count, setCount] = useState(12);
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	// Hooks starred this session, so the star fills before the refresh lands.
	const [starred, setStarred] = useState<Set<string>>(new Set(hooks.map((h) => h.hook_text)));
	const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null;

	function submit() {
		setError(null);
		start(async () => {
			const res = await generateHeadlines(provider, brief, count);
			if (!res.ok) setError(res.error);
			router.refresh();
		});
	}

	function star(text: string) {
		setStarred((s) => new Set(s).add(text));
		start(async () => {
			const res = await saveHook(text, brief.clientId || null);
			if (!res.ok) {
				setError(res.error);
				setStarred((s) => {
					const n = new Set(s);
					n.delete(text);
					return n;
				});
			}
			router.refresh();
		});
	}

	function remove(id: string) {
		start(async () => {
			const res = await deleteHook(id);
			if (!res.ok) setError(res.error);
			router.refresh();
		});
	}

	return (
		<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
			<div className="lg:col-span-2 space-y-4">
				<Card className="space-y-4">
					<BriefForm brief={brief} onChange={setBrief} clients={clients} disabled={pending} showLength={false} />
					<div className="grid grid-cols-2 gap-3 items-end">
						<Select label="How many" value={String(count)} onChange={(e) => setCount(Number(e.target.value))} disabled={pending}>
							{[10, 12, 15, 20].map((n) => (
								<option key={n} value={n}>
									{n} options
								</option>
							))}
						</Select>
						<ProviderPicker label="Text provider" providers={providers} value={provider} onChange={setProvider} disabled={pending} />
					</div>
					{error && <Callout tone="error">{error}</Callout>}
					<Button onClick={submit} loading={pending} disabled={!provider || brief.goal.trim().length < 3}>
						Generate hooks
					</Button>
				</Card>

				<Card className="space-y-2">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hook library</h2>
					{hooks.length === 0 ? (
						<p className="text-sm text-slate-500 dark:text-slate-400">Star an option to keep it here.</p>
					) : (
						<ul className="divide-y divide-slate-200 dark:divide-slate-700">
							{hooks.map((h) => (
								<li key={h.id} className="py-2 flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="text-sm text-slate-700 dark:text-slate-200">{h.hook_text}</p>
										<p className="text-2xs text-slate-400 dark:text-slate-500">
											{clientName(h.client_id) ?? 'General'} · {formatRelative(h.created_at)}
										</p>
									</div>
									<button
										type="button"
										aria-label="Remove hook"
										onClick={() => remove(h.id)}
										className="p-1 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700"
									>
										<Trash2 className="w-4 h-4" />
									</button>
								</li>
							))}
						</ul>
					)}
				</Card>
			</div>

			<div className="lg:col-span-3 space-y-3">
				{jobs.length === 0 && (
					<Card>
						<p className="text-sm text-slate-500 dark:text-slate-400">Options appear here as a list you can star.</p>
					</Card>
				)}
				{jobs.map((job) => (
					<JobCard key={job.id} job={job} title={`Hooks · ${job.provider}`}>
						{job.text && (
							<ul className="divide-y divide-slate-200 dark:divide-slate-700">
								{parseOptions(job.text).map((opt, i) => {
									const on = starred.has(opt);
									return (
										<li key={`${job.id}-${i}`} className="py-1.5 flex items-start gap-2">
											<button
												type="button"
												aria-label={on ? 'Starred' : 'Star this hook'}
												aria-pressed={on}
												disabled={on || pending}
												onClick={() => star(opt)}
												className="mt-0.5 p-0.5 rounded-md text-slate-400 hover:text-amber-500 disabled:text-amber-500 disabled:pointer-events-none"
											>
												<Star className="w-4 h-4" fill={on ? 'currentColor' : 'none'} />
											</button>
											<span className="text-sm text-slate-700 dark:text-slate-200">{opt}</span>
										</li>
									);
								})}
							</ul>
						)}
					</JobCard>
				))}
			</div>
		</div>
	);
}
