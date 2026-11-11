'use client';

// Offer + hire panel on the application page (0133): build the offer (comp
// from the ladder, start, manager, templates), Alex approves, send the
// offer letter + NDA through the signature provider (or mark signed by
// hand), convert to hire (invite + profile + PAP comp + provisioning), and
// the provisioning checklist.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { DocumentTemplateRow, HireDocumentRow, HiringConfig, OfferRow, ProvisioningRow, StaffOption } from '@/lib/hiring/server';
import { DOC_STATUS_COLORS, OFFER_STATUS_COLORS, PROVISIONING_OWNER_LABELS, PROVISIONING_STATUSES, REGIONS, REGION_LABELS, WORK_MODES, defaultTemplates } from '@/lib/hiring/offers';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, payTarget, usd } from '@/lib/hiring/shared';
import { formatDate, formatRelative } from '@/lib/format';
import { convertToHire, markDocument, saveOffer, sendOffer, setOfferStatus, updateProvisioning } from '../../../../actions';

type Msg = { ok: boolean; text: string } | null;

export default function OfferPanel({ applicationId, positionId, candidateId, candidateEmail, offer, documents, provisioning, templates, people, config, isOwner, canEdit, canSeeComp, defaultManagerId, defaultLevel, defaultMultiplier, providerLabel, providerReady }: { applicationId: string; positionId: string; candidateId: string; candidateEmail: string; offer: OfferRow | null; documents: HireDocumentRow[]; provisioning: ProvisioningRow[]; templates: DocumentTemplateRow[]; people: StaffOption[]; config: HiringConfig; isOwner: boolean; canEdit: boolean; canSeeComp: boolean; defaultManagerId: string | null; defaultLevel: string | null; defaultMultiplier: number | null; providerLabel: string; providerReady: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<Msg>(null);
	const [edit, setEdit] = useState(!offer);
	const [emp, setEmp] = useState(offer?.employment_type ?? 'full_time');
	const [region, setRegion] = useState<'us' | 'os'>(offer?.region ?? 'us');
	const [level, setLevel] = useState(offer?.pay_level ?? defaultLevel ?? 'specialist');
	const [mult, setMult] = useState(String(offer?.pay_multiplier ?? defaultMultiplier ?? 7));
	const [step, setStep] = useState(String(offer?.step ?? 1));
	const figures = useMemo(() => payTarget(Number(mult), level, Number(step), config.levels, config.progression), [mult, level, step, config]);
	const defaults = defaultTemplates(emp, region);
	const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? '—';
	const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
		start(async () => {
			setMsg(null);
			const r = await fn();
			setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error: string }).error });
			router.refresh();
		});
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await saveOffer(fd);
			setMsg(r.ok ? { ok: true, text: offer ? 'Offer updated (approval reset if comp changed).' : 'Offer drafted. Alex gets a bell to approve.' } : { ok: false, text: r.error });
			if (r.ok) setEdit(false);
			router.refresh();
		});

	if (!canSeeComp) return <Card className="text-sm text-slate-500">Offers carry salary; visible to execs and this role&apos;s hiring manager.</Card>;

	return (
		<Card className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Offer & hire</h2>
				{offer && <Badge color={OFFER_STATUS_COLORS[offer.status]}>{offer.status}</Badge>}
				{offer?.hired_profile_id && <Badge color="success">profile linked</Badge>}
				{offer && canEdit && ['draft', 'approved'].includes(offer.status) && (
					<Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit(!edit)}>
						{edit ? 'Close' : 'Edit'}
					</Button>
				)}
			</div>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}

			{(edit || !offer) && canEdit && (
				<form action={submit} className="grid sm:grid-cols-4 gap-2">
					{offer && <input type="hidden" name="id" value={offer.id} />}
					<input type="hidden" name="application_id" value={applicationId} />
					<input type="hidden" name="position_id" value={positionId} />
					<input type="hidden" name="candidate_id" value={candidateId} />
					<Select name="employment_type" label="Employment" value={emp} onChange={(e) => setEmp(e.target.value as typeof emp)}>
						{EMPLOYMENT_TYPES.map((t) => (
							<option key={t} value={t}>
								{EMPLOYMENT_TYPE_LABELS[t]}
							</option>
						))}
					</Select>
					<Select name="region" label="Region" value={region} onChange={(e) => setRegion(e.target.value as 'us' | 'os')}>
						{REGIONS.map((r) => (
							<option key={r} value={r}>
								{REGION_LABELS[r]}
							</option>
						))}
					</Select>
					<Select name="work_mode" label="Work mode" defaultValue={offer?.work_mode ?? 'remote'}>
						{WORK_MODES.map((w) => (
							<option key={w} value={w}>
								{w.replace('_', ' ')}
							</option>
						))}
					</Select>
					<Input name="hours_per_week" label="Hours / week" type="number" min={1} max={80} defaultValue={offer?.hours_per_week ?? 40} />
					<Input name="start_on" label="Start date" type="date" defaultValue={offer?.start_on ?? ''} />
					<Select name="manager_id" label="Reports to" defaultValue={offer?.manager_id ?? defaultManagerId ?? ''}>
						<option value="">—</option>
						{people.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</Select>
					<Select name="pay_level" label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
						{config.levels.filter((l) => l.is_active).map((l) => (
							<option key={l.slug} value={l.slug}>
								{l.label}
							</option>
						))}
					</Select>
					<Input name="pay_multiplier" label="Multiplier" type="number" step="0.5" min={1} max={100} value={mult} onChange={(e) => setMult(e.target.value)} />
					<Select name="step" label="Step (new hires start at 1)" value={step} onChange={(e) => setStep(e.target.value)}>
						{[1, 2, 3].map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</Select>
					<div className="sm:col-span-3 grid grid-cols-4 gap-2 text-sm">
						<Fig label="Monthly target" v={usd(figures?.monthly_target_cents)} />
						<Fig label="Monthly base" v={usd(figures?.monthly_base_cents)} />
						<Fig label="Annual target" v={usd(figures?.annual_target_cents)} />
						<Fig label="Annual base" v={usd(figures ? figures.monthly_base_cents * 12 : null)} />
					</div>
					<Select name="offer_template_key" label="Offer letter template" defaultValue={offer?.offer_template_key ?? defaults.offer}>
						{templates.filter((t) => t.kind === 'offer' && t.is_active).map((t) => (
							<option key={t.key} value={t.key}>
								{t.label}
							</option>
						))}
					</Select>
					<Select name="nda_template_key" label="NDA template" defaultValue={offer?.nda_template_key ?? defaults.nda}>
						{templates.filter((t) => t.kind === 'nda' && t.is_active).map((t) => (
							<option key={t.key} value={t.key}>
								{t.label}
							</option>
						))}
					</Select>
					<Textarea name="notes_md" label="Notes (internal)" rows={2} defaultValue={offer?.notes_md ?? ''} className="sm:col-span-2" />
					<div className="sm:col-span-4">
						<Button type="submit" size="sm" loading={pending}>
							{offer ? 'Save offer' : 'Draft offer'}
						</Button>
					</div>
				</form>
			)}

			{offer && !edit && (
				<div className="text-sm text-slate-700 dark:text-slate-300 grid sm:grid-cols-2 gap-x-6 gap-y-1">
					<div>
						{EMPLOYMENT_TYPE_LABELS[offer.employment_type]} · {REGION_LABELS[offer.region]} · {offer.work_mode.replace('_', ' ')} · {offer.hours_per_week} h/wk
					</div>
					<div>Start {offer.start_on ? formatDate(offer.start_on) : 'TBD'} · reports to {name(offer.manager_id)}</div>
					<div>
						{offer.pay_level} × {offer.pay_multiplier} step {offer.step} → <span className="font-mono">{usd(offer.monthly_target_cents)}</span>/mo (base {usd(offer.monthly_base_cents)}) · <span className="font-mono">{usd(offer.annual_target_cents)}</span>/yr
					</div>
					<div className="text-xs text-slate-500">
						{offer.approved_at ? `Approved ${formatRelative(offer.approved_at)} by ${name(offer.approved_by)}` : 'Not approved yet'}
						{offer.sent_at ? ` · sent ${formatRelative(offer.sent_at)}` : ''}
						{offer.decided_at ? ` · ${offer.status} ${formatRelative(offer.decided_at)}` : ''}
					</div>
				</div>
			)}

			{offer && (
				<div className="flex flex-wrap gap-2">
					{offer.status === 'draft' && isOwner && (
						<Button size="sm" loading={pending} onClick={() => act(() => setOfferStatus({ id: offer.id, application_id: applicationId, position_id: positionId, status: 'approved' }), 'Offer approved.')}>
							Approve offer (Alex)
						</Button>
					)}
					{offer.status === 'draft' && !isOwner && <span className="text-xs text-slate-500 self-center">Waiting for Alex&apos;s approval.</span>}
					{(offer.status === 'approved' || offer.status === 'sent') && canEdit && (
						<Button size="sm" loading={pending} onClick={() => act(() => sendOffer({ id: offer.id, application_id: applicationId, position_id: positionId }), `Offer letter + NDA sent via ${providerLabel}.`)} title={providerReady ? '' : 'No e-sign key: documents are created and you mark them signed by hand'}>
							{offer.status === 'sent' ? 'Resend documents' : `Send offer + NDA (${providerLabel})`}
						</Button>
					)}
					{offer.status === 'accepted' && canEdit && (
						<Button size="sm" loading={pending} onClick={() => act(() => convertToHire({ id: offer.id, application_id: applicationId, position_id: positionId, invite: true }), 'Converted: invite sent, profile linked when they sign in, provisioning checklist created.')}>
							{offer.hired_profile_id ? 'Re-run conversion' : 'Convert to hire'}
						</Button>
					)}
					{['draft', 'approved', 'sent'].includes(offer.status) && canEdit && (
						<>
							<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => setOfferStatus({ id: offer.id, application_id: applicationId, position_id: positionId, status: 'declined', reason: 'Candidate declined' }), 'Marked declined.')}>
								Candidate declined
							</Button>
							<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => setOfferStatus({ id: offer.id, application_id: applicationId, position_id: positionId, status: 'withdrawn' }), 'Offer withdrawn.')}>
								Withdraw
							</Button>
						</>
					)}
				</div>
			)}

			{documents.length > 0 && (
				<div className="space-y-1.5 border-t border-slate-200 dark:border-slate-700 pt-2">
					<div className="text-xs font-medium text-slate-700 dark:text-slate-300">Documents</div>
					{documents.map((d) => (
						<div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
							<Badge>{d.kind}</Badge>
							<Badge color={DOC_STATUS_COLORS[d.status]}>{d.status}</Badge>
							<span className="text-slate-600 dark:text-slate-400">{d.title}</span>
							{d.provider && <span className="text-slate-500">· {d.provider}</span>}
							{d.signed_at && <span className="text-slate-500">· signed {formatRelative(d.signed_at)}</span>}
							{d.signer_url && (
								<a href={d.signer_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
									signer link
								</a>
							)}
							{canEdit && ['sent', 'viewed', 'draft'].includes(d.status) && (
								<span className="ml-auto flex gap-1">
									{d.provider_ref && (
										<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => markDocument({ id: d.id, application_id: applicationId, position_id: positionId, status: 'refresh' }), 'Status refreshed.')}>
											Refresh
										</Button>
									)}
									<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => markDocument({ id: d.id, application_id: applicationId, position_id: positionId, status: 'signed' }), 'Marked signed.')}>
										Mark signed
									</Button>
									<Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => markDocument({ id: d.id, application_id: applicationId, position_id: positionId, status: 'declined' }), 'Marked declined.')}>
										Declined
									</Button>
								</span>
							)}
						</div>
					))}
					<p className="text-2xs text-slate-500">The offer is accepted when the offer letter and the NDA are both signed; the webhook flips them automatically with {providerLabel}, or mark them by hand.</p>
				</div>
			)}

			{provisioning.length > 0 && (
				<div className="space-y-1.5 border-t border-slate-200 dark:border-slate-700 pt-2">
					<div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
						Provisioning checklist
						<Badge>{provisioning.filter((p) => p.status === 'done').length}/{provisioning.length}</Badge>
						{!offer?.hired_profile_id && <span className="text-2xs text-amber-700 dark:text-amber-400">profile pending: links when {candidateEmail} accepts the invite (re-run conversion after)</span>}
					</div>
					{provisioning.map((p) => (
						<ProvisionRow key={p.id} p={p} people={people} />
					))}
				</div>
			)}
		</Card>
	);
}

