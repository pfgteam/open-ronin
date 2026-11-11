'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import type { BrandRow } from '@/lib/revenue/shared';
import { updateBrand } from '../../actions';

export default function BrandEditForm({ brand }: { brand: BrandRow }) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	const s = brand.socials ?? {};
	return (
		<Card>
			<form
				className="space-y-4"
				action={(fd) => {
					setError(null);
					start(async () => {
						const r = await updateBrand(fd);
						if (!r.ok) setError(r.error);
						else router.push(`/prospects/brands/${brand.id}`);
					});
				}}
			>
				<input type="hidden" name="id" value={brand.id} />
				<div className="grid sm:grid-cols-2 gap-3">
					<Input name="name" label="Brand" defaultValue={brand.name} required className="sm:col-span-2" />
					<Input name="website" label="Website" defaultValue={brand.website ?? ''} />
					<Input name="domain" label="Domain" defaultValue={brand.domain ?? ''} placeholder="brand.com" />
					<Input name="industry" label="Industry" defaultValue={brand.industry ?? ''} />
					<Input name="vertical" label="Vertical" defaultValue={brand.vertical ?? ''} />
					<Input name="instagram" label="Instagram" defaultValue={s.instagram ?? ''} />
					<Input name="facebook" label="Facebook" defaultValue={s.facebook ?? ''} />
					<Input name="tiktok" label="TikTok" defaultValue={s.tiktok ?? ''} />
					<Input name="x" label="X" defaultValue={s.x ?? ''} />
					<Input name="linkedin" label="LinkedIn" defaultValue={s.linkedin ?? ''} />
					<Input name="youtube" label="YouTube" defaultValue={s.youtube ?? ''} />
					<Textarea name="description" label="About" defaultValue={brand.description ?? ''} rows={4} className="sm:col-span-2" />
				</div>
				{error && <Callout tone="error">{error}</Callout>}
				<div className="flex gap-2">
					<Button type="submit" loading={pending}>
						Save
					</Button>
					<Button type="button" variant="ghost" onClick={() => router.push(`/prospects/brands/${brand.id}`)}>
						Cancel
					</Button>
				</div>
			</form>
		</Card>
	);
}
