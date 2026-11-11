'use client';

// Admin › Design system form: edits a draft of the overrides, previews it
// live in two scoped containers (light + dark), lists contrast warnings, and
// saves the whole override object in one action. Reset to defaults clears a
// section (or everything) in the draft; nothing reaches other users until
// Save.

import { useMemo, useState, useTransition } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Check, CheckCircle2, Moon, RotateCcw, Save, Search, Sun } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ColorField from '@/components/ui/ColorField';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Tabs from '@/components/ui/Tabs';
import Toggle from '@/components/ui/Toggle';
import Badge from '@/components/ui/Badge';
import Checkbox from '@/components/ui/Checkbox';
import { useToast } from '@/components/ui/Toast';
import {
	BRAND_KEYS, BUTTON_RADIUS, BUTTON_WEIGHT, DARK_KEYS, DEFAULTS, DEFAULT_IDENTITY, FONTS, LIGHT_KEYS, RADIUS_PRESETS, TOKEN_LABELS,
	contrastChecks, fontHref, identityOf, previewCss, prune, type DesignSettings,
} from '@/lib/design/settings';
import { saveDesignSettings } from './actions';

type Section = 'light' | 'dark' | 'brand' | 'type' | 'identity';

const SECTIONS: { key: Section; label: string }[] = [
	{ key: 'light', label: 'Light colours' },
	{ key: 'dark', label: 'Dark colours' },
	{ key: 'brand', label: 'Brand + status' },
	{ key: 'type', label: 'Type, corners, buttons' },
	{ key: 'identity', label: 'Name + logo' },
];

