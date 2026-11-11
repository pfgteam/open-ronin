'use client';

// Closing tab on the deal page (0126, spec §9): contracts built from the
// product catalog (line items, signer, template, term, start), sent through
// the e-sign provider or marked by hand; presentation builder. Since spec
// 2026-10-20 it also holds Documents, confirms signed/declined/void in house
// dialogs, keeps once-shown links on screen with Copy, and gives each button
// its own pending state.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import ConfirmAction from '@/components/ui/ConfirmAction';
import Dialog from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatRelative } from '@/lib/format';
import { money, totals, type LineItem } from '@/lib/revenue/contracts';
import type { ContractRow, DocumentRow, PresentationRow, TemplateRow } from '@/lib/revenue/server';
import { DocumentsTab } from './ProfileTabs';
import { usePendingKey } from './usePendingKey';
import { PERSON_ROLE_LABELS, type PersonRow, type ProductRow } from '@/lib/revenue/shared';
import { buildPresentation, createContract, markContract, mintPortalLink, refreshContractStatus, sendContract } from '../../closingActions';

type Msg = { ok: boolean; text: string } | null;
interface Linked { person: PersonRow | null; role: string; is_primary: boolean }

export default function ClosingTab({ dealId, dealTitle, brandName, contracts, presentations, templates, products, people, providerLabel, providerIsManual, canManage, aiReady, documents, staff }: { dealId: string; dealTitle: string; brandName: string | null; contracts: ContractRow[]; presentations: PresentationRow[]; templates: TemplateRow[]; products: ProductRow[]; people: Linked[]; providerLabel: string; providerIsManual: boolean; canManage: boolean; aiReady: boolean; documents: DocumentRow[]; staff: Record<string, string> }) {
	const router = useRouter();
	const [msg, setMsg] = useState<Msg>(null);
	const [showNew, setShowNew] = useState(contracts.length === 0);
	const [items, setItems] = useState<LineItem[]>([]);
	const [pick, setPick] = useState('');
	const [signer, setSigner] = useState<string>(people.find((p) => p.role === 'signer')?.person?.id ?? people.find((p) => p.is_primary)?.person?.id ?? '');
	const { isPending, run: runKey } = usePendingKey();
	// Once-shown values (signer link, portal link) stay until dismissed; a refresh does not clear them.
	const [shown, setShown] = useState<{ label: string; url: string } | null>(null);
	const t = useMemo(() => totals(items), [items]);
	const signerPerson = people.find((p) => p.person?.id === signer)?.person ?? null;
	const run = (key: string, fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, ok: (r: Record<string, unknown>) => string, keep?: (r: Record<string, unknown>) => { label: string; url: string } | null) =>
		runKey(key, async () => {
			setMsg(null);
			const r = await fn();
			setMsg(r.ok ? { ok: true, text: ok(r) } : { ok: false, text: r.error ?? 'Failed.' });
			if (r.ok && keep) setShown(keep(r));
			router.refresh();
		});
	const mark = async (contractId: string, status: 'signed' | 'void', okText: string) => {
		const r = await markContract({ contract_id: contractId, deal_id: dealId, status });
		if (!r.ok) return { ok: false as const, error: r.error };
		router.refresh();
		return { ok: true as const, message: okText };
	};

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<div className="space-y-4">
			<Callout tone="info">
				E-sign provider: <strong>{providerLabel}</strong>
				{providerIsManual ? ' — no DocuSeal / Documenso / OpenSign key yet, so "Send" marks the contract sent and you mark it signed by hand (GHL contracts keep working). Signing converts the deal: brand → client, signer → client contact, contract row created.' : ' — "Send" emails the signer; signed status arrives by webhook (or Refresh).'}
			</Callout>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{shown && <ShownLink label={shown.label} url={shown.url} onDismiss={() => setShown(null)} />}

			{/* existing contracts */}
			{contracts.map((c) => (
				<Card key={c.id} className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<Badge color={c.status === 'signed' ? 'success' : c.status === 'declined' || c.status === 'void' ? 'danger' : c.status === 'draft' ? 'default' : 'primary'}>{c.status}</Badge>
						<span className="text-sm font-medium text-slate-900 dark:text-slate-100">{c.title}</span>
						<span className="text-xs text-slate-500">
							{money(c.mrr_cents)}/mo{c.one_time_cents ? ` + ${money(c.one_time_cents)} once` : ''}
							{c.term_months ? ` · ${c.term_months} mo` : ''}
							{c.starts_on ? ` · from ${formatDate(c.starts_on)}` : ''} · signer {c.signer_name ?? c.signer_email}
							{c.provider ? ` · ${c.provider}` : ''}
							{c.signed_at ? ` · signed ${formatRelative(c.signed_at)}` : c.sent_at ? ` · sent ${formatRelative(c.sent_at)}` : ''}
						</span>
						<div className="ml-auto flex items-center gap-1">
							{c.status === 'draft' && (
								<Button size="sm" loading={isPending(`send:${c.id}`)} onClick={() => run(`send:${c.id}`, () => sendContract({ contract_id: c.id, deal_id: dealId }), (r) => (r.signer_url ? `Sent via ${r.provider}.` : `Marked sent (${r.provider}).`), (r) => (r.signer_url ? { label: 'Signer link', url: String(r.signer_url) } : null))}>
									Send for signature
								</Button>
							)}
							{(c.status === 'sent' || c.status === 'viewed') && (
								<>
									{c.provider && c.provider !== 'manual' && (
										<Button size="sm" variant="ghost" loading={isPending(`refresh:${c.id}`)} onClick={() => run(`refresh:${c.id}`, () => refreshContractStatus({ contract_id: c.id, deal_id: dealId }), (r) => `Status: ${r.status}`)}>
											Refresh
										</Button>
									)}
									<ConfirmAction size="sm" variant="outline" label="Mark signed…" title="Mark this contract signed?" confirmLabel="Mark signed" tone="danger"
										impact={<p>{brandName ?? dealTitle} becomes a client and the deal closes as won.</p>}
										onConfirm={() => mark(c.id, 'signed', 'Signed — converted to client.')} />
									<DeclineButton contractId={c.id} dealId={dealId} onDone={() => router.refresh()} />
								</>
							)}
							{c.status !== 'signed' && c.status !== 'void' && (
								<ConfirmAction size="sm" variant="ghost" className="text-red-600 dark:text-red-400" label="Void…" title="Void this contract?" confirmLabel="Void contract" tone="danger"
									impact={<p>The contract is cancelled; the signer link stops working.</p>}
									onConfirm={() => mark(c.id, 'void', 'Contract voided.')} />
							)}
							{c.status === 'signed' && canManage && (
								<Button size="sm" variant="ghost" loading={isPending(`portal:${c.id}`)} onClick={() => run(`portal:${c.id}`, () => mintPortalLink({ contract_id: c.id, deal_id: dealId }), () => 'Portal link created. Copy it now: it is shown once.', (r) => ({ label: 'Portal link (shown once)', url: String(r.url) }))}>
									Portal link
								</Button>
							)}
						</div>
					</div>
					{c.provider_url && (c.status === 'sent' || c.status === 'viewed') && (
						<div className="text-2xs text-slate-500 break-all">
							Signer link: <code>{c.provider_url}</code>
						</div>
					)}
					{c.client_id && (
						<div className="text-xs text-green-700 dark:text-green-400">
							Converted → <a href={`/clients/${c.client_id}`} className="underline">client</a>
							{c.converted_at ? ` ${formatRelative(c.converted_at)}` : ''}
						</div>
					)}
					{c.body_md && (
						<details className="text-xs">
							<summary className="cursor-pointer text-primary-700 dark:text-primary-300">Contract text</summary>
							<pre className="mt-2 whitespace-pre-wrap text-2xs text-slate-600 dark:text-slate-400 max-h-96 overflow-y-auto">{c.body_md}</pre>
						</details>
					)}
				</Card>
			))}

			{/* new contract */}
			<Card className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">New contract</h2>
					<Button size="sm" variant={showNew ? 'ghost' : 'outline'} onClick={() => setShowNew(!showNew)}>
						{showNew ? 'Close' : '+ Build from products'}
					</Button>
				</div>
				{showNew && (
					<form
						className="space-y-3"
						action={(fd) => {
							fd.set('line_items', JSON.stringify(items));
							if (signerPerson) {
								fd.set('signer_person_id', signerPerson.id);
								if (!fd.get('signer_name')) fd.set('signer_name', signerPerson.display_name);
								if (!fd.get('signer_email')) fd.set('signer_email', signerPerson.email ?? '');
							}
							runKey('new', async () => {
								setMsg(null);
								const r = await createContract(fd);
								setMsg(r.ok ? { ok: true, text: 'Draft contract created.' } : { ok: false, text: r.error });
								if (r.ok) {
									setShowNew(false);
									setItems([]);
								}
								router.refresh();
							});
						}}
					>
						<input type="hidden" name="deal_id" value={dealId} />
						<div className="grid sm:grid-cols-3 gap-3">
							<Input name="title" label="Title" defaultValue={`${brandName ?? dealTitle} — Agreement`} required className="sm:col-span-2" />
							<Select name="template_id" label="Template" defaultValue={templates[0]?.id ?? ''}>
								<option value="">— none (body pasted later) —</option>
								{templates.map((tp) => (
									<option key={tp.id} value={tp.id}>
										{tp.label} ({tp.org})
									</option>
								))}
							</Select>
						</div>
						<div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2">
							<div className="text-xs font-medium text-slate-700 dark:text-slate-300">Products</div>
							<div className="flex gap-2">
								<Select size="sm" aria-label="Add product" value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1">
									<option value="">Add a product…</option>
									{products.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name} · {p.price_cents != null ? money(p.price_cents) : 'quote'} {p.kind === 'one_time' ? 'once' : '/mo'}
										</option>
									))}
								</Select>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={() => {
										const p = products.find((x) => x.id === pick);
										if (!p) return;
										setItems((cur) => [...cur, { product_id: p.id, name: p.name, qty: 1, unit_cents: p.price_cents ?? 0, billing: p.kind === 'one_time' ? 'one_time' : p.per_unit_cents ? 'per_unit' : 'monthly', kind: p.kind }]);
										setPick('');
									}}
								>
									Add
								</Button>
							</div>
							{items.length === 0 && <p className="text-2xs text-slate-500">No products yet.</p>}
							{items.map((li, i) => (
								<div key={i} className="flex items-center gap-2 text-xs">
									<span className="flex-1 text-slate-800 dark:text-slate-200">{li.name}</span>
									<input type="number" min={1} value={li.qty} onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} className="w-16 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs" aria-label="Qty" />
									<span className="text-slate-500">×</span>
									<input type="number" min={0} step="1" value={li.unit_cents / 100} onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, unit_cents: Math.round(Number(e.target.value) * 100) } : x)))} className="w-24 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs" aria-label="Unit price" />
									<select value={li.billing} onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, billing: e.target.value as LineItem['billing'] } : x)))} className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs" aria-label="Billing">
										<option value="monthly">monthly</option>
										<option value="one_time">one-time</option>
										<option value="per_unit">per unit</option>
									</select>
									<span className="w-20 text-right tabular-nums">{money(li.qty * li.unit_cents)}</span>
									<button type="button" className="text-slate-400 hover:text-red-600" aria-label="Remove" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}>
										×
									</button>
								</div>
							))}
							<div className="text-xs text-right text-slate-700 dark:text-slate-300 tabular-nums">
								<strong>{money(t.mrr_cents)}/mo</strong>
								{t.one_time_cents ? ` + ${money(t.one_time_cents)} once` : ''}
							</div>
						</div>
						<div className="grid sm:grid-cols-3 gap-3">
							<Select label="Signer" value={signer} onChange={(e) => setSigner(e.target.value)}>
								<option value="">— type below —</option>
								{people.map((p) => p.person && (
									<option key={p.person.id} value={p.person.id}>
										{p.person.display_name} · {PERSON_ROLE_LABELS[p.role as keyof typeof PERSON_ROLE_LABELS] ?? p.role}
									</option>
								))}
							</Select>
							<Input name="signer_name" label="Signer name" defaultValue={signerPerson?.display_name ?? ''} key={`n-${signer}`} />
							<Input name="signer_email" label="Signer email" type="email" defaultValue={signerPerson?.email ?? ''} key={`e-${signer}`} required />
							<Input name="signer_title" label="Signer title" placeholder="Founder & CEO" />
							<Input name="starts_on" label="Start date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
							<Input name="term_months" label="Term (months)" type="number" min={1} defaultValue={templates[0]?.default_term_months ?? 6} />
							<Input name="deposit" label="Deposit ($, optional)" inputMode="decimal" />
						</div>
						<p className="text-2xs text-slate-500">The signer becomes the client contact on signature; other linked people stay on the brand.</p>
						<Button type="submit" size="sm" loading={isPending('new')} disabled={items.length === 0}>
							Create draft
						</Button>
					</form>
				)}
			</Card>

			</div>
			<div className="space-y-4">
			{/* presentations */}
			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Closing-call presentation</h2>
				{presentations.map((p) => (
					<details key={p.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-3 text-xs">
						<summary className="cursor-pointer flex items-center gap-2">
							<Badge color={p.status === 'ready' ? 'success' : 'default'}>{p.status}</Badge>
							<span className="font-medium text-slate-900 dark:text-slate-100">{p.title}</span>
							<span className="text-slate-500">{formatRelative(p.created_at)}{p.analyzer ? ` · ${p.analyzer}` : ''}</span>
						</summary>
						<pre className="mt-2 whitespace-pre-wrap text-2xs text-slate-600 dark:text-slate-400">{p.body_md}</pre>
					</details>
				))}
				<form
					className="grid sm:grid-cols-2 gap-3"
					action={(fd) =>
						runKey('present', async () => {
							setMsg(null);
							const r = await buildPresentation(fd);
							setMsg(r.ok ? { ok: true, text: 'Deck outline built.' } : { ok: false, text: r.error });
							router.refresh();
						})
					}
				>
					<input type="hidden" name="deal_id" value={dealId} />
					<Input name="brand" label="Brand" defaultValue={brandName ?? ''} />
					<Select name="package" label="Recommended package" defaultValue={products.find((p) => p.family === 'pr' && p.kind === 'retainer')?.name ?? ''}>
						{products.map((p) => (
							<option key={p.id} value={p.name}>
								{p.name}
							</option>
						))}
					</Select>
					<Textarea name="goals" label="Their goals (in their words)" rows={2} required className="sm:col-span-2" />
					<Textarea name="case_studies" label="Case studies to use (one per line, optional)" rows={2} className="sm:col-span-2" />
					<div className="sm:col-span-2">
						<Button type="submit" size="sm" variant="outline" loading={isPending('present')}>
							<Sparkles className="w-3.5 h-3.5" /> Build deck outline{!aiReady ? ' (skeleton; no AI key)' : ''}
						</Button>
					</div>
				</form>
			</Card>
			<DocumentsTab dealId={dealId} documents={documents} staff={staff} />
			</div>
		</div>
	);
}

