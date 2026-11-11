'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { POSTER_KINDS, POSTER_KIND_LABELS, type ChannelRow, type PackageTemplateRow } from '@/lib/flywheel/shared';
import ActionForm from '@/app/(app)/flywheel/ActionForm';
import { saveChannel, savePackageTemplate, saveSetting } from '@/app/(app)/flywheel/actions';

export function PackagesTab({ packages, canManage }: { packages: PackageTemplateRow[]; canManage: boolean }) {
	const [editing, setEditing] = useState<string | null>(null);
	const current = packages.find((p) => p.key === editing) ?? null;
	return (
		<div className="space-y-4">
			<Card>
				<ul className="divide-y divide-slate-200 dark:divide-slate-700">
					{packages.map((p) => (
						<li key={p.key} className="py-2 flex items-start justify-between gap-3 text-sm">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-medium text-slate-900 dark:text-slate-100">{p.label}</span>
									<code className="text-2xs text-slate-500">{p.key}</code>
									{!p.is_active && <Badge>inactive</Badge>}
									{p.uses_media_opps && <Badge color="primary">media-opps board</Badge>}
								</div>
								<p className="text-xs text-slate-600 dark:text-slate-400">{p.description}</p>
								<p className="text-2xs text-slate-500">
									setup {p.setup_fee_cents != null ? `$${p.setup_fee_cents / 100}` : '—'} · monthly {p.monthly_fee_cents != null ? `$${p.monthly_fee_cents / 100}` : '—'} · deliverables: {p.deliverable_kinds.join(', ') || '—'}
								</p>
							</div>
							{canManage && (
								<Button type="button" size="sm" variant="ghost" onClick={() => setEditing(editing === p.key ? null : p.key)}>
									{editing === p.key ? 'Close' : 'Edit'}
								</Button>
							)}
						</li>
					))}
				</ul>
			</Card>
			{canManage && (
				<Card>
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{current ? `Edit ${current.label}` : 'New package template'}</h2>
					<ActionForm key={current?.key ?? 'new'} action={savePackageTemplate} success="Package saved." className="grid gap-3 md:grid-cols-4" onDone={() => setEditing(null)}>
						<Input label="Key" name="key" defaultValue={current?.key ?? ''} readOnly={!!current} required pattern="[a-z][a-z0-9_]{1,40}" />
						<Input label="Label" name="label" defaultValue={current?.label ?? ''} required />
						<Input label="Setup fee (USD)" name="setup_fee_usd" type="number" defaultValue={current?.setup_fee_cents != null ? current.setup_fee_cents / 100 : ''} />
						<Input label="Monthly fee (USD)" name="monthly_fee_usd" type="number" defaultValue={current?.monthly_fee_cents != null ? current.monthly_fee_cents / 100 : ''} />
						<div className="md:col-span-4">
							<Input label="Description" name="description" defaultValue={current?.description ?? ''} />
						</div>
						<div className="md:col-span-2">
							<Textarea label="Scope of record (JSON)" name="scope_json" rows={10} defaultValue={JSON.stringify(current?.scope ?? {}, null, 2)} className="font-mono text-xs" />
						</div>
						<div className="md:col-span-2">
							<Textarea label="SLA (JSON)" name="sla_json" rows={10} defaultValue={JSON.stringify(current?.sla ?? {}, null, 2)} className="font-mono text-xs" />
						</div>
						<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
							<Checkbox name="is_active" defaultChecked={current?.is_active ?? true} /> Active
						</label>
						<div className="md:col-span-4">
							<Button type="submit" size="sm">
								Save
							</Button>
						</div>
					</ActionForm>
				</Card>
			)}
		</div>
	);
}

export function ChannelsTab({ channels, canManage }: { channels: ChannelRow[]; canManage: boolean }) {
	return (
		<Card>
			<p className="text-xs text-slate-500 mb-3">Per on-site page: 20–25 citation surfaces across these channels; the podcast is one per cluster. Reddit and Quora stay non-promotional (SOP Step 7/8).</p>
			<div className="space-y-2">
				{channels.map((c) => (
					<ActionForm key={c.key} action={saveChannel} success="Channel saved." className="grid gap-2 md:grid-cols-[120px_1fr_70px_70px_70px_140px_auto_auto_auto] items-end border-b border-slate-200 dark:border-slate-700 pb-2">
						<input type="hidden" name="key" value={c.key} />
						<code className="text-2xs text-slate-500 pb-2">{c.key}</code>
						<Input label="Label" name="label" defaultValue={c.label} readOnly={!canManage} />
						<Input label="Min/pg" name="per_page_min" type="number" min={0} max={50} defaultValue={c.per_page_min} readOnly={!canManage} />
						<Input label="Max/pg" name="per_page_max" type="number" min={0} max={50} defaultValue={c.per_page_max} readOnly={!canManage} />
						<Input label="Per cluster" name="per_cluster" type="number" min={0} max={20} defaultValue={c.per_cluster} readOnly={!canManage} />
						<Select label="Default poster" name="poster_default" size="sm" defaultValue={c.poster_default} disabled={!canManage}>
							{POSTER_KINDS.map((k) => (
								<option key={k} value={k}>
									{POSTER_KIND_LABELS[k]}
								</option>
							))}
						</Select>
						<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 pb-2">
							<Checkbox name="non_promotional" defaultChecked={c.non_promotional} disabled={!canManage} /> non-promo
						</label>
						<label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 pb-2">
							<Checkbox name="is_active" defaultChecked={c.is_active} disabled={!canManage} /> active
						</label>
						{canManage ? (
							<Button type="submit" size="sm" variant="outline">
								Save
							</Button>
						) : (
							<span />
						)}
						<div className="md:col-span-9">
							<Input label="Why it works for AI" name="why" defaultValue={c.why ?? ''} readOnly={!canManage} />
						</div>
					</ActionForm>
				))}
			</div>
		</Card>
	);
}

export function SettingsTab({ settingKey, title, value, canManage, hint }: { settingKey: string; title: string; value: unknown; canManage: boolean; hint?: string }) {
	return (
		<Card>
			<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">{title}</h2>
			{hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
			<ActionForm action={saveSetting} success="Saved.">
				<input type="hidden" name="key" value={settingKey} />
				<Textarea name="value_json" rows={Math.min(24, Math.max(4, JSON.stringify(value ?? {}, null, 2).split('\n').length))} defaultValue={JSON.stringify(value ?? {}, null, 2)} readOnly={!canManage} className="font-mono text-xs" />
				{canManage && (
					<Button type="submit" size="sm" className="mt-2">
						Save
					</Button>
				)}
			</ActionForm>
		</Card>
	);
}