export default function DesignSystemForm({ initial, canEdit, updatedAt }: { initial: DesignSettings; canEdit: boolean; updatedAt: string | null }) {
	const [saved, setSaved] = useState<DesignSettings>(initial);
	const [draft, setDraft] = useState<DesignSettings>(initial);
	const [section, setSection] = useState<Section>('light');
	const [pending, start] = useTransition();
	const { toast } = useToast();

	const dirty = JSON.stringify(prune(draft)) !== JSON.stringify(prune(saved));
	const checks = useMemo(() => contrastChecks(draft), [draft]);
	const failing = checks.filter((c) => !c.ok);
	const css = useMemo(() => previewCss(draft), [draft]);
	const font = fontHref(draft.font?.sans);
	const id = identityOf(draft);

	const setToken = (group: 'light' | 'dark' | 'brand', key: string, value: string | null) =>
		setDraft((d) => prune({ ...d, [group]: { ...(d[group] ?? {}), [key]: value ?? undefined } }));
	const setPart = <K extends keyof DesignSettings>(key: K, value: DesignSettings[K]) => setDraft((d) => prune({ ...d, [key]: value }));

	const save = () => start(async () => {
		const res = await saveDesignSettings(prune(draft));
		if (!res.ok) { toast({ message: res.error, variant: 'error' }); return; }
		setSaved(res.settings);
		setDraft(res.settings);
		toast({ message: 'Design system saved. Reload any open tab to see it.', variant: 'success' });
	});
	const resetSection = () => {
		if (section === 'type') setDraft((d) => prune({ ...d, font: undefined, radius: undefined, button: undefined }));
		else setDraft((d) => prune({ ...d, [section]: undefined }));
	};

	return (
		<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<style dangerouslySetInnerHTML={{ __html: css }} />
			{font && (
				<link rel="stylesheet" href={font} />
			)}

			<div className="space-y-4">
				<Card padding="none">
					<Tabs items={SECTIONS} value={section} onChange={setSection} label="Design system sections" className="px-3" />
					<div className="space-y-3 p-4">
						{section === 'light' && LIGHT_KEYS.map((k) => (
							<ColorField key={k} id={`light-${k}`} label={TOKEN_LABELS[k].label} help={TOKEN_LABELS[k].help}
								value={draft.light?.[k]} defaultValue={DEFAULTS.light[k]} disabled={!canEdit} onChange={(v) => setToken('light', k, v)} />
						))}
						{section === 'light' && <p className="text-2xs text-slate-600 dark:text-slate-400">Cards stay white in light mode (every card in the app is painted white). The dark card surface is editable under Dark colours.</p>}
						{section === 'dark' && DARK_KEYS.map((k) => (
							<ColorField key={k} id={`dark-${k}`} label={TOKEN_LABELS[k].label} help={TOKEN_LABELS[k].help}
								value={draft.dark?.[k]} defaultValue={DEFAULTS.dark[k]} disabled={!canEdit} onChange={(v) => setToken('dark', k, v)} />
						))}
						{section === 'brand' && BRAND_KEYS.map((k) => (
							<ColorField key={k} id={`brand-${k}`} label={TOKEN_LABELS[k].label} help={TOKEN_LABELS[k].help}
								value={draft.brand?.[k]} defaultValue={DEFAULTS.brand[k]} disabled={!canEdit} onChange={(v) => setToken('brand', k, v)} />
						))}
						{section === 'type' && (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Select label="Font" value={draft.font?.sans ?? 'inter'} disabled={!canEdit}
									onChange={(e) => setPart('font', e.target.value === 'inter' ? undefined : { sans: e.target.value })}>
									{Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
								</Select>
								<Select label="Corners" value={draft.radius ?? 'md'} disabled={!canEdit}
									onChange={(e) => setPart('radius', e.target.value === 'md' ? undefined : e.target.value)}>
									{Object.entries(RADIUS_PRESETS).map(([k, r]) => <option key={k} value={k}>{r.label} ({r.md})</option>)}
								</Select>
								<Select label="Button shape" value={draft.button?.radius ?? 'match'} disabled={!canEdit}
									onChange={(e) => setPart('button', { ...(draft.button ?? {}), radius: e.target.value === 'match' ? undefined : e.target.value })}>
									{Object.entries(BUTTON_RADIUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
								</Select>
								<Select label="Button weight" value={draft.button?.weight ?? 'medium'} disabled={!canEdit}
									onChange={(e) => setPart('button', { ...(draft.button ?? {}), weight: e.target.value === 'medium' ? undefined : e.target.value })}>
									{Object.entries(BUTTON_WEIGHT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
								</Select>
								<div className="sm:col-span-2">
									<Toggle label="Bordered buttons (style guide decision 12: on)" checked={draft.button?.border !== false} disabled={!canEdit}
										onChange={(on) => setPart('button', { ...(draft.button ?? {}), border: on ? undefined : false })} />
								</div>
								<p className="text-2xs text-slate-600 dark:text-slate-400 sm:col-span-2">Type scale and gradients are not configurable on purpose: they are part of the layout, not the brand.</p>
							</div>
						)}
						{section === 'identity' && (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Input label="App name (wordmark, browser tab)" value={draft.identity?.app_name ?? ''} placeholder={DEFAULT_IDENTITY.appName} disabled={!canEdit}
									onChange={(e) => setPart('identity', { ...(draft.identity ?? {}), app_name: e.target.value || undefined })} />
								<Input label="Organisation name (logo alt text)" value={draft.identity?.org_name ?? ''} placeholder={DEFAULT_IDENTITY.orgName} disabled={!canEdit}
									onChange={(e) => setPart('identity', { ...(draft.identity ?? {}), org_name: e.target.value || undefined })} />
								<Input label="Logo for light mode (https:// or /path)" value={draft.identity?.logo_light_url ?? ''} placeholder={DEFAULT_IDENTITY.logoLight} disabled={!canEdit}
									onChange={(e) => setPart('identity', { ...(draft.identity ?? {}), logo_light_url: e.target.value || undefined })} />
								<Input label="Logo for dark mode (https:// or /path)" value={draft.identity?.logo_dark_url ?? ''} placeholder={DEFAULT_IDENTITY.logoDark} disabled={!canEdit}
									onChange={(e) => setPart('identity', { ...(draft.identity ?? {}), logo_dark_url: e.target.value || undefined })} />
								<p className="text-2xs text-slate-600 dark:text-slate-400 sm:col-span-2">Upload logo files on Admin › Brand and paste their public URL here. Content Studio and email keep reading Admin › Brand.</p>
							</div>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
						<Button onClick={save} loading={pending} disabled={!canEdit || !dirty}><Save className="h-4 w-4" aria-hidden="true" />Save</Button>
						<Button variant="outline" onClick={() => setDraft(saved)} disabled={!dirty || pending}>Discard changes</Button>
						<Button variant="ghost" onClick={resetSection} disabled={!canEdit || pending}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset this tab to defaults</Button>
						<Button variant="ghost" onClick={() => setDraft({})} disabled={!canEdit || pending} className="text-red-700 dark:text-red-400">Reset everything</Button>
						<span className="ml-auto text-2xs text-slate-600 dark:text-slate-400">
							{dirty ? 'Unsaved changes' : updatedAt ? `Saved ${new Date(updatedAt).toLocaleString()}` : 'Using defaults'}
						</span>
					</div>
				</Card>

				<Card padding="none">
					<div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
						{failing.length ? <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />}
						<h2 className="text-sm font-semibold">Contrast check (WCAG)</h2>
						<span className="text-2xs text-slate-600 dark:text-slate-400">{failing.length ? `${failing.length} pair${failing.length === 1 ? '' : 's'} below the floor` : 'Every pair passes'}</span>
					</div>
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{checks.map((c) => (
							<li key={c.id} className="flex items-center gap-3 px-4 py-2 text-13">
								<span className="flex h-6 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 text-xs font-semibold dark:border-slate-700" style={{ background: c.bg, color: c.fg }}>Aa</span>
								<span className="w-10 shrink-0 text-2xs uppercase text-slate-500 dark:text-slate-400">{c.mode}</span>
								<span className="min-w-0 flex-1">
									{c.label}
									{c.note && !c.ok && <span className="block text-2xs text-slate-600 dark:text-slate-400">{c.note}</span>}
								</span>
								<span className={clsx('shrink-0 tabular-nums font-semibold', c.ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400')}>{c.ratio.toFixed(2)}:1</span>
								<span className="w-12 shrink-0 text-right text-2xs text-slate-500 dark:text-slate-400">min {c.min}</span>
							</li>
						))}
					</ul>
				</Card>
			</div>

			<div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
				<PreviewPane mode="light" appName={id.appName} logo={id.logoLight} orgName={id.orgName} />
				<PreviewPane mode="dark" appName={id.appName} logo={id.logoDark} orgName={id.orgName} />
			</div>
		</div>
	);
}

function PreviewPane({ mode, appName, logo, orgName }: { mode: 'light' | 'dark'; appName: string; logo: string; orgName: string }) {
	const [on, setOn] = useState(true);
	const [tab, setTab] = useState<'all' | 'mine'>('all');
	return (
		<section aria-label={`${mode} preview`} className={clsx('overflow-hidden rounded-lg border border-slate-300', mode === 'light' ? 'ds-preview-light' : 'ds-preview-dark dark')}>
			<div className="flex h-11 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-800">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={logo} alt={orgName} className="h-6 w-6 rounded-full" />
				<span className="h-2.5 w-2.5 rounded-md bg-accent-600" aria-hidden="true" />
				<span className="text-sm font-bold tracking-tight">{appName}</span>
				<span className="ml-3 rounded-md bg-primary-50 px-2 py-1 text-13 font-medium text-primary-800 dark:bg-primary-950 dark:text-primary-300">Work</span>
				<span className="px-2 py-1 text-13 text-slate-600 dark:text-slate-400">Clients</span>
				<span className="ml-auto inline-flex items-center gap-1 text-2xs text-slate-500 dark:text-slate-400">{mode === 'light' ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}{mode}</span>
			</div>
			<div className="space-y-3 p-4">
				<div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
					<h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Launch the spring campaign</h3>
					<p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">Secondary text: due Friday, owned by Chris. <a href="#preview" onClick={(e) => e.preventDefault()} className="text-primary-700 underline dark:text-primary-300">A link in copy</a>.</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Button size="sm">Primary</Button>
						<Button size="sm" variant="secondary">Secondary</Button>
						<Button size="sm" variant="outline">Outline</Button>
						<Button size="sm" variant="ghost">Ghost</Button>
						<Button size="sm" variant="danger">Delete</Button>
					</div>
					<div className="mt-3 grid grid-cols-2 gap-2">
						<Input aria-label="Preview input" placeholder="Search work" />
						<Select aria-label="Preview select" size="md" defaultValue="a"><option value="a">In progress</option><option value="b">Done</option></Select>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Badge>Backlog</Badge><Badge color="primary">In progress</Badge><Badge color="warning">In review</Badge><Badge color="success">Done</Badge><Badge color="danger">Blocked</Badge><Badge color="accent">Brand</Badge>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
						<span className="rounded-md bg-green-600 px-2 py-1 text-slate-900">Success fill</span>
						<span className="rounded-md bg-amber-600 px-2 py-1 text-slate-900">Warning fill</span>
						<span className="rounded-md bg-red-600 px-2 py-1 text-white">Danger fill</span>
						<Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
					</div>
				</div>
				<div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
					<div className="flex gap-1 border-b border-slate-200 px-2 dark:border-slate-700" role="tablist" aria-label="Preview tabs">
						{(['all', 'mine'] as const).map((t) => (
							<button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
								className={clsx('-mb-px border-b-2 px-3 py-2 text-13', tab === t ? 'border-primary-600 font-semibold text-primary-800 dark:text-primary-300' : 'border-transparent text-slate-600 dark:text-slate-400')}>
								{t === 'all' ? 'All tasks' : 'Mine'}
							</button>
						))}
					</div>
					<table className="w-full text-13">
						<tbody>
							<tr className="border-b border-slate-200 hover:bg-hover dark:border-slate-700"><td className="w-8 px-2 py-2"><Checkbox aria-label="Row 1" /></td><td className="py-2">A row (hover me)</td><td className="px-2 text-slate-600 dark:text-slate-400">Today</td></tr>
							<tr className="border-b border-slate-200 bg-selected dark:border-slate-700"><td className="w-8 px-2 py-2"><Checkbox aria-label="Row 2" defaultChecked /></td><td className="py-2">A selected row <Check className="inline h-3.5 w-3.5 text-primary-600" aria-hidden="true" /></td><td className="px-2 text-red-600 dark:text-red-400">Overdue</td></tr>
							<tr><td className="w-8 px-2 py-2"><Checkbox aria-label="Row 3" /></td><td className="py-2 text-slate-600 dark:text-slate-400">Secondary row</td><td className="px-2"><Toggle label="Preview toggle" hideLabel checked={on} onChange={setOn} /></td></tr>
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}