/** A once-shown link with Copy; stays until dismissed (spec 2026-10-20 §6). */
function ShownLink({ label, url, onDismiss }: { label: string; url: string; onDismiss: () => void }) {
	const { toast } = useToast();
	const copy = () =>
		navigator.clipboard
			.writeText(url)
			.then(() => toast({ message: 'Copied', variant: 'success' }))
			.catch(() => toast({ message: 'Copy failed — select the text and copy it by hand.', variant: 'error' }));
	return (
		<Callout tone="warning">
			<div className="space-y-1.5">
				<p className="text-xs font-medium">{label}</p>
				<code className="block break-all text-xs">{url}</code>
				<div className="flex gap-2">
					<Button size="sm" variant="secondary" onClick={copy}>Copy</Button>
					<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
				</div>
			</div>
		</Callout>
	);
}

/** "Declined…": the reason is required and kept on error (no window.prompt). */
function DeclineButton({ contractId, dealId, onDone }: { contractId: string; dealId: string; onDone: () => void }) {
	const { toast } = useToast();
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const close = () => {
		if (busy) return;
		setOpen(false);
		setError(null);
	};
	const submit = async () => {
		setBusy(true);
		setError(null);
		const r = await markContract({ contract_id: contractId, deal_id: dealId, status: 'declined', reason: reason.trim() });
		setBusy(false);
		if (!r.ok) {
			setError(r.error);
			return;
		}
		setOpen(false);
		setReason('');
		toast({ message: 'Marked declined', variant: 'success' });
		onDone();
	};
	return (
		<>
			<Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Declined…</Button>
			<Dialog open={open} onClose={close} title="Mark this contract declined?" maxWidth="max-w-lg"
				footer={
					<>
						<Button size="sm" variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
						<Button size="sm" loading={busy} disabled={!reason.trim()} onClick={submit}>Mark declined</Button>
					</>
				}>
				<Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did they say?" />
				{error && <Callout tone="error" className="mt-3">{error}</Callout>}
			</Dialog>
		</>
	);
}
