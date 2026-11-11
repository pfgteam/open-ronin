'use client';

// The 60-Day Plan "Onboarding Targeted Interaction" form: one per day. Win
// yesterday / unclear yesterday / intention today / top 3 today, employee +
// supervisor sign-off. First 30 days: 3-5 a week; days 31-60: 1-2 a week.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import type { OnboardingCheckinRow } from '@/lib/hiring/server';
import { onboardingDay } from '@/lib/hiring/onboarding';
import { formatDate } from '@/lib/format';
import { saveOnboardingCheckin } from '../actions';

export default function CheckinForm({ planId, profileId, startOn, checkins, isSelf, isSupervisor }: { planId: string; profileId: string; startOn: string; checkins: OnboardingCheckinRow[]; isSelf: boolean; isSupervisor: boolean; viewerId: string }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const today = Math.min(90, Math.max(1, onboardingDay(startOn)));
	const [dayNo, setDayNo] = useState(String(checkins.find((c) => c.day_no === today) ? today : today));
	const [showAll, setShowAll] = useState(false);
	const current = checkins.find((c) => c.day_no === Number(dayNo));
	const submit = (fd: FormData) =>
		start(async () => {
			setMsg(null);
			fd.set('plan_id', planId);
			fd.set('profile_id', profileId);
			const r = await saveOnboardingCheckin(fd);
			setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
			if (r.ok) router.refresh();
		});
	const canWrite = isSelf || isSupervisor;
	const list = showAll ? checkins : checkins.slice(0, 5);

	return (
		<Card padding="none">
			<div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
				<h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">60-Day Plan check-in</h2>
				<span className="text-2xs text-slate-500 ml-auto">{checkins.length} on file</span>
			</div>
			{canWrite ? (
				<form key={dayNo + (current?.id ?? '')} action={submit} className="px-3 py-3 space-y-2">
					<div className="grid grid-cols-2 gap-2">
						<Input label="Day" name="day_no" type="number" min={1} max={90} value={dayNo} onChange={(e) => setDayNo(e.target.value)} />
						<Input label="Date" name="on_date" type="date" defaultValue={current?.on_date ?? new Date().toISOString().slice(0, 10)} />
					</div>
					<p className="text-2xs text-slate-500">Topics: 4Rs, core values, objectives, friction points or challenges, company culture.</p>
					<Textarea label="Where did you win yesterday?" name="win_md" defaultValue={current?.win_md ?? ''} rows={2} readOnly={!isSelf && !!current?.employee_signed_at} />
					<Textarea label="Where were you unclear or uncomfortable yesterday?" name="unclear_md" defaultValue={current?.unclear_md ?? ''} rows={2} readOnly={!isSelf && !!current?.employee_signed_at} />
					<Textarea label="What is your intention for today?" name="intention_md" defaultValue={current?.intention_md ?? ''} rows={2} readOnly={!isSelf && !!current?.employee_signed_at} />
					<Textarea label="What are your top 3 for today?" name="top3_md" defaultValue={current?.top3_md ?? ''} rows={3} readOnly={!isSelf && !!current?.employee_signed_at} />
					{isSupervisor && <Textarea label="Supervisor note" name="supervisor_note_md" defaultValue={current?.supervisor_note_md ?? ''} rows={2} />}
					<div className="flex flex-wrap items-center gap-2">
						<Button size="sm" type="submit" loading={pending}>Save</Button>
						{isSelf && !current?.employee_signed_at && <Button size="sm" variant="outline" type="submit" name="sign" value="employee" loading={pending}>Save + sign (employee)</Button>}
						{isSupervisor && !isSelf && !current?.supervisor_signed_at && <Button size="sm" variant="outline" type="submit" name="sign" value="supervisor" loading={pending}>Save + sign (supervisor)</Button>}
						{current?.employee_signed_at && <Badge color="success">employee signed {formatDate(current.employee_signed_at)}</Badge>}
						{current?.supervisor_signed_at && <Badge color="success">supervisor signed {formatDate(current.supervisor_signed_at)}</Badge>}
					</div>
					{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
				</form>
			) : (
				<p className="px-3 py-3 text-xs text-slate-500">Only the person and their supervisor write check-ins.</p>
			)}
			{checkins.length > 0 && (
				<div className="border-t border-slate-200 dark:border-slate-700">
					<ul className="divide-y divide-slate-200 dark:divide-slate-700">
						{list.map((c) => (
							<li key={c.id} className="px-3 py-2 text-xs">
								<button type="button" onClick={() => setDayNo(String(c.day_no))} className="flex w-full items-center gap-2 text-left hover:underline">
									<span className="font-medium text-slate-900 dark:text-slate-100">Day {c.day_no}</span>
									<span className="text-slate-500">{formatDate(c.on_date)}</span>
									<span className="ml-auto flex gap-1">
										{c.employee_signed_at && <Badge color="success">E</Badge>}
										{c.supervisor_signed_at && <Badge color="success">S</Badge>}
									</span>
								</button>
								{c.top3_md && <p className="text-2xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">{c.top3_md}</p>}
							</li>
						))}
					</ul>
					{checkins.length > 5 && (
						<div className="px-3 py-2">
							<button type="button" onClick={() => setShowAll(!showAll)} className="text-xs text-primary-600 hover:underline">{showAll ? 'Show fewer' : `Show all ${checkins.length}`}</button>
						</div>
					)}
				</div>
			)}
		</Card>
	);
}
