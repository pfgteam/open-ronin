'use client';

// Catalog section (spec 2026-10-19 §6): products table; Edit / Add open a
// Dialog with the product fields. Slug fixed once created.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { saveProduct } from '@/app/(app)/prospects/actions';
import { BRANDS, BRAND_LABELS, PRODUCT_FAMILIES, PRODUCT_FAMILY_LABELS, PRODUCT_KINDS, productPriceLabel, type ProductRow } from '@/lib/revenue/shared';
import Dialog from '@/components/ui/Dialog';
import SettingsSection from '../_ui/SettingsSection';

const th = 'px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2';
const KIND_LABEL: Record<string, string> = { retainer: 'Retainer', subscription: 'Subscription', one_time: 'One-time', addon: 'Add-on' };
const cents = (v: number | null) => (v == null ? '' : String(v / 100));

function ProductDialog({ product, onClose }: { product: ProductRow | null; onClose: () => void }) {
	const router = useRouter();
	const { toast } = useToast();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const submit = (fd: FormData) =>
		start(async () => {
			setError(null);
			if (product) fd.set('slug', product.slug);
			const r = await saveProduct(fd);
			if (!r.ok) {
				setError(r.error);
				return;
			}
			toast({ message: `${String(fd.get('name'))} saved`, variant: 'success' });
			onClose();
			router.refresh();
		});
	return (
		<Dialog
			open
			onClose={onClose}
			title={product ? `Edit product · ${product.name}` : 'New product'}
			footer={
				<>
					<Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
					<Button size="sm" type="submit" form="product-form" loading={pending}>Save product</Button>
				</>
			}
		>
			<form id="product-form" action={submit} className="grid gap-3 sm:grid-cols-2">
				{product && <input type="hidden" name="id" value={product.id} />}
				<Input name="name" label="Name" defaultValue={product?.name ?? ''} required />
				<Input name="slug" label={product ? 'Slug (fixed)' : 'Slug'} defaultValue={product?.slug ?? ''} disabled={!!product} required={!product} pattern="[a-z0-9-]+" />
				<Select name="brand" label="Brand" defaultValue={product?.brand ?? 'main'}>
					{BRANDS.map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}
				</Select>
				<Select name="family" label="Family" defaultValue={product?.family ?? 'pr'}>
					{PRODUCT_FAMILIES.map((f) => <option key={f} value={f}>{PRODUCT_FAMILY_LABELS[f]}</option>)}
				</Select>
				<Select name="kind" label="Kind" defaultValue={product?.kind ?? 'retainer'}>
					{PRODUCT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
				</Select>
				<Input name="position" label="Position" type="number" defaultValue={product?.position ?? 100} />
				<Input name="price" label="Price ($)" inputMode="decimal" defaultValue={cents(product?.price_cents ?? null)} />
				<Input name="price_max" label="Price max ($, for ranges)" inputMode="decimal" defaultValue={cents(product?.price_max_cents ?? null)} />
				<Input name="per_unit" label="Per-unit add ($)" inputMode="decimal" defaultValue={cents(product?.per_unit_cents ?? null)} />
				<Input name="unit_label" label="Unit label" defaultValue={product?.unit_label ?? ''} placeholder="additional client / month" />
				<div className="sm:col-span-2"><Textarea name="deliverables_md" label="Deliverables" defaultValue={product?.deliverables_md ?? ''} rows={3} /></div>
				<div className="sm:col-span-2"><Textarea name="terms_md" label="Terms" defaultValue={product?.terms_md ?? ''} rows={2} /></div>
				<label className="flex items-center gap-2 text-sm"><Checkbox name="is_active" defaultChecked={product?.is_active ?? true} /> Active</label>
			</form>
			{error && <Callout tone="error" className="mt-3">{error}</Callout>}
		</Dialog>
	);
}

export default function CatalogSection({ products, canManage }: { products: ProductRow[]; canManage: boolean }) {
	const [dialog, setDialog] = useState<ProductRow | 'new' | null>(null);
	return (
		<>
			<SettingsSection
				title="Products"
				description={`${products.length} products · what deals and contracts are built from`}
				padded={false}
				actions={canManage && <Button size="sm" variant="ghost" onClick={() => setDialog('new')}>+ Add product</Button>}
			>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-slate-200 dark:border-slate-700">
								<th className={th}>Product</th><th className={th}>Brand</th><th className={th}>Family</th><th className={th}>Kind</th><th className={clsx(th, 'text-right')}>Price</th><th className={th}>Active</th>{canManage && <th className={th} />}
							</tr>
						</thead>
						<tbody>
							{products.map((p) => (
								<tr key={p.id} className="border-b border-slate-200 last:border-b-0 dark:border-slate-700">
									<td className={clsx(td, 'font-semibold text-slate-900 dark:text-slate-100')}>{p.name}</td>
									<td className={td}>{BRAND_LABELS[p.brand]}</td>
									<td className={td}>{PRODUCT_FAMILY_LABELS[p.family]}</td>
									<td className={td}>{KIND_LABEL[p.kind] ?? p.kind}</td>
									<td className={clsx(td, 'text-right tabular-nums')}>{productPriceLabel(p)}</td>
									<td className={td}>{p.is_active ? 'Yes' : 'No'}</td>
									{canManage && <td className={clsx(td, 'text-right')}><Button size="sm" variant="ghost" onClick={() => setDialog(p)}>Edit</Button></td>}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</SettingsSection>
			{dialog && <ProductDialog product={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />}
		</>
	);
}
