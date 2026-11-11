'use client';

// Call rubrics (spec 2026-10-19 §7): one card per call kind — the rubric key
// IS the kind, because the AI analysis only ever looks up triage, discovery
// or closing (callActions.addCall). Live criteria preview with the weight
// sum; Save stays disabled until the weights add up to 100.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { saveRubric } from '@/app/(app)/prospects/callActions';
import { parseCriteria } from '@/lib/revenue/adminOptions';
import type { RubricRow } from '@/lib/revenue/server';
import SettingsSection from '../_ui/SettingsSection';

const KINDS = [
	{ key: 'triage', label: 'Triage call' },
	{ key: 'discovery', label: 'Discovery call' },
	{ key: 'closing', label: 'Closing call' },
] as const;

function RubricCard({ kind, label: kindLabel, rubric, canManage }: { kind: string; label: string; rubric: RubricRow | undefined; canManage: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const [label, setLabel] = useState(rubric?.label ?? kindLabel);
	const [body, setBody] = useState(rubric?.body_md ?? '## Criteria\n- **Opener** (20): \n- **Discovery** (40): \n- **Next step** (40): \n');
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const { criteria, total } = parseCriteria(body);
	const ok = criteria.length > 0 && Math.abs(total - 100) < 0.01;
	const save = () =>
		start(async () => {
			setError(null);
			const fd = new FormData();
			fd.set('key', kind);
			fd.set('label', label);
			fd.set('call_kind', kind);
			fd.set('body_md', body);
			fd.set('is_active', 'on');
			const r = await saveRubric(fd);
			if (!r.ok) {
				setError(r.error);
				return;
			}
			toast({ message: `${label} saved`, variant: 'success' });
			router.refresh();
		});
	return (
		<SettingsSection title={kindLabel} description={rubric ? `Version ${rubric.version}` : 'Not set up yet'} actions={canManage && <Button size="sm" loading={pending} disabled={!ok} onClick={save}>Save</Button>}>
			<div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
				<div className="space-y-3">
					<Input label="Name" value={label} disabled={!canManage} onChange={(e) => setLabel(e.target.value)} />
					<Textarea label="Rubric (markdown) — criteria as “- **Name** (weight): what good looks like”" rows={10} value={body} disabled={!canManage} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
				</div>
				<div>
					<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Criteria</p>
					<ul className="space-y-1 text-sm">
						{criteria.map((c, i) => (
							<li key={`${c.name}-${i}`} className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className="tabular-nums text-slate-500">{c.weight}</span></li>
						))}
						{!criteria.length && <li className="text-xs text-slate-500">No criteria lines found.</li>}
					</ul>
					<p className={clsx('mt-2 border-t border-slate-200 pt-2 text-sm font-semibold tabular-nums dark:border-slate-700', ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
						Total {total} / 100
					</p>
				</div>
			</div>
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</SettingsSection>
	);
}

export default function RubricsSection({ rubrics, canManage }: { rubrics: RubricRow[]; canManage: boolean }) {
	return (
		<>
			<h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Call rubrics</h2>
			{KINDS.map((k) => (
				<RubricCard key={k.key} kind={k.key} label={k.label} rubric={rubrics.find((r) => r.key === k.key) ?? rubrics.find((r) => r.call_kind === k.key)} canManage={canManage} />
			))}
		</>
	);
}
