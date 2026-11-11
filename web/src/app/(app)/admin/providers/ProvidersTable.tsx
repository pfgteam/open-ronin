'use client';

// The 25 provider rows with the inline Test button. The result renders
// right in the row: a 64px image, one sentence, a short audio player, or
// the key verification line. Test runs a real job, so a person sees the
// same path a Content Studio page or an agent takes.

import { useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { testProvider, type TestResult } from './actions';

export interface ProviderRow {
	id: string;
	label: string;
	category: string;
	capabilities: string[];
	envKeys: string[];
	docsUrl: string;
	costNote: string;
	async: boolean;
	configured: boolean;
	missingKeys: string[];
}

function ResultLine({ r }: { r: TestResult }) {
	if (!r.ok) return <span className="text-xs text-red-600 dark:text-red-400">{r.detail}</span>;
	if (r.kind === 'image' || r.kind === 'stock') {
		return (
			<span className="inline-flex items-center gap-2">
				{r.url && (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={r.url} alt="Test result" className="w-16 h-16 rounded-md object-cover border border-slate-200 dark:border-slate-700" />
				)}
				<span className="text-xs text-green-700 dark:text-green-400">{r.detail}</span>
			</span>
		);
	}
	if (r.kind === 'audio') {
		return (
			<span className="inline-flex items-center gap-2">
				{r.url && <audio controls src={r.url} className="h-8" />}
				<span className="text-xs text-green-700 dark:text-green-400">{r.detail}</span>
			</span>
		);
	}
	return <span className="text-xs text-green-700 dark:text-green-400">{r.detail}</span>;
}

export default function ProvidersTable({ rows }: { rows: ProviderRow[] }) {
	const [results, setResults] = useState<Record<string, TestResult>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [, startTransition] = useTransition();

	function run(id: string) {
		setBusy(id);
		startTransition(async () => {
			try {
				const r = await testProvider(id);
				setResults((prev) => ({ ...prev, [id]: r }));
			} catch (e) {
				setResults((prev) => ({ ...prev, [id]: { ok: false, kind: 'error', detail: e instanceof Error ? e.message : String(e) } }));
			} finally {
				setBusy(null);
			}
		});
	}

	const configured = rows.filter((r) => r.configured).length;

	return (
		<Card padding="none" className="overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
				<span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Providers</span>
				<span className="text-xs tabular-nums text-slate-400">{rows.length}</span>
				<span className="h-px flex-1 bg-slate-100 dark:bg-slate-700/60" />
				<span className="text-2xs text-slate-600 dark:text-slate-400">{configured} configured</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-slate-50/80 dark:bg-slate-900/30">
						<tr>
							<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Provider</th>
							<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Status</th>
							<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Capabilities</th>
							<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Cost</th>
							<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Env vars</th>
							<th className="text-left text-xs font-medium text-slate-600 dark:text-slate-400 px-4 py-2">Test</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((p) => {
							const r = results[p.id];
							return (
								<tr key={p.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-hover transition-colors align-top">
									<td className="px-4 py-3">
										<div className="font-medium text-slate-900 dark:text-slate-100">{p.label}</div>
										<div className="text-2xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
											<span className="font-mono">{p.id}</span>
											<span>·</span>
											<span>{p.category}</span>
											{p.async && <span>· async</span>}
											<a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary-600 dark:text-primary-400 hover:underline">
												docs <ExternalLink className="w-3 h-3" />
											</a>
										</div>
									</td>
									<td className="px-4 py-3 whitespace-nowrap">
										<span className="inline-flex items-center gap-1.5 text-2xs text-slate-600 dark:text-slate-400">
											<span className={`w-1.5 h-1.5 rounded-full ${p.configured ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
											{p.configured ? 'Configured' : 'Ready, key not set'}
										</span>
									</td>
									<td className="px-4 py-3">
										<div className="flex flex-wrap gap-1">
											{p.capabilities.length === 0 && <span className="text-2xs text-slate-600 dark:text-slate-400">none in this build</span>}
											{p.capabilities.map((c) => (
												<Badge key={c} color="default">
													{c.replace(/_/g, ' ')}
												</Badge>
											))}
										</div>
									</td>
									<td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 max-w-xs">{p.costNote}</td>
									<td className="px-4 py-3">
										{p.envKeys.map((k) => (
											<div key={k} className={`font-mono text-2xs ${p.missingKeys.includes(k) ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400'}`}>
												{k}
											</div>
										))}
									</td>
									<td className="px-4 py-3 min-w-56">
										<div className="flex flex-col gap-1.5 items-start">
											<Button size="sm" variant="outline" disabled={!p.configured || busy !== null} loading={busy === p.id} onClick={() => run(p.id)}>
												Test
											</Button>
											{r && <ResultLine r={r} />}
										</div>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</Card>
	);
}
