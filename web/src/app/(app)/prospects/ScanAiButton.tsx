'use client';

// "Scan AI" for a person or a brand: runs the scan, shows what it found next
// to what the record has, and writes only the rows the rep keeps ticked.
// Empty fields come pre-ticked; a value that would replace an existing one
// starts unticked, so nothing is overwritten by accident.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Dialog from '@/components/ui/Dialog';
import Skeleton from '@/components/ui/Skeleton';
import { controlFocus } from '@/components/ui/focus';
import { useToast } from '@/components/ui/Toast';
import type { ScanOutcome } from '@/lib/revenue/scan';
import type { ScanTarget } from '@/lib/revenue/scanFields';
import { applyScan, scanRecord } from './scanActions';

const SOURCE_LABEL = { website: 'Website', linkedin: 'LinkedIn' } as const;

export default function ScanAiButton({ target, id, variant = 'button', className }: {
	target: ScanTarget;
	id: string;
	/** 'button' for page headers, 'link' for the small text action on cards. */
	variant?: 'button' | 'link';
	className?: string;
}) {
	const router = useRouter();
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [scan, setScan] = useState<ScanOutcome | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [keep, setKeep] = useState<Set<string>>(new Set());
	const [scanning, startScan] = useTransition();
	const [saving, startSave] = useTransition();

	const run = () => {
		setOpen(true);
		setScan(null);
		setError(null);
		startScan(async () => {
			const r = await scanRecord({ target, id });
			if (!r.ok) return setError(r.error);
			setScan(r.scan);
			setKeep(new Set(r.scan.fields.filter((f) => !f.current).map((f) => f.key)));
		});
	};

	const toggle = (key: string) =>
		setKeep((s) => {
			const n = new Set(s);
			if (n.has(key)) n.delete(key);
			else n.add(key);
			return n;
		});

	const save = () => {
		if (!scan) return;
		const values = Object.fromEntries(scan.fields.filter((f) => keep.has(f.key)).map((f) => [f.key, f.found]));
		startSave(async () => {
			const r = await applyScan({ target, id, values, sources: scan.notes.filter((n) => n.status === 'ok').map((n) => n.source) });
			if (!r.ok) return setError(r.error);
			toast({ message: `Updated ${r.applied} field${r.applied === 1 ? '' : 's'} on ${scan.name}`, variant: 'success' });
			setOpen(false);
			router.refresh();
		});
	};

	return (
		<>
			{variant === 'link' ? (
				<button type="button" onClick={run} className={clsx('inline-flex items-center gap-1 text-2xs text-primary-700 hover:underline dark:text-primary-300', controlFocus, className)}>
					<Sparkles className="h-3 w-3" aria-hidden="true" /> Scan AI
				</button>
			) : (
				<Button type="button" variant="outline" size="sm" onClick={run} className={className}>
					<Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Scan AI
				</Button>
			)}
			<Dialog
				open={open}
				onClose={() => !saving && setOpen(false)}
				title={scan ? `Scan AI · ${scan.name}` : 'Scan AI'}
				subtitle={target === 'person' ? 'Reads the brand website and, when there is a profile URL, LinkedIn. Nothing is saved until you apply.' : 'Reads the brand website. Nothing is saved until you apply.'}
				footer={
					scan && scan.fields.length > 0 ? (
						<>
							<Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
							<Button type="button" size="sm" onClick={save} loading={saving} disabled={keep.size === 0}>
								Apply {keep.size} field{keep.size === 1 ? '' : 's'}
							</Button>
						</>
					) : undefined
				}
			>
				<div className="space-y-3">
					{error && <Callout tone="error">{error}</Callout>}
					{scanning && (
						<div className="space-y-2" aria-busy="true">
							<p className="text-xs text-slate-500">{target === 'person' ? 'Scanning… LinkedIn can take up to a minute.' : 'Scanning the website…'}</p>
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-2/3" />
						</div>
					)}
					{scan && (
						<>
							<ul className="space-y-1 text-xs">
								{scan.notes.map((n) => (
									<li key={n.source} className="flex gap-2">
										<span className={clsx('w-16 shrink-0 font-medium', n.status === 'ok' ? 'text-green-700 dark:text-green-400' : n.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-slate-500')}>
											{SOURCE_LABEL[n.source]}
										</span>
										<span className="text-slate-600 dark:text-slate-400">{n.detail}</span>
									</li>
								))}
							</ul>
							{scan.fields.length === 0 ? (
								<p className="text-sm text-slate-600 dark:text-slate-400">Nothing new found. The record already matches what the sources say.</p>
							) : (
								<div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
									<table className="w-full text-left text-xs">
										<thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60">
											<tr>
												<th className="w-8 px-2 py-1.5"><span className="sr-only">Keep</span></th>
												<th className="px-2 py-1.5 font-medium">Field</th>
												<th className="px-2 py-1.5 font-medium">Now</th>
												<th className="px-2 py-1.5 font-medium">Found</th>
												<th className="px-2 py-1.5 font-medium">Source</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-200 dark:divide-slate-700">
											{scan.fields.map((f) => (
												<tr key={f.key} className={clsx(!keep.has(f.key) && 'text-slate-400')}>
													<td className="px-2 py-1.5 align-top">
														<input type="checkbox" className="accent-primary-600" checked={keep.has(f.key)} onChange={() => toggle(f.key)} aria-label={`Keep ${f.label}`} />
													</td>
													<td className="px-2 py-1.5 align-top font-medium text-slate-700 dark:text-slate-300">{f.label}</td>
													<td className="max-w-40 px-2 py-1.5 align-top break-words text-slate-500">{f.current ?? '—'}</td>
													<td className="max-w-64 px-2 py-1.5 align-top break-words text-slate-900 dark:text-slate-100">{f.found}</td>
													<td className="px-2 py-1.5 align-top text-slate-500">{SOURCE_LABEL[f.source]}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
							{scan.fields.some((f) => f.current) && <p className="text-2xs text-slate-500">Rows that would replace an existing value start unticked.</p>}
						</>
					)}
				</div>
			</Dialog>
		</>
	);
}
