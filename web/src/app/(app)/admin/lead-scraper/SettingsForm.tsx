'use client';

import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { PRESET_LABELS, SCRAPER_PRESETS, usd, type ScraperSettings } from '@/lib/scrapers/settingsShared';
import { saveScraperSettings } from './actions';

export default function SettingsForm({
	settings,
	applied,
	spentUsd,
}: {
	settings: ScraperSettings;
	applied: boolean;
	spentUsd: number;
}) {
	const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
	const [cap, setCap] = useState(settings.monthlyBudgetUsd === null ? '' : String(settings.monthlyBudgetUsd));
	const [pending, start] = useTransition();

	const capNumber = cap.trim() === '' ? null : Number(cap);
	const belowSpend = capNumber !== null && Number.isFinite(capNumber) && capNumber < spentUsd;

	function submit(fd: FormData) {
		setResult(null);
		start(async () => {
			const r = await saveScraperSettings(fd);
			setResult(r.ok ? { ok: true, message: 'Settings saved.' } : { ok: false, message: r.error });
		});
	}

	return (
		<form action={submit} className="space-y-4">
			{result && <Callout tone={result.ok ? 'success' : 'error'}>{result.message}</Callout>}

			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Defaults</h2>
				<p className="text-2xs text-slate-600 dark:text-slate-400">What a new search on the Lead Scraper page starts with.</p>
				<div className="grid gap-3 sm:grid-cols-2">
					<Select label="Default preset" name="default_preset" defaultValue={settings.defaultPreset}>
						{SCRAPER_PRESETS.map((p) => (
							<option key={p} value={p}>
								{PRESET_LABELS[p]}
							</option>
						))}
					</Select>
					<Input
						label="Default max results"
						name="default_max_results"
						type="number"
						min={1}
						max={5000}
						defaultValue={settings.defaultMaxResults}
						required
					/>
				</div>
			</Card>

			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cost per 1,000 rows (USD)</h2>
				<p className="text-2xs text-slate-600 dark:text-slate-400">
					From each Apify actor&apos;s pricing. These drive the spend estimate and the budget guard;
					the Apify invoice is the truth.
				</p>
				<div className="grid gap-3 sm:grid-cols-2">
					{SCRAPER_PRESETS.map((p) => (
						<Input
							key={p}
							label={PRESET_LABELS[p]}
							name={`cost_${p}`}
							type="number"
							step="0.01"
							min={0}
							defaultValue={settings.costPer1000[p] ?? 0}
							required
						/>
					))}
				</div>
			</Card>

			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Monthly budget cap (USD)</h2>
				<p className="text-2xs text-slate-600 dark:text-slate-400">
					Estimated spend ceiling per calendar month. Leave blank for no cap. Enforced in the
					database on every dispatch, by the cron and by Run now alike: a job whose committed
					cost would pass the cap is held in the queue with the reason shown on the Lead Scraper page.
				</p>
				<div className="max-w-xs">
					<Input
						label="Cap"
						name="monthly_budget_usd"
						type="number"
						step="0.01"
						min={0}
						value={cap}
						onChange={(e) => setCap(e.target.value)}
						placeholder="no cap"
					/>
				</div>
				{belowSpend && (
					<Callout tone="warning">
						This cap is below this month&apos;s spend ({usd(spentUsd)}). Saving it holds every new
						dispatch until the cap is raised or the month rolls over.
					</Callout>
				)}
			</Card>

			<div className="flex items-center gap-3">
				<Button type="submit" loading={pending} disabled={!applied}>
					Save settings
				</Button>
				{settings.updatedAt && (
					<span className="text-2xs text-slate-600 dark:text-slate-400">Last saved {new Date(settings.updatedAt).toLocaleString()}</span>
				)}
			</div>
		</form>
	);
}
