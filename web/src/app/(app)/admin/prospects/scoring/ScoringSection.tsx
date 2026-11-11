'use client';

// Scoring weights, lists and routing (spec 2026-10-19 §7) plus "Rescore all
// open" in pages. Number keys are number inputs, list keys are TagInputs,
// routing tiers are Selects with the budget-band labels. The dead
// r_speed_to_lead_minutes key is not shown (the live value is Team → Queue).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { countOpenDeals, rescoreOpenPage, saveScoringConfig } from '@/app/(app)/prospects/scoringActions';
import { isValidDomain, rescoreProgress, scoringKindForKey, tierOptions, type RescoreState } from '@/lib/revenue/adminOptions';
import type { ScoringConfigRow } from '@/lib/revenue/server';
import ConfirmAction from '@/components/ui/ConfirmAction';
import { createRunGuard, runLoop } from '../_ui/runLoop';
import SettingsSection from '../_ui/SettingsSection';
import TagInput from '../_ui/TagInput';

const HIDDEN = new Set(['r_speed_to_lead_minutes']);
const TIER_KEYS = new Set(['r_book_min_tier', 'r_setter_tier']);
const LIST_VALIDATE: Record<string, (s: string) => string | null> = {
	free_email_domains: (s) => (isValidDomain(s) ? null : 'not a domain'),
};

