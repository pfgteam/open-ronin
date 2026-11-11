'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import type { PersonRow } from '@/lib/revenue/shared';
import { updatePerson } from '../../actions';

export default function PersonEditForm({ person }: { person: PersonRow }) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, start] = useTransition();
	return (
		<Card>
			<form
				className="space-y-4"
				action={(fd) => {
					setError(null);
					start(async () => {
						const r = await updatePerson(fd);
						if (!r.ok) setError(r.error);
						else router.push(`/prospects/people/${person.id}`);
					});
				}}
			>
				<input type="hidden" name="id" value={person.id} />
				<div className="grid sm:grid-cols-2 gap-3">
					<Input name="first_name" label="First name" defaultValue={person.first_name ?? ''} />
					<Input name="last_name" label="Last name" defaultValue={person.last_name ?? ''} />
					<Input name="display_name" label="Display name" defaultValue={person.display_name} required className="sm:col-span-2" />
					<Input name="title" label="Title" defaultValue={person.title ?? ''} />
					<Input name="location" label="Location" defaultValue={person.location ?? ''} />
					<Input name="email" label="Email" type="email" defaultValue={person.email ?? ''} />
					<Input name="phone" label="Phone" defaultValue={person.phone ?? ''} />
					<Input name="linkedin_url" label="LinkedIn URL" defaultValue={person.linkedin_url ?? ''} className="sm:col-span-2" />
					<Input name="instagram" label="Instagram" defaultValue={person.instagram ?? ''} />
					<Input name="facebook" label="Facebook" defaultValue={person.facebook ?? ''} />
					<Input name="tiktok" label="TikTok" defaultValue={person.tiktok ?? ''} />
					<Input name="x_handle" label="X" defaultValue={person.x_handle ?? ''} />
					<Input name="website" label="Website" defaultValue={person.website ?? ''} className="sm:col-span-2" />
					<Textarea name="notes_md" label="Notes" defaultValue={person.notes_md ?? ''} rows={4} className="sm:col-span-2" />
				</div>
				<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
					<Checkbox name="do_not_contact" defaultChecked={person.do_not_contact} />
					Do not contact
				</label>
				{error && <Callout tone="error">{error}</Callout>}
				<div className="flex gap-2">
					<Button type="submit" loading={pending}>
						Save
					</Button>
					<Button type="button" variant="ghost" onClick={() => router.push(`/prospects/people/${person.id}`)}>
						Cancel
					</Button>
				</div>
			</form>
		</Card>
	);
}
