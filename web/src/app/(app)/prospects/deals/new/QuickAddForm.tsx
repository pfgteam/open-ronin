'use client';

// Quick Add prospect (spec 2026-10-20 §7): Name, email or phone, brand,
// pipeline and source up front; everything else under "More fields". The form
// submits with onSubmit (not a form action), so React never resets it: an
// error keeps every typed value. Blur on Email / Brand looks up existing
// records and says so — information only, rev_intake still dedupes.

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { quickAddError } from '@/lib/revenue/dealPage';
import { MOTIONS, MOTION_LABELS, PERSON_ROLES, PERSON_ROLE_LABELS, SOURCES, SOURCE_LABELS } from '@/lib/revenue/shared';
import { addProspect, lookupExisting } from '../../actions';

export interface QuickAddPrefill {
	name: string | null;
	email: string | null;
	phone: string | null;
	title: string | null;
	linkedin: string | null;
	brandName: string | null;
	brandWebsite: string | null;
	industry: string | null;
	vertical: string | null;
}

type FieldError = { field: 'display_name' | 'contact' | 'pipeline'; message: string } | null;

export default function QuickAddForm({ pipelines, defaultPipeline, staff, meId, meEmail, products, prefill, prefilled, cancelHref, onCancel, inDialog = false }: {
	pipelines: { slug: string; name: string }[];
	defaultPipeline: string;
	staff: { id: string; name: string; email: string }[];
	meId: string;
	meEmail: string;
	products: { id: string; slug: string; name: string; price: string }[];
	prefill: QuickAddPrefill;
	/** Opened from an existing person or brand: the old any-one-identifier rule applies. */
	prefilled: boolean;
	cancelHref: string;
	/** Dialog door: Cancel closes the dialog instead of navigating. */
	onCancel?: () => void;
	/** Dialog door: no Card around the fields (the dialog is the card). */
	inDialog?: boolean;
}) {
	const router = useRouter();
	const formRef = useRef<HTMLFormElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [fieldError, setFieldError] = useState<FieldError>(null);
	const [personNote, setPersonNote] = useState<string | null>(null);
	const [brandNote, setBrandNote] = useState<string | null>(null);
	const [pending, start] = useTransition();
	// "More fields" opens on its own when the pre-fill already put something there.
	const moreOpen = !!(prefill.title || prefill.linkedin || prefill.brandWebsite || prefill.industry || prefill.vertical);

	const checkEmail = async (email: string) => {
		if (!email.includes('@')) return setPersonNote(null);
		const r = await lookupExisting({ email });
		setPersonNote(r.person ? `${r.person.name} already exists — this adds a deal to them.` : null);
	};
	const checkBrand = async (brand: string) => {
		if (brand.trim().length < 2) return setBrandNote(null);
		const r = await lookupExisting({ brand });
		setBrandNote(r.brand ? `✓ existing brand, ${r.brand.openDeals} open deal${r.brand.openDeals === 1 ? '' : 's'}` : null);
	};

	const submit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const fd = new FormData(e.currentTarget);
		const v = (k: string) => String(fd.get(k) ?? '');
		const fe = quickAddError({ display_name: v('display_name'), first_name: v('first_name'), last_name: v('last_name'), email: v('email'), phone: v('phone'), linkedin_url: v('linkedin_url'), brand_name: v('brand_name'), pipeline: v('pipeline'), prefilled });
		setFieldError(fe);
		setError(fe?.message ?? null);
		if (fe) return;
		fd.set('form', prefilled ? 'quick-prefill' : 'quick');
		start(async () => {
			const r = await addProspect(fd);
			if (!r.ok) {
				setError(r.error);
				return;
			}
			router.push(`/prospects/deals/${r.id}`);
		});
	};

	const errFor = (f: NonNullable<FieldError>['field']) => (fieldError?.field === f ? fieldError.message : undefined);

	const fields = (
		<>
				{error && <Callout tone="error">{error} Your answers are kept.</Callout>}
				<Input id="qa-name" name="display_name" label={prefilled ? 'Name' : 'Name *'} defaultValue={prefill.name ?? undefined} autoComplete="off" error={errFor('display_name')} />
				<div>
					<div className="grid gap-3 sm:grid-cols-2">
						<Input id="qa-email" name="email" label="Email" type="email" defaultValue={prefill.email ?? undefined} autoComplete="off" placeholder="name@brand.com" error={errFor('contact')} onBlur={(e) => void checkEmail(e.target.value)} />
						<Input id="qa-phone" name="phone" label="Phone" type="tel" defaultValue={prefill.phone ?? undefined} autoComplete="off" placeholder="+1 615 555 0100" />
					</div>
					{personNote && <p className="mt-1 text-2xs text-primary-700 dark:text-primary-300">{personNote}</p>}
					{!prefilled && !errFor('contact') && <p className="mt-1 text-2xs text-slate-500">Email or phone is required.</p>}
				</div>
				<div>
					<Input name="brand_name" label="Brand" defaultValue={prefill.brandName ?? undefined} autoComplete="off" placeholder="The brand we would represent" onBlur={(e) => void checkBrand(e.target.value)} />
					{brandNote && <p className="mt-1 text-2xs text-primary-700 dark:text-primary-300">{brandNote}</p>}
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<Select id="qa-pipeline" name="pipeline" label="Pipeline *" defaultValue={defaultPipeline} error={errFor('pipeline')}>
						{pipelines.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
					</Select>
					<Select name="source" label="Source" defaultValue="manual">
						{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
					</Select>
				</div>

				<details open={moreOpen} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
					<summary className="cursor-pointer text-sm text-slate-700 dark:text-slate-300">More fields</summary>
					<div className="mt-3 space-y-4">
						<div className="grid gap-3 sm:grid-cols-2">
							<Input name="first_name" label="First name (instead of Name)" autoComplete="off" />
							<Input name="last_name" label="Last name" autoComplete="off" />
							<Input name="title" label="Title" defaultValue={prefill.title ?? undefined} autoComplete="off" />
							<Input name="linkedin_url" label="LinkedIn URL" defaultValue={prefill.linkedin ?? undefined} autoComplete="off" placeholder="https://linkedin.com/in/…" />
							<Input name="instagram" label="Instagram" autoComplete="off" placeholder="@handle" />
							<Input name="location" label="Location" autoComplete="off" />
							<Select name="person_role" label="Role at the brand" defaultValue="decision_maker">
								{PERSON_ROLES.map((r) => <option key={r} value={r}>{PERSON_ROLE_LABELS[r]}</option>)}
							</Select>
							<Input name="brand_website" label="Website" defaultValue={prefill.brandWebsite ?? undefined} autoComplete="off" placeholder="https://" />
							<Input name="company_name" label="Parent company (if different)" autoComplete="off" />
							<Input name="industry" label="Industry" defaultValue={prefill.industry ?? undefined} autoComplete="off" placeholder="CPG, Health & Wellness, B2B…" />
							<Input name="vertical" label="Vertical" defaultValue={prefill.vertical ?? undefined} autoComplete="off" placeholder="Food, Beauty, Supplements…" />
							<Select name="motion" label="Motion" defaultValue="pr">
								{MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
							</Select>
							<Input name="campaign" label="Campaign" autoComplete="off" placeholder="HQ fall show, Lead Hype Oct…" />
							<Select name="owner_email" label="Owner" defaultValue={meEmail}>
								<option value="">Unassigned</option>
								{staff.map((s) => (
									<option key={s.id} value={s.email}>
										{s.name}
										{s.id === meId ? ' (me)' : ''}
									</option>
								))}
							</Select>
							<Input name="est_mrr" label="Est. monthly value" inputMode="decimal" placeholder="$" autoComplete="off" />
							<Input name="est_one_time" label="Est. one-time" inputMode="decimal" placeholder="$" autoComplete="off" />
						</div>
						{products.length > 0 && (
							<div>
								<p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Products of interest</p>
								<div className="max-h-56 space-y-1 overflow-y-auto pr-1">
									{products.map((p) => (
										<label key={p.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
											<Checkbox name="product_slugs" value={p.slug} />
											<span className="truncate">{p.name}</span>
											<span className="ml-auto shrink-0 tabular-nums text-slate-500">{p.price}</span>
										</label>
									))}
								</div>
							</div>
						)}
						<Textarea name="notes" label="Notes" rows={3} placeholder="Where they came from, what they said, anything the next person needs." />
					</div>
				</details>

				<div className="flex justify-end gap-2">
					{onCancel ? (
						<Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
					) : (
						<Link href={cancelHref}>
							<Button type="button" variant="secondary" size="sm">Cancel</Button>
						</Link>
					)}
					<Button type="submit" size="sm" loading={pending}>Add prospect</Button>
				</div>
		</>
	);

	return (
		<form ref={formRef} onSubmit={submit} noValidate>
			{inDialog ? <div className="space-y-4">{fields}</div> : <Card className="space-y-4">{fields}</Card>}
		</form>
	);
}