function Card({ title, description, rows, values, setValue, canManage }: {
	title: string;
	description: string;
	rows: ScoringConfigRow[];
	values: Record<string, unknown>;
	setValue: (k: string, v: unknown) => void;
	canManage: boolean;
}) {
	const router = useRouter();
	const { toast } = useToast();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const save = () =>
		start(async () => {
			setError(null);
			const r = await saveScoringConfig({ values: Object.fromEntries(rows.map((row) => [row.key, values[row.key]])) });
			if (!r.ok) {
				setError(r.error);
				return;
			}
			toast({ message: `${title} saved`, variant: 'success' });
			router.refresh();
		});
	if (!rows.length) return null;
	return (
		<SettingsSection title={title} description={description} actions={canManage && <Button size="sm" loading={pending} onClick={save}>Save</Button>}>
			<div className="grid gap-3 sm:grid-cols-2">
				{rows.map((row) => {
					const kind = scoringKindForKey(row.key);
					if (kind === 'list') {
						return (
							<div key={row.key} className="sm:col-span-2">
								<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">{row.label}</p>
								<TagInput ariaLabel={row.label} value={(values[row.key] as string[]) ?? []} onChange={(v) => setValue(row.key, v)} validate={LIST_VALIDATE[row.key]} disabled={!canManage} />
								{row.note && <p className="mt-1 text-2xs text-slate-500">{row.note}</p>}
							</div>
						);
					}
					if (TIER_KEYS.has(row.key)) {
						return (
							<Select key={row.key} label={row.label} value={String(values[row.key] ?? '')} disabled={!canManage} onChange={(e) => setValue(row.key, e.target.value)}>
								{tierOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
							</Select>
						);
					}
					return <Input key={row.key} label={row.label} type="number" step="any" value={String(values[row.key] ?? '')} disabled={!canManage} onChange={(e) => setValue(row.key, e.target.value)} />;
				})}
			</div>
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</SettingsSection>
	);
}

function RescoreCard({ canManage }: { canManage: boolean }) {
	const router = useRouter();
	const { toast } = useToast();
	const [total, setTotal] = useState<number | null>(null);
	const [state, setState] = useState<RescoreState | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [guard] = useState(createRunGuard);
	const run = async () => {
		setRunning(true);
		setError(null);
		setState(null);
		try {
			setTotal(await countOpenDeals());
			let after: string | null = null;
			let acc: RescoreState | undefined;
			const out = await runLoop(async () => {
				const r = await rescoreOpenPage({ afterId: after, size: 200 });
				if (!r.ok) return { ok: false, error: r.error };
				acc = rescoreProgress(acc, r);
				setState(acc);
				after = r.lastId;
				return { ok: true, done: r.finished };
			}, 200);
			if (out.error) {
				setError(out.error);
				return;
			}
			router.refresh();
			if (acc?.failed) toast({ message: `Rescored ${(acc.processed - acc.failed).toLocaleString()}; ${acc.failed.toLocaleString()} failed`, variant: 'error' });
			else toast({ message: `Rescored ${(acc?.processed ?? 0).toLocaleString()} open deals`, variant: 'success' });
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRunning(false);
			guard.finish();
		}
	};
	return (
		<SettingsSection title="Rescore all open deals" description="Recalculates Quality and Heat after a weight change. Routing may change, which sends bells, creates tasks and can make deals eligible for the GHL push.">
			{state && total != null && (
				<div className="mb-3">
					<p className="text-sm">
						Processed <b className="tabular-nums">{state.processed.toLocaleString()}</b> / {total.toLocaleString()}
						{state.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {state.failed.toLocaleString()} failed</span>}
						{running ? ' — keep this page open' : ''}
					</p>
					<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
						<div className="h-full bg-primary-500" style={{ width: `${total ? Math.min(100, Math.round((state.processed / total) * 100)) : 100}%` }} />
					</div>
					{!running && state.firstError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">First error: {state.firstError}</p>}
				</div>
			)}
			{error && <Callout tone="error" className="mb-3">{error}</Callout>}
			{canManage && (
				<ConfirmAction
					label="Rescore all open…"
					title="Rescore every open deal?"
					confirmLabel="Rescore now"
					disabled={running}
					impact={
						<>
							<p>Every open deal is rescored in pages of 200 (about 7,000 today — a few minutes). Keep this page open until it finishes.</p>
							<p>Deals whose routing changes trigger bells and tasks, and any score change on a deal already pushed to GHL makes it eligible again.</p>
						</>
					}
					onConfirm={async () => {
						if (!guard.tryStart()) return { ok: false, error: 'A rescore is already running on this page.' };
						void run();
						return { ok: true };
					}}
				/>
			)}
		</SettingsSection>
	);
}

export default function ScoringSection({ rows, canManage }: { rows: ScoringConfigRow[]; canManage: boolean }) {
	const visible = useMemo(() => rows.filter((r) => !HIDDEN.has(r.key)), [rows]);
	// Values follow the declared kind: a weight the old save broke into an array shows empty and can be re-entered.
	const [values, setValues] = useState<Record<string, unknown>>(() =>
		Object.fromEntries(visible.map((r) => [r.key, scoringKindForKey(r.key) === 'list' ? (Array.isArray(r.value) ? r.value : []) : typeof r.value === 'number' || typeof r.value === 'string' ? String(r.value) : ''])),
	);
	const setValue = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
	const group = (g: ScoringConfigRow['group_key']) => visible.filter((r) => r.group_key === g);
	const heat = group('heat');
	return (
		<>
			<Card title="Quality (fit)" description="How well a lead fits Open Ronin — points per signal, out of 25" rows={group('quality')} values={values} setValue={setValue} canManage={canManage} />
			<Card title="Heat (engagement)" description="Points per touch, reply and call outcome; no-shows subtract" rows={heat.filter((r) => !r.key.startsWith('h_no_show_delay'))} values={values} setValue={setValue} canManage={canManage} />
			<Card title="No-show pause" description="After this many no-shows, the deal is held for this many days" rows={heat.filter((r) => r.key.startsWith('h_no_show_delay'))} values={values} setValue={setValue} canManage={canManage} />
			<Card title="Routing" description="Where a scored lead goes, by budget tier" rows={group('routing')} values={values} setValue={setValue} canManage={canManage} />
			<Card title="Lists" description="Matching lists used by the Quality score" rows={group('lists')} values={values} setValue={setValue} canManage={canManage} />
			<RescoreCard canManage={canManage} />
		</>
	);
}
