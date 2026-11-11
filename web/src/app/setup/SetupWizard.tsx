'use client';

// The setup wizard: five steps over one OrgConfig object, then one server
// action (applySetup) that writes it through public.apply_org_config().
// The YAML tab shows the exact open-ronin.config.yaml the steps produce, and
// accepts a pasted one, so the file and the wizard stay interchangeable.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { stringify as toYaml } from 'yaml';
import clsx from 'clsx';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Toggle from '@/components/ui/Toggle';
import Callout from '@/components/ui/Callout';
import {
	MODULE_CHOICES,
	MODULE_CHOICE_LABELS,
	enabledAppModules,
	parseOrgConfig,
	type ModuleChoice,
	type OrgConfig,
	type ServiceLine,
} from '@/lib/tenant/config';
import { applySetup } from './actions';

type Source = { kind: 'file'; path: string } | { kind: 'invalid'; path: string; errors: string[] } | { kind: 'blank' };

const STEPS = ['Organization', 'Branding', 'Service lines', 'Team & modules', 'Review'] as const;

const listToText = (xs: string[] | undefined) => (xs ?? []).join(', ');
const textToList = (s: string) =>
	s
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean);

export default function SetupWizard({ initial, source, willClaimAdmin, userEmail }: { initial: OrgConfig; source: Source; willClaimAdmin: boolean; userEmail: string }) {
	const router = useRouter();
	const [cfg, setCfg] = useState<OrgConfig>(initial);
	const [step, setStep] = useState(0);
	const [yamlText, setYamlText] = useState('');
	const [yamlError, setYamlError] = useState<string[] | null>(null);
	const [result, setResult] = useState<{ ok: boolean; error?: string; errors?: string[]; summary?: { service_lines: number; departments: number; modules: Record<string, boolean> } } | null>(null);
	const [pending, start] = useTransition();

	const validation = useMemo(() => parseOrgConfig(cfg), [cfg]);
	const yamlPreview = useMemo(() => toYaml(cfg), [cfg]);
	const modulesPreview = useMemo(() => (validation.ok ? enabledAppModules(validation.config) : {}), [validation]);

	const set = <K extends keyof OrgConfig>(k: K, v: OrgConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
	const setOrg = (patch: Partial<OrgConfig['org']>) => setCfg((c) => ({ ...c, org: { ...c.org, ...patch } }));
	const setTeam = (patch: Partial<OrgConfig['team']>) => setCfg((c) => ({ ...c, team: { ...c.team, ...patch } }));
	const setLine = (i: number, patch: Partial<ServiceLine>) =>
		setCfg((c) => ({ ...c, service_lines: c.service_lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

	function loadYaml() {
		const r = parseOrgConfig(yamlText);
		if (!r.ok) {
			setYamlError(r.errors);
			return;
		}
		setYamlError(null);
		setCfg(r.config);
		setYamlText('');
	}

	function apply() {
		setResult(null);
		start(async () => {
			const r = await applySetup(cfg);
			setResult(r);
			if (r.ok) router.refresh();
		});
	}

	return (
		<div className="space-y-4">
			{source.kind === 'file' && <Callout tone="success">Loaded from {source.path}. Check each step, then apply.</Callout>}
			{source.kind === 'invalid' && (
				<Callout tone="warning">
					Found {source.path} but it has errors, so the wizard starts blank: {source.errors.slice(0, 3).join('; ')}
				</Callout>
			)}
			{willClaimAdmin && <Callout tone="info">No admin exists yet. Applying setup makes you ({userEmail}) the first admin.</Callout>}

			<ol className="flex flex-wrap gap-2" aria-label="Setup steps">
				{STEPS.map((s, i) => (
					<li key={s}>
						<button
							type="button"
							onClick={() => setStep(i)}
							aria-current={i === step ? 'step' : undefined}
							className={clsx(
								'rounded-md border px-3 py-1.5 text-sm',
								i === step
									? 'border-primary-700 bg-primary-700 text-white'
									: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/60',
							)}
						>
							{i + 1}. {s}
						</button>
					</li>
				))}
			</ol>

			<Card>
				{step === 0 && (
					<div className="grid gap-4 sm:grid-cols-2">
						<Input label="Organization name" value={cfg.org.name} onChange={(e) => setOrg({ name: e.target.value })} />
						<Input label="Website domain" placeholder="example.com" value={cfg.org.domain ?? ''} onChange={(e) => setOrg({ domain: e.target.value || null })} />
						<Input
							label="Email domains that can sign in (comma separated)"
							placeholder="example.com"
							value={listToText(cfg.org.allowed_email_domains)}
							onChange={(e) => setOrg({ allowed_email_domains: textToList(e.target.value) })}
						/>
						<Input label="Organization type" placeholder="agency" value={cfg.org.type ?? ''} onChange={(e) => setOrg({ type: e.target.value || null })} />
						<Input label="Time zone" placeholder="America/Chicago" value={cfg.org.timezone} onChange={(e) => setOrg({ timezone: e.target.value })} />
						<Input label="Currency" placeholder="USD" value={cfg.org.currency} onChange={(e) => setOrg({ currency: e.target.value.toUpperCase() })} />
					</div>
				)}

				{step === 1 && (
					<div className="grid gap-4 sm:grid-cols-2">
						<Input
							label="Logo URL (https:// or /path; leave blank to upload later in Admin › Design System)"
							value={cfg.brand.logo ?? ''}
							onChange={(e) => set('brand', { ...cfg.brand, logo: e.target.value || null })}
						/>
						<div className="flex items-end gap-3">
							<Input
								label="Primary colour"
								placeholder="#0F766E"
								value={cfg.brand.primary_color ?? ''}
								onChange={(e) => set('brand', { ...cfg.brand, primary_color: e.target.value || null })}
							/>
							<span
								aria-hidden
								className="h-9 w-9 shrink-0 rounded-md border border-slate-200 dark:border-slate-700"
								style={{ background: /^#[0-9a-fA-F]{6}$/.test(cfg.brand.primary_color ?? '') ? (cfg.brand.primary_color as string) : 'transparent' }}
							/>
						</div>
						<p className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
							Colours, fonts, corners and light/dark tokens are all in Admin › Design System after setup.
						</p>
					</div>
				)}

				{step === 2 && (
					<div className="space-y-3">
						<p className="text-sm text-slate-600 dark:text-slate-300">
							Each service line becomes a work type (a discipline in The Work) with its own deliverables.
						</p>
						{cfg.service_lines.map((l, i) => (
							<div key={i} className="grid gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-[8rem_1fr_2fr_auto_auto] sm:items-end">
								<Input label="Key" value={l.key} onChange={(e) => setLine(i, { key: e.target.value.toLowerCase() })} />
								<Input label="Label" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} />
								<Input label="Deliverables (comma separated)" value={listToText(l.deliverables)} onChange={(e) => setLine(i, { deliverables: textToList(e.target.value) })} />
								<Toggle label="Reports" checked={l.reports} onChange={(v) => setLine(i, { reports: v })} />
								<Button type="button" variant="ghost" size="sm" onClick={() => set('service_lines', cfg.service_lines.filter((_, j) => j !== i))}>
									Remove
								</Button>
							</div>
						))}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => set('service_lines', [...cfg.service_lines, { key: `line_${cfg.service_lines.length + 1}`, label: 'New line', deliverables: [], reports: false }])}
						>
							Add a service line
						</Button>
					</div>
				)}

				{step === 3 && (
					<div className="space-y-5">
						<div className="grid gap-4 sm:grid-cols-2">
							<Input
								label="Departments (comma separated)"
								value={listToText(cfg.team.departments)}
								onChange={(e) => setTeam({ departments: textToList(e.target.value) })}
							/>
							<Input
								label="First admin email"
								value={cfg.team.first_admin?.email ?? ''}
								onChange={(e) => setTeam({ first_admin: { ...(cfg.team.first_admin ?? {}), email: e.target.value || null } })}
							/>
							<Input
								label="First admin name"
								value={cfg.team.first_admin?.name ?? ''}
								onChange={(e) => setTeam({ first_admin: { ...(cfg.team.first_admin ?? {}), name: e.target.value || null } })}
							/>
						</div>
						<div>
							<h2 className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">Modules</h2>
							<div className="grid gap-2 sm:grid-cols-2">
								{MODULE_CHOICES.map((m: ModuleChoice) => (
									<div key={m} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
										<div>
											<p className="text-sm text-slate-800 dark:text-slate-200">{MODULE_CHOICE_LABELS[m].label}</p>
											<p className="text-2xs text-slate-500 dark:text-slate-400">{MODULE_CHOICE_LABELS[m].help}</p>
										</div>
										<Toggle
											label={MODULE_CHOICE_LABELS[m].label}
											hideLabel
											checked={cfg.modules[m] ?? false}
											onChange={(v) => set('modules', { ...cfg.modules, [m]: v })}
										/>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				{step === 4 && (
					<div className="space-y-4">
						{validation.ok ? (
							<Callout tone="success">The config is valid. Applying writes the organization, branding, service lines, departments and module switches.</Callout>
						) : (
							<Callout tone="error">
								<ul className="list-disc pl-4">
									{validation.errors.map((e) => (
										<li key={e}>{e}</li>
									))}
								</ul>
							</Callout>
						)}
						<div>
							<h2 className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">Menus after setup</h2>
							<div className="flex flex-wrap gap-2">
								{Object.entries(modulesPreview).map(([k, on]) => (
									<span
										key={k}
										className={clsx(
											'rounded-md px-2 py-0.5 text-2xs',
											on ? 'bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200' : 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500',
										)}
									>
										{k}
									</span>
								))}
							</div>
						</div>
						<details className="rounded-md border border-slate-200 dark:border-slate-700">
							<summary className="cursor-pointer px-3 py-2 text-sm text-slate-700 dark:text-slate-300">open-ronin.config.yaml (what will be applied)</summary>
							<pre className="max-h-80 overflow-auto px-3 pb-3 text-2xs text-slate-700 dark:text-slate-300">{yamlPreview}</pre>
						</details>
						<details className="rounded-md border border-slate-200 dark:border-slate-700">
							<summary className="cursor-pointer px-3 py-2 text-sm text-slate-700 dark:text-slate-300">Paste a different open-ronin.config.yaml</summary>
							<div className="space-y-2 px-3 pb-3">
								<Textarea rows={8} value={yamlText} onChange={(e) => setYamlText(e.target.value)} placeholder="org:\n  name: Example Agency" />
								{yamlError && <Callout tone="error">{yamlError.join('; ')}</Callout>}
								<Button type="button" variant="secondary" size="sm" onClick={loadYaml} disabled={!yamlText.trim()}>
									Load into the wizard
								</Button>
							</div>
						</details>
						{result && !result.ok && (
							<Callout tone="error">
								{result.error}
								{result.errors?.length ? ` ${result.errors.join('; ')}` : ''}
							</Callout>
						)}
						{result?.ok && (
							<Callout tone="success">
								Setup applied: {result.summary?.service_lines} service lines, {result.summary?.departments} departments.{' '}
								<Link href="/" className="underline">
									Open the app
								</Link>
							</Callout>
						)}
					</div>
				)}
			</Card>

			<div className="flex justify-between">
				<Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
					Back
				</Button>
				{step < STEPS.length - 1 ? (
					<Button type="button" onClick={() => setStep((s) => s + 1)}>
						Next
					</Button>
				) : (
					<Button type="button" onClick={apply} loading={pending} disabled={!validation.ok || pending}>
						Apply setup
					</Button>
				)}
			</div>
		</div>
	);
}
