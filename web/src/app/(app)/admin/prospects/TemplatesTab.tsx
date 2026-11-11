'use client';

// Not rendered (spec 2026-10-19 §6): contract templates are hidden while
// contracts are signed in GHL. Kept, unused, for when P6 e-sign is turned on.

// Admin -> Prospects -> Templates (0126): contract templates per org with
// {{placeholders}}: brand_name, signer_name, signer_title, start_date,
// term_months, line_items, mrr_total, one_time_line, deposit_line, terms.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { formatRelative } from '@/lib/format';
import type { TemplateRow } from '@/lib/revenue/server';
import { saveContractTemplate } from '@/app/(app)/prospects/closingActions';

export default function TemplatesTab({ templates, canManage }: { templates: TemplateRow[]; canManage: boolean }) {
	const router = useRouter();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [showNew, setShowNew] = useState(false);
	const [pending, start] = useTransition();
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await saveContractTemplate(fd);
			setMsg(r.ok ? { ok: true, text: 'Template saved (new version).' } : { ok: false, text: r.error });
			if (r.ok) setShowNew(false);
			router.refresh();
		});
	const Form = ({ t }: { t: TemplateRow | null }) => (
		<form className="grid sm:grid-cols-4 gap-3" action={submit}>
			{t && <input type="hidden" name="id" value={t.id} />}
			<Input name="key" label="Key" defaultValue={t?.key ?? ''} pattern="[a-z][a-z0-9_]{1,40}" required readOnly={!!t} disabled={!canManage} />
			<Input name="label" label="Label" defaultValue={t?.label ?? ''} required disabled={!canManage} />
			<Select name="org" label="Org" defaultValue={t?.org ?? 'main'} disabled={!canManage}>
				<option value="main">Open Ronin</option>
				<option value="premium">Premium</option>
				<option value="beacon">Beacon</option>
			</Select>
			<Input name="default_term_months" label="Default term (months)" type="number" min={1} defaultValue={t?.default_term_months ?? ''} disabled={!canManage} />
			<Textarea name="body_md" label="Body (markdown with {{brand_name}} {{signer_name}} {{signer_title}} {{start_date}} {{term_months}} {{line_items}} {{mrr_total}} {{one_time_line}} {{deposit_line}} {{terms}})" defaultValue={t?.body_md ?? ''} rows={18} className="sm:col-span-4 font-mono text-xs" disabled={!canManage} required />
			<Textarea name="terms_md" label="Standard terms (inserted at {{terms}})" defaultValue={t?.terms_md ?? ''} rows={3} className="sm:col-span-4" disabled={!canManage} />
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
				<Checkbox name="is_active" defaultChecked={t?.is_active ?? true} disabled={!canManage} /> Active
			</label>
			{canManage && (
				<div className="sm:col-span-4">
					<Button type="submit" size="sm" loading={pending}>
						Save
					</Button>
				</div>
			)}
		</form>
	);
	return (
		<div className="space-y-4">
			<Callout tone="info">Contracts are built from the product catalog and rendered through one of these at creation (spec §9). The e-sign provider is picked by env key (DocuSeal default, Documenso / OpenSign stubs); without a key the contract is marked signed by hand and GHL contracts keep running.</Callout>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{templates.map((t) => (
				<Card key={t.id} className="space-y-3">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.label}</h2>
						<Badge>{t.org}</Badge>
						<Badge color={t.is_active ? 'success' : 'warning'}>{t.is_active ? 'active' : 'inactive'}</Badge>
						<span className="text-2xs text-slate-500">v{t.version} · {formatRelative(t.updated_at)}</span>
					</div>
					<Form t={t} />
				</Card>
			))}
			{canManage && (
				<Card>
					<Button size="sm" variant={showNew ? 'ghost' : 'outline'} onClick={() => setShowNew(!showNew)}>
						{showNew ? 'Close' : '+ New template'}
					</Button>
					{showNew && (
						<div className="mt-3">
							<Form t={null} />
						</div>
					)}
				</Card>
			)}
		</div>
	);
}
