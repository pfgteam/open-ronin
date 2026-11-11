'use client';

// Program builder: contract line, package, fees as separate fields,
// kickoff / first-set-live (billing start), SOP-minimum intake, access,
// SME, the client's auto-approve toggles.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { PROGRAM_STATUSES, PROGRAM_STATUS_LABELS, type PackageTemplateRow, type ProgramRow } from '@/lib/flywheel/shared';
import { saveProgram } from './actions';

export interface ContractOption {
	id: string;
	client_id: string;
	client_name: string;
	package: string;
	per_month_cents: number | null;
	starts_on: string | null;
	status: string;
	has_program: boolean;
}

export default function ProgramForm({ program, packages, contracts, clients }: { program: ProgramRow | null; packages: PackageTemplateRow[]; contracts: ContractOption[]; clients: { id: string; name: string }[] }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [err, setErr] = useState<string | null>(null);
	const [clientId, setClientId] = useState(program?.client_id ?? '');
	const [contractId, setContractId] = useState(program?.contract_id ?? '');
	const [pkg, setPkg] = useState(program?.package_key ?? 'flywheel');
	const tpl = packages.find((p) => p.key === pkg);
	const myContracts = contracts.filter((c) => !clientId || c.client_id === clientId);

	return (
		<form
			action={(fd) =>
				start(async () => {
					setErr(null);
					const r = await saveProgram(fd);
					if (!r.ok) return setErr(r.error);
					router.push(`/flywheel/${r.id}`);
					router.refresh();
				})
			}
			className="space-y-4"
		>
			{program && <input type="hidden" name="id" value={program.id} />}
			{err && <Callout tone="error">{err}</Callout>}

			<section className="grid gap-3 md:grid-cols-2">
				<Select label="Client" name="client_id" value={clientId} onChange={(e) => { setClientId(e.target.value); setContractId(''); }} required>
					<option value="">Pick a client</option>
					{clients.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>
				<Select label="Contract line" name="contract_id" value={contractId} onChange={(e) => { setContractId(e.target.value); const c = contracts.find((x) => x.id === e.target.value); if (c && !clientId) setClientId(c.client_id); }}>
					<option value="">No contract link (pilot / pre-contract)</option>
					{myContracts.map((c) => (
						<option key={c.id} value={c.id} disabled={c.has_program && c.id !== program?.contract_id}>
							{c.client_name} · {c.package} · ${((c.per_month_cents ?? 0) / 100).toLocaleString()}/mo · {c.status}{c.has_program ? ' (has program)' : ''}
						</option>
					))}
				</Select>
				<Select label="Package" name="package_key" value={pkg} onChange={(e) => setPkg(e.target.value)}>
					{packages.filter((p) => p.is_active).map((p) => (
						<option key={p.key} value={p.key}>
							{p.label}
						</option>
					))}
				</Select>
				<Input label="Tab label (optional)" name="label" defaultValue={program?.label ?? ''} placeholder={tpl?.label ?? ''} />
				<Select label="Status" name="status" defaultValue={program?.status ?? 'onboarding'}>
					{PROGRAM_STATUSES.map((s) => (
						<option key={s} value={s}>
							{PROGRAM_STATUS_LABELS[s]}
						</option>
					))}
				</Select>
				<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mt-6">
					<Checkbox name="is_internal_pilot" defaultChecked={program?.is_internal_pilot ?? false} /> Internal pilot (Northwind)
				</label>
			</section>

			<section>
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Commercials</h3>
				<p className="text-xs text-slate-500 mb-2">Setup and monthly are separate fields; the monthly fee starts billing on the first-set-live date (writes contracts.billing_starts_on).</p>
				<div className="grid gap-3 md:grid-cols-5">
					<Input label="Setup fee (USD)" name="setup_fee_usd" type="number" min={0} step={1} defaultValue={program?.setup_fee_cents != null ? program.setup_fee_cents / 100 : tpl?.setup_fee_cents != null ? tpl.setup_fee_cents / 100 : ''} />
					<Input label="Monthly fee (USD)" name="monthly_fee_usd" type="number" min={0} step={1} defaultValue={program?.monthly_fee_cents != null ? program.monthly_fee_cents / 100 : tpl?.monthly_fee_cents != null ? tpl.monthly_fee_cents / 100 : ''} />
					<Input label="Setup paid on" name="setup_paid_on" type="date" defaultValue={program?.setup_paid_on ?? ''} />
					<Input label="Kickoff" name="kickoff_on" type="date" defaultValue={program?.kickoff_on ?? ''} />
					<Input label="First set live (billing starts)" name="first_set_live_on" type="date" defaultValue={program?.first_set_live_on ?? ''} />
				</div>
			</section>

			<section>
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Intake (SOP minimum)</h3>
				<div className="grid gap-3 md:grid-cols-2">
					<Input label="Brand name" name="brand_name" defaultValue={program?.brand_name ?? ''} />
					<Input label="Primary URL" name="primary_url" defaultValue={program?.primary_url ?? ''} placeholder="https://" />
					<Textarea label="3 named competitors (one per line)" name="competitors" rows={3} defaultValue={(program?.competitors ?? []).join('\n')} />
					<Textarea label="Top 5 keywords (one per line)" name="keywords" rows={3} defaultValue={(program?.keywords ?? []).join('\n')} />
				</div>
				<div className="mt-3">
					<Textarea label="Ideal customer (in the client's own words)" name="icp_md" rows={3} defaultValue={program?.icp_md ?? ''} />
				</div>
				<div className="grid gap-3 md:grid-cols-4 mt-3">
					<Input label="SME (on camera)" name="sme_name" defaultValue={program?.sme_name ?? ''} />
					<Input label="SME email" name="sme_email" type="email" defaultValue={program?.sme_email ?? ''} />
					<Input label="SME phone" name="sme_phone" defaultValue={program?.sme_phone ?? ''} />
					<Input label="Developer contact" name="dev_contact" defaultValue={program?.dev_contact ?? ''} />
				</div>
			</section>

			<section>
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Access confirmed</h3>
				<p className="text-xs text-slate-500 mb-2">Never passwords. The client invites the Open Ronin Google account or connects through the portal (F5).</p>
				<div className="flex flex-wrap gap-4 text-sm text-slate-700 dark:text-slate-300">
					<label className="flex items-center gap-2"><Checkbox name="access_gbp" defaultChecked={!!program?.access?.gbp} /> Google Business Profile</label>
					<label className="flex items-center gap-2"><Checkbox name="access_search_console" defaultChecked={!!program?.access?.search_console} /> Search Console</label>
					<label className="flex items-center gap-2"><Checkbox name="access_analytics" defaultChecked={!!program?.access?.analytics} /> Analytics</label>
					<label className="flex items-center gap-2"><Checkbox name="access_site_backend" defaultChecked={!!program?.access?.site_backend} /> Site backend / dev contact</label>
				</div>
				<div className="mt-2">
					<Input label="Access notes" name="access_notes" defaultValue={program?.access?.notes ?? ''} />
				</div>
				<div className="grid gap-3 md:grid-cols-2 mt-3">
					<Input label="Drive client hub URL" name="drive_hub_url" defaultValue={program?.drive_hub_url ?? ''} />
					<Input label="Legacy tracker sheet URL" name="tracker_sheet_url" defaultValue={program?.tracker_sheet_url ?? ''} />
				</div>
			</section>

			<section>
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Client auto-approve (silent approval)</h3>
				<p className="text-xs text-slate-500 mb-2">The client flips these in their portal too. When on, a plan / page sent for approval is approved automatically after N business days with no reply.</p>
				<div className="grid gap-3 md:grid-cols-4">
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mt-6"><Checkbox name="auto_plans" defaultChecked={program?.auto_approve?.plans?.enabled ?? false} /> Plans</label>
					<Input label="Plan days" name="auto_plans_days" type="number" min={1} max={15} defaultValue={program?.auto_approve?.plans?.business_days ?? 3} />
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mt-6"><Checkbox name="auto_content" defaultChecked={program?.auto_approve?.content?.enabled ?? false} /> Content</label>
					<Input label="Content days" name="auto_content_days" type="number" min={1} max={15} defaultValue={program?.auto_approve?.content?.business_days ?? 2} />
				</div>
			</section>

			<section>
				<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Prompt library blocks (this client)</h3>
				<p className="text-xs text-slate-500 mb-2">Prepended to every agent run for this program, ahead of the base article prompt and the channel variant. Voice = who is writing and how (MINT: a woman in her 40s, first person; Northwind: direct, no fluff). Brand facts = products, warranty, URLs, host / entity names, exact spelling. The shared rules (answer-first, question H2s, FAQ, no fabricated facts, banned phrases) live in Admin → Flywheel.</p>
				<div className="space-y-3">
					<Textarea label="Voice / persona block" name="voice_md" rows={6} defaultValue={program?.voice_md ?? ''} placeholder="VOICE: …" />
					<Textarea label="Brand facts block" name="brand_facts_md" rows={8} defaultValue={program?.brand_facts_md ?? ''} placeholder="BRAND FACTS: products, warranty, URLs, exact entity spelling…" />
					<Input label="CTA block (how every article ends)" name="cta_md" defaultValue={program?.cta_md ?? ''} />
				</div>
			</section>

			<Textarea label="Internal notes (never shown to the client)" name="notes_md" rows={3} defaultValue={program?.notes_md ?? ''} />

			<div className="flex gap-2">
				<Button type="submit" loading={pending}>
					{program ? 'Save program' : 'Create program'}
				</Button>
			</div>
		</form>
	);
}
