'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { addDocument } from '../../callActions';

export default function DocumentForm({ dealId }: { dealId: string }) {
	const router = useRouter();
	const ref = useRef<HTMLFormElement>(null);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, start] = useTransition();
	return (
		<Card>
			<form
				ref={ref}
				className="flex flex-wrap items-end gap-2"
				action={(fd) =>
					start(async () => {
						setMsg(null);
						const r = await addDocument(fd);
						setMsg(r.ok ? { ok: true, text: 'Attached.' } : { ok: false, text: r.error });
						if (r.ok) ref.current?.reset();
						router.refresh();
					})
				}
			>
				<input type="hidden" name="deal_id" value={dealId} />
				<Select name="kind" label="Kind" size="sm" className="w-36" defaultValue="proposal">
					<option value="proposal">Proposal</option>
					<option value="presentation">Presentation</option>
					<option value="contract">Contract</option>
					<option value="brief">Brief</option>
					<option value="other">Other</option>
				</Select>
				<Input name="title" label="Title" className="w-56" required />
				<Input name="url" label="Link (Drive, Canva, PDF…)" className="w-72" placeholder="https://" />
				<Button type="submit" size="sm" loading={pending}>
					Attach link
				</Button>
			</form>
			{msg && (
				<Callout tone={msg.ok ? 'success' : 'error'} className="mt-2">
					{msg.text}
				</Callout>
			)}
		</Card>
	);
}
