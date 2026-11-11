'use client';

// Stages editor (0132, decision 5): the role's interview ladder. Add /
// remove / rename / reorder stages, pick the interview kind, default
// minutes, owner and interviewers per stage, a booking link (Calendly for
// Alex, GHL calendar for the team) and the default location.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Callout from '@/components/ui/Callout';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type { StaffOption } from '@/lib/hiring/server';
import { APP_STATUSES, INTERVIEW_KINDS, INTERVIEW_KIND_LABELS, LOCATION_KINDS, LOCATION_KIND_LABELS, validateStages, type InterviewConfig, type StageDef } from '@/lib/hiring/pipeline';
import { saveStages } from '../../actions';

export default function StagesEditor({ positionId, initial, people, canEdit }: { positionId: string; initial: InterviewConfig; people: StaffOption[]; canEdit: boolean }) {
	const router = useRouter();
	const [pending, start] = useTransition();
	const [cfg, setCfg] = useState<InterviewConfig>(initial);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const problem = useMemo(() => validateStages(cfg), [cfg]);
	const set = (key: string, patch: Partial<StageDef>) => setCfg((c) => ({ ...c, stages: c.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
	const move = (key: string, dir: -1 | 1) =>
		setCfg((c) => {
			const i = c.stages.findIndex((s) => s.key === key);
			const j = i + dir;
			if (i < 0 || j < 0 || j >= c.stages.length) return c;
			const ss = [...c.stages];
			[ss[i], ss[j]] = [ss[j], ss[i]];
			return { ...c, stages: ss };
		});
	const remove = (key: string) => setCfg((c) => ({ ...c, stages: c.stages.filter((s) => s.key !== key) }));
	const add = () => {
		const used = new Set(cfg.stages.map((s) => s.key));
		let key = 'stage';
		let n = 1;
		while (used.has(key)) key = `stage_${++n}`;
		setCfg((c) => ({ ...c, stages: [...c.stages, { key, label: 'New stage', status_key: 'screening', interview_kind: null, default_minutes: null, owner_id: null, interviewer_ids: [] }] }));
	};
	const save = () =>
		start(async () => {
			setMsg(null);
			const fd = new FormData();
			fd.set('position_id', positionId);
			fd.set('stages_json', JSON.stringify(cfg));
			const r = await saveStages(fd);
			setMsg(r.ok ? { ok: true, text: 'Stages saved.' } : { ok: false, text: r.error });
			router.refresh();
		});
	return (
		<div className="space-y-3">
			<Callout tone="info">No default owners (decision 5): pick the owner and interviewers per stage for this role. Interviewers named here are pre-selected when an interview is scheduled and receive a bell. Booking link: Calendly for Alex, the GHL calendar for the team, or leave blank and schedule by hand.</Callout>
			{msg && <Callout tone={msg.ok ? 'success' : 'error'}>{msg.text}</Callout>}
			{problem && <Callout tone="error">{problem}</Callout>}
			{cfg.stages.map((s, i) => (
				<Card key={s.key} className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-xs text-slate-500">{i + 1}</span>
						<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.label}</h3>
						<Badge>{s.status_key}</Badge>
						{s.interview_kind && <Badge color="primary">{INTERVIEW_KIND_LABELS[s.interview_kind]}</Badge>}
						{canEdit && (
							<span className="ml-auto flex gap-1">
								<Button size="sm" variant="ghost" onClick={() => move(s.key, -1)} disabled={i === 0}>
									↑
								</Button>
								<Button size="sm" variant="ghost" onClick={() => move(s.key, 1)} disabled={i === cfg.stages.length - 1}>
									↓
								</Button>
								<Button size="sm" variant="ghost" onClick={() => remove(s.key)}>
									Remove
								</Button>
							</span>
						)}
					</div>
					<div className="grid sm:grid-cols-4 gap-2">
						<Input label="Key" value={s.key} onChange={(e) => set(s.key, { key: e.target.value })} pattern="[a-z][a-z0-9_]{1,40}" disabled={!canEdit} />
						<Input label="Label" value={s.label} onChange={(e) => set(s.key, { label: e.target.value })} disabled={!canEdit} />
						<Select label="Application status" value={s.status_key} onChange={(e) => set(s.key, { status_key: e.target.value as StageDef['status_key'] })} disabled={!canEdit}>
							{APP_STATUSES.map((st) => (
								<option key={st} value={st}>
									{st}
								</option>
							))}
						</Select>
						<Select label="Interview kind" value={s.interview_kind ?? ''} onChange={(e) => set(s.key, { interview_kind: (e.target.value || null) as StageDef['interview_kind'] })} disabled={!canEdit}>
							<option value="">— none —</option>
							{INTERVIEW_KINDS.map((k) => (
								<option key={k} value={k}>
									{INTERVIEW_KIND_LABELS[k]}
								</option>
							))}
						</Select>
						{s.interview_kind && (
							<>
								<Input label="Default minutes" type="number" min={5} max={480} value={s.default_minutes ?? ''} onChange={(e) => set(s.key, { default_minutes: e.target.value ? Number(e.target.value) : null })} disabled={!canEdit} />
								<Select label="Default location" value={s.location_kind ?? 'zoom'} onChange={(e) => set(s.key, { location_kind: e.target.value as StageDef['location_kind'] })} disabled={!canEdit}>
									{LOCATION_KINDS.map((k) => (
										<option key={k} value={k}>
											{LOCATION_KIND_LABELS[k]}
										</option>
									))}
								</Select>
								<Input label="Booking link (Calendly / GHL)" value={s.booking_url ?? ''} onChange={(e) => set(s.key, { booking_url: e.target.value || null })} className="sm:col-span-2" disabled={!canEdit} />
							</>
						)}
						<Select label="Stage owner" value={s.owner_id ?? ''} onChange={(e) => set(s.key, { owner_id: e.target.value || null })} disabled={!canEdit}>
							<option value="">—</option>
							{people.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</Select>
						{s.interview_kind && (
							<div className="sm:col-span-3">
								<div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Interviewers</div>
								<div className="flex flex-wrap gap-1.5">
									{people.map((p) => {
										const on = s.interviewer_ids.includes(p.id);
										return (
											<label key={p.id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${on ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/30 text-primary-800 dark:text-primary-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
												<Checkbox checked={on} disabled={!canEdit} onChange={(e) => set(s.key, { interviewer_ids: e.target.checked ? [...s.interviewer_ids, p.id] : s.interviewer_ids.filter((x) => x !== p.id) })} /> {p.name}
											</label>
										);
									})}
								</div>
							</div>
						)}
					</div>
				</Card>
			))}
			{canEdit && (
				<div className="flex gap-2">
					<Button size="sm" variant="outline" onClick={add}>
						+ Stage
					</Button>
					<Button size="sm" onClick={save} loading={pending} disabled={!!problem}>
						Save stages
					</Button>
				</div>
			)}
		</div>
	);
}
