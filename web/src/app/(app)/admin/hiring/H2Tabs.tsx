'use client';

// Admin → Hiring → Boards / Careers (0129): board toggles + format hints,
// the careers page copy, the referral bonus config.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import type { BoardRow } from '@/lib/hiring/careers';
import { saveBoard, saveCareersSettings, saveReferralBonus } from '@/app/(app)/hiring/actions';

function useSubmit<T extends { ok: boolean; error?: string }>(fn: (fd: FormData) => Promise<T>, okText: string) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			const r = await fn(fd);
			setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error: string }).error });
			router.refresh();
		});
	return { submit, pending, msg };
}

export function BoardsTab({ boards, canManage }: { boards: BoardRow[]; canManage: boolean }) {
	const s = useSubmit(saveBoard, 'Board saved.');
	const [showNew, setShowNew] = useState(false);
	const Form = ({ b }: { b: BoardRow | null }) => (
		<form action={s.submit} className="grid sm:grid-cols-4 gap-2 items-end">
			<Input name="key" label="Key" defaultValue={b?.key ?? ''} pattern="[a-z][a-z0-9_]{1,40}" required readOnly={!!b} disabled={!canManage} />
			<Input name="label" label="Label" defaultValue={b?.label ?? ''} required disabled={!canManage} />
			<Select name="kind" label="Kind" defaultValue={b?.kind ?? 'manual'} disabled={!canManage}>
				<option value="auto">auto (we publish)</option>
				<option value="manual">manual (post kit)</option>
				<option value="adapter">adapter (paid distribution)</option>
			</Select>
			<Input name="sort" label="Sort" type="number" defaultValue={b?.sort ?? 100} disabled={!canManage} />
			<Input name="post_url" label="Where to post (URL)" defaultValue={b?.post_url ?? ''} className="sm:col-span-2" disabled={!canManage} />
			<Input name="max_chars" label="Max chars" type="number" defaultValue={b?.max_chars ?? ''} disabled={!canManage} />
			<Input name="default_days" label="Expiry (days)" type="number" min={1} max={365} defaultValue={b?.default_days ?? 30} disabled={!canManage} />
			<Textarea name="format_hint" label="Format hint (the AI follows this per board)" rows={2} defaultValue={b?.format_hint ?? ''} className="sm:col-span-3" disabled={!canManage} />
			<Input name="cost_note" label="Cost" defaultValue={b?.cost_note ?? ''} disabled={!canManage} />
			<Input name="regions" label="Regions (comma)" defaultValue={b?.regions.join(', ') ?? ''} disabled={!canManage} />
			<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
				<Checkbox name="enabled" defaultChecked={b?.enabled ?? true} disabled={!canManage} /> Enabled
			</label>
			{canManage && (
				<Button type="submit" size="sm" loading={s.pending}>
					Save
				</Button>
			)}
		</form>
	);
	return (
		<div className="space-y-4">
			<Callout tone="info">Each board is a toggle with a tracked link (round 2 #3). Auto boards publish themselves; manual ones feed the post kit; the paid distribution adapter stays off by default. ZipRecruiter is excluded.</Callout>
			{s.msg && <Callout tone={s.msg.ok ? 'success' : 'error'}>{s.msg.text}</Callout>}
			{boards.map((b) => (
				<Card key={b.key} className="space-y-2">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{b.label}</h3>
						<Badge>{b.kind}</Badge>
						<Badge color={b.enabled ? 'success' : 'warning'}>{b.enabled ? 'enabled' : 'off'}</Badge>
					</div>
					<Form b={b} />
				</Card>
			))}
			{canManage && (
				<Card>
					<Button size="sm" variant={showNew ? 'ghost' : 'outline'} onClick={() => setShowNew(!showNew)}>
						{showNew ? 'Close' : '+ New board'}
					</Button>
					{showNew && (
						<div className="mt-3">
							<Form b={null} />
						</div>
					)}
				</Card>
			)}
		</div>
	);
}

export function CareersTab({ careers, referral, canManage, appUrl }: { careers: { headline: string; intro_md: string; target_url: string; embed_note: string; show_closed_roles: boolean }; referral: { enabled: boolean; amount_cents: number; paid_after_days: number; note: string | null }; canManage: boolean; appUrl: string }) {
	const c = useSubmit(saveCareersSettings, 'Careers page saved.');
	const r = useSubmit(saveReferralBonus, 'Referral bonus saved.');
	return (
		<div className="space-y-4">
			<Callout tone="info">
				Public pages: <code>{appUrl}/careers</code> (list + JobPosting JSON-LD per role), <code>/careers/&lt;slug&gt;</code>, <code>/careers/feed.xml</code> (aggregators), <code>/careers/go/&lt;code&gt;</code> (tracked links). {careers.embed_note}
			</Callout>
			{(c.msg || r.msg) && <Callout tone={(c.msg ?? r.msg)!.ok ? 'success' : 'error'}>{(c.msg ?? r.msg)!.text}</Callout>}
			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Careers page</h2>
				<form action={c.submit} className="space-y-3">
					<Input name="headline" label="Headline" defaultValue={careers.headline} required disabled={!canManage} />
					<Textarea name="intro_md" label="Intro" rows={3} defaultValue={careers.intro_md} disabled={!canManage} />
					<Input name="target_url" label="Public URL on the marketing site" defaultValue={careers.target_url} disabled={!canManage} />
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
						<Checkbox name="show_closed_roles" defaultChecked={careers.show_closed_roles} disabled={!canManage} /> Keep closed roles visible with a &quot;closed&quot; badge (off: closed roles only answer their own URL)
					</label>
					{canManage && (
						<Button type="submit" size="sm" loading={c.pending}>
							Save
						</Button>
					)}
				</form>
			</Card>
			<Card className="space-y-3">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Team referral bonus (optional)</h2>
				<form action={r.submit} className="grid sm:grid-cols-4 gap-3 items-end">
					<label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
						<Checkbox name="enabled" defaultChecked={referral.enabled} disabled={!canManage} /> Enabled
					</label>
					<Input name="amount_usd" label="Amount (USD)" type="number" min={0} step={50} defaultValue={referral.amount_cents / 100} disabled={!canManage} />
					<Input name="paid_after_days" label="Paid after (days employed)" type="number" min={0} max={365} defaultValue={referral.paid_after_days} disabled={!canManage} />
					<Input name="note" label="Note" defaultValue={referral.note ?? ''} disabled={!canManage} />
					{canManage && (
						<div className="sm:col-span-4">
							<Button type="submit" size="sm" loading={r.pending}>
								Save
							</Button>
						</div>
					)}
				</form>
			</Card>
		</div>
	);
}
