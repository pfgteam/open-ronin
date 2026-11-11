'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import type { MessageRow } from '@/lib/hiring/server';
import { reviewMessage } from '../actions';

export default function InboxRow({ m }: { m: MessageRow }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await reviewMessage(fd);
			setMsg(r.ok ? { ok: true, text: r.status === 'sent' ? 'Sent.' : r.status === 'approved' ? 'Approved; queued.' : r.status === 'cancelled' ? 'Cancelled.' : 'Saved.' } : { ok: false, text: r.error });
			router.refresh();
		});
	return (
		<form action={submit} className="space-y-1.5">
			<input type="hidden" name="id" value={m.id} />
			{msg && <Callout tone={msg.ok ? 'success' : 'error'} className="py-1">{msg.text}</Callout>}
			{m.channel === 'email' && <Input name="subject" defaultValue={m.subject ?? ''} className="text-xs" />}
			<Textarea name="body_md" rows={m.channel === 'email' ? 6 : 3} defaultValue={m.body_md} className="text-xs" />
			<div className="flex flex-wrap gap-1.5">
				<Button type="submit" name="decision" value="save" size="sm" variant="ghost" loading={pending}>
					Save edits
				</Button>
				{m.status !== 'approved' && (
					<Button type="submit" name="decision" value="approve" size="sm" variant="outline" loading={pending}>
						Approve (queue)
					</Button>
				)}
				<Button type="submit" name="decision" value="approve_send" size="sm" loading={pending}>
					Approve + send now
				</Button>
				<Button type="submit" name="decision" value="cancel" size="sm" variant="ghost" loading={pending}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
