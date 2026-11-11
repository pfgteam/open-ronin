'use client';

// Application detail controls (0130): status + notes + reject reason +
// hide, file open (signed URL).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { reviewApplication, signedFileUrl } from '../../../../actions';
import { APP_STATUS_LABELS } from '../Controls';

export function ReviewPanel({ id, positionId, status, notes, hidden, rejectedReason }: { id: string; positionId: string; status: string; notes: string | null; hidden: boolean; rejectedReason: string | null }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const [next, setNext] = useState(status);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			fd.set('id', id);
			fd.set('position_id', positionId);
			const r = await reviewApplication(fd);
			setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
			router.refresh();
		});
	return (
		<form action={submit} className="space-y-3">
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			<Select name="status" label="Status" value={next} onChange={(e) => setNext(e.target.value)}>
				{Object.entries(APP_STATUS_LABELS).map(([k, v]) => (
					<option key={k} value={k}>
						{v}
					</option>
				))}
			</Select>
			{next === 'rejected' && <Input name="rejected_reason" label="Reject reason (internal)" defaultValue={rejectedReason ?? ''} maxLength={400} />}
			{next === 'pool' && <p className="text-2xs text-slate-500">Moves the candidate to the talent pool, tagged with this role&apos;s department and title. The reviewed &quot;position closed, similar openings&quot; message goes out from H5&apos;s comms layer.</p>}
			<Textarea name="reviewer_notes_md" label="Reviewer notes" rows={5} defaultValue={notes ?? ''} maxLength={8000} />
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="sm" loading={pending}>
					Save
				</Button>
				<Button type="submit" name="hidden" value={String(!hidden)} size="sm" variant="ghost" loading={pending}>
					{hidden ? 'Unhide' : 'Hide from list'}
				</Button>
			</div>
		</form>
	);
}

export function FileLink({ path, label }: { path: string; label: string }) {
	const [pending, start] = useTransition();
	const [err, setErr] = useState<string | null>(null);
	return (
		<span className="inline-flex items-center gap-2">
			<Button
				size="sm"
				variant="outline"
				loading={pending}
				onClick={() =>
					start(async () => {
						setErr(null);
						const r = await signedFileUrl({ path });
						if (!r.ok) return setErr(r.error);
						window.open(r.url, '_blank', 'noopener');
					})
				}
			>
				{label}
			</Button>
			{err && <span className="text-2xs text-red-600">{err}</span>}
		</span>
	);
}