function ProvisionRow({ p, people }: { p: ProvisioningRow; people: StaffOption[] }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const submit = (fd: FormData) =>
		start(async () => {
			await updateProvisioning(fd);
			router.refresh();
		});
	return (
		<form action={submit} className="flex flex-wrap items-center gap-2 text-xs">
			<input type="hidden" name="id" value={p.id} />
			<Badge color={p.status === 'done' ? 'success' : p.status === 'failed' ? 'danger' : p.status === 'in_progress' ? 'primary' : 'default'}>{p.status.replace('_', ' ')}</Badge>
			<span className={`text-slate-800 dark:text-slate-200 ${p.status === 'done' ? 'line-through text-slate-500' : ''}`}>{p.label}</span>
			<span className="text-slate-500">
				· {PROVISIONING_OWNER_LABELS[p.owner_role] ?? p.owner_role}
				{p.owner_id ? ` (${people.find((x) => x.id === p.owner_id)?.name ?? ''})` : ''}
				{p.due_on ? ` · due ${formatDate(p.due_on)}` : ''}
				{p.automation_key ? ' · auto' : ''}
			</span>
			<span className="ml-auto flex items-center gap-1">
				<select name="status" defaultValue={p.status} className="text-2xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1 py-0.5">
					{PROVISIONING_STATUSES.map((s) => (
						<option key={s} value={s}>
							{s.replace('_', ' ')}
						</option>
					))}
				</select>
				<Button type="submit" size="sm" variant="ghost" loading={pending}>
					Save
				</Button>
			</span>
		</form>
	);
}

function Fig({ label, v }: { label: string; v: string }) {
	return (
		<div className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1">
			<div className="text-2xs uppercase tracking-wide text-slate-500">{label}</div>
			<div className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{v}</div>
		</div>
	);
}
